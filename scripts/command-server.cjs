const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

const PORT = 3001;
const PROJECTS_ROOT = path.join(process.cwd(), 'Projetos');

// Garante que a pasta "Projetos" exista
if (!fs.existsSync(PROJECTS_ROOT)) {
    try {
        fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
        console.log(`Pasta "Projetos" criada em: ${PROJECTS_ROOT}`);
    } catch (err) {
        console.error(`Erro ao criar pasta "Projetos": ${err.message}`);
    }
}

let currentProcess = null;

// ============================================================
// Middleware: Servir arquivos estáticos dos projetos (imagens, fontes, etc.)
// ============================================================
app.use('/project-assets', express.static(PROJECTS_ROOT, {
    setHeaders: (res, filePath) => {
        // CORS headers para assets
        res.set('Access-Control-Allow-Origin', '*');
        // Cache de 1h para assets estáticos
        if (/\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|mp4|mp3)$/i.test(filePath)) {
            res.set('Cache-Control', 'public, max-age=3600');
        }
    }
}));

// Rota para servir qualquer arquivo binário de um projeto sob demanda
app.post('/serve-file', (req, res) => {
    const { projectName, filePath } = req.body;
    if (!projectName || !filePath) {
        return res.status(400).json({ error: 'projectName e filePath são obrigatórios' });
    }
    const fullPath = path.join(PROJECTS_ROOT, projectName, filePath);
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    res.sendFile(fullPath);
});

// Rota raiz para evitar 404 e permitir verificação de status
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        message: 'BuilderAI Command Server is running',
        endpoints: {
            prepare: '/prepare-project (POST)',
            save: '/save-file (POST)',
            execute: '/execute (POST)',
            status: '/status (GET)',
            validate: '/validate-project (POST)',
            assets: '/project-assets/<projectName>/... (GET)'
        }
    });
});

// ============================================================
// Validação de projeto: verifica exports, imports, entry points
// e auto-corrige problemas simples antes do build
// ============================================================
function validateAndFixProject(projectDir) {
    const issues = [];
    const fixes = [];

    // 1. Verificar se index.html existe e aponta para o entry correto
    const indexHtmlPath = path.join(projectDir, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
        try {
            let html = fs.readFileSync(indexHtmlPath, 'utf8');
            // Verifica se aponta para main.tsx ou main.ts ou main.jsx ou main.js
            if (!/<script.*src=.*main\.(tsx|ts|jsx|js)/i.test(html)) {
                issues.push('index.html não aponta para nenhum entry point (main.tsx/ts/jsx/js)');
                // Tenta corrigir se houver um src/main.tsx
                for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
                    if (fs.existsSync(path.join(projectDir, `src/main.${ext}`))) {
                        if (!html.includes(`/src/main.${ext}`)) {
                            // Adiciona script tag antes do </body>
                            if (html.includes('</body>')) {
                                html = html.replace('</body>', `  <script type="module" src="/src/main.${ext}"></script>\n  </body>`);
                                fs.writeFileSync(indexHtmlPath, html, 'utf8');
                                fixes.push(`Adicionado entry point /src/main.${ext} ao index.html`);
                            }
                        }
                        break;
                    }
                }
            }
        } catch (e) {
            issues.push(`Erro ao ler index.html: ${e.message}`);
        }
    } else {
        issues.push('index.html não encontrado na raiz do projeto');
    }

    // 2. Verificar App.tsx/App.jsx tem export default
    for (const appFile of ['src/App.tsx', 'src/App.jsx', 'src/App.ts', 'src/App.js']) {
        const appPath = path.join(projectDir, appFile);
        if (fs.existsSync(appPath)) {
            try {
                let code = fs.readFileSync(appPath, 'utf8');
                const hasExportDefault = /export\s+default\s+(function|class|const|let|var|\w)/m.test(code);
                const hasDefaultExport = /export\s*\{\s*[^}]*\bas\s+default\b/m.test(code);
                
                if (!hasExportDefault && !hasDefaultExport) {
                    issues.push(`${appFile} não tem export default`);
                    
                    // Tenta detectar o nome do componente principal
                    const funcMatch = code.match(/(?:function|const)\s+(App)\s*[=(]/i);
                    const className = code.match(/class\s+(App)\s+/i);
                    const componentName = funcMatch?.[1] || className?.[1] || 'App';
                    
                    // Verifica se já existe "export { App }" ou similar  
                    if (!code.includes(`export { ${componentName} }`)) {
                        // Adiciona export default no final
                        code = code.trimEnd() + `\n\nexport default ${componentName};\n`;
                        fs.writeFileSync(appPath, code, 'utf8');
                        fixes.push(`Adicionado "export default ${componentName}" ao ${appFile}`);
                    } else {
                        // Converte export { App } para export default App
                        code = code.replace(
                            new RegExp(`export\\s*\\{\\s*${componentName}\\s*\\}`),
                            `export default ${componentName}`
                        );
                        fs.writeFileSync(appPath, code, 'utf8');
                        fixes.push(`Convertido export { ${componentName} } para export default no ${appFile}`);
                    }
                }
            } catch (e) {
                issues.push(`Erro ao ler ${appFile}: ${e.message}`);
            }
            break; // Só precisa verificar o primeiro encontrado
        }
    }

    // 3. Verificar main.tsx/main.ts importa App corretamente
    for (const mainFile of ['src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/main.js']) {
        const mainPath = path.join(projectDir, mainFile);
        if (fs.existsSync(mainPath)) {
            try {
                let code = fs.readFileSync(mainPath, 'utf8');
                
                // Verifica se importa App
                if (!code.includes('./App') && !code.includes("'./App'") && !code.includes('"./App"')) {
                    issues.push(`${mainFile} não importa App`);
                }
                
                // Verifica se tem import de react e react-dom
                if (!code.includes('react-dom') && !code.includes('ReactDOM')) {
                    issues.push(`${mainFile} não importa react-dom`);
                }
            } catch (e) {
                issues.push(`Erro ao ler ${mainFile}: ${e.message}`);
            }
            break;
        }
    }

    // 4. Verificar conflito de porta no vite.config
    for (const configFile of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
        const configPath = path.join(projectDir, configFile);
        if (fs.existsSync(configPath)) {
            try {
                let code = fs.readFileSync(configPath, 'utf8');
                
                // Detecta porta 8080 (conflito com BuilderAI)
                const portMatch = code.match(/port\s*:\s*(\d+)/);
                if (portMatch && Number(portMatch[1]) === 8080) {
                    issues.push(`${configFile} usa porta 8080 (conflito com BuilderAI)`);
                    code = code.replace(/port\s*:\s*8080/, 'port: 8081');
                    fs.writeFileSync(configPath, code, 'utf8');
                    fixes.push(`Porta alterada de 8080 para 8081 no ${configFile}`);
                }
                
                // Se não tem porta definida, adiciona porta 8081
                if (!portMatch) {
                    // Tenta inserir port: 8081 no bloco server
                    if (/server\s*:\s*\{/.test(code)) {
                        code = code.replace(/server\s*:\s*\{/, 'server: {\n    port: 8081,');
                        fs.writeFileSync(configPath, code, 'utf8');
                        fixes.push(`Adicionado port: 8081 ao bloco server no ${configFile}`);
                    }
                }
            } catch (e) {
                issues.push(`Erro ao ler ${configFile}: ${e.message}`);
            }
            break;
        }
    }

    // 5. Verificar tsconfig.json existe (para projetos TS)
    const hasTsFiles = (() => {
        try {
            const srcDir = path.join(projectDir, 'src');
            if (!fs.existsSync(srcDir)) return false;
            const entries = fs.readdirSync(srcDir);
            return entries.some(e => /\.(tsx?|ts)$/.test(e));
        } catch { return false; }
    })();
    
    if (hasTsFiles && !fs.existsSync(path.join(projectDir, 'tsconfig.json'))) {
        issues.push('Projeto TypeScript sem tsconfig.json');
    }

    const cssFiles = ['src/index.css', 'src/styles.css', 'src/globals.css', 'src/app.css'];
    for (const cssFile of cssFiles) {
        const cssPath = path.join(projectDir, cssFile);
        if (fs.existsSync(cssPath)) {
            try {
                let cssContent = fs.readFileSync(cssPath, 'utf8');
                const hasLayer = /@layer\s+(base|components|utilities)/i.test(cssContent);
                const hasTailwindDirective = /@tailwind\s+(base|components|utilities)/i.test(cssContent);
                
                if (hasLayer && !hasTailwindDirective) {
                    issues.push(`${cssFile} usa @layer sem @tailwind directives`);
                    
                    // Auto-fix: inserir @tailwind directives no topo (após @imports)
                    const tailwindDirectives = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n';
                    
                    // Encontra posição após últimos @import
                    const importRegex = /@import\s+[^;]+;/g;
                    let lastImportEnd = 0;
                    let match;
                    while ((match = importRegex.exec(cssContent)) !== null) {
                        lastImportEnd = match.index + match[0].length;
                    }
                    
                    if (lastImportEnd > 0) {
                        cssContent = cssContent.slice(0, lastImportEnd) + '\n\n' + tailwindDirectives + cssContent.slice(lastImportEnd);
                    } else {
                        cssContent = tailwindDirectives + cssContent;
                    }
                    
                    fs.writeFileSync(cssPath, cssContent, 'utf8');
                    fixes.push(`Adicionado @tailwind base/components/utilities ao ${cssFile}`);
                }

                const firstImportIndex = cssContent.search(/@import\s+[^;]+;/);
                const firstTailwindIndex = cssContent.search(/@tailwind\s+(base|components|utilities)\s*;/);

                if (firstImportIndex !== -1 && firstTailwindIndex !== -1 && firstTailwindIndex < firstImportIndex) {
                    issues.push(`${cssFile} tem @import depois de @tailwind (deve vir antes de todas as declarações)`);

                    const importRegex = /@import\s+[^;]+;/g;
                    const imports = [];
                    let match;
                    while ((match = importRegex.exec(cssContent)) !== null) {
                        imports.push(match[0]);
                    }

                    if (imports.length > 0) {
                        const cssWithoutImports = cssContent.replace(importRegex, '').trimStart();
                        const newCss = `${imports.join('\n')}\n\n${cssWithoutImports}`;
                        fs.writeFileSync(cssPath, newCss, 'utf8');
                        cssContent = newCss;
                        fixes.push(`Reorganizado @import para o topo em ${cssFile}`);
                    }
                }
            } catch (e) {
                issues.push(`Erro ao verificar ${cssFile}: ${e.message}`);
            }
        }
    }

    return { issues, fixes, valid: issues.length === 0 };
}

app.post('/validate-project', (req, res) => {
    const { projectName } = req.body;
    if (!projectName) {
        return res.status(400).json({ error: 'projectName é obrigatório' });
    }

    const projectDir = path.join(PROJECTS_ROOT, projectName);
    if (!fs.existsSync(projectDir)) {
        return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    const result = validateAndFixProject(projectDir);
    res.json({ success: true, ...result });
});

// ============================================================
// Smart-dev: instala se necessário, valida, e inicia dev server
// ============================================================
app.post('/smart-dev', async (req, res) => {
    const { cwd, packageManager } = req.body || {};
    if (!cwd) {
        return res.status(400).json({ error: 'Diretório (cwd) é obrigatório' });
    }

    // Encerra dev anterior, se houver
    if (currentProcess) {
        try { currentProcess.kill(); } catch (e) {}
        currentProcess = null;
    }

    const pm = (() => {
        if (packageManager) return packageManager;
        try {
            if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
            if (fs.existsSync(path.join(cwd, 'package-lock.json'))) return 'npm';
        } catch {}
        return 'pnpm';
    })();

    const nodeModulesPath = path.join(cwd, 'node_modules');
    const needsInstall = !fs.existsSync(nodeModulesPath);

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

    function pipe(child) {
        child.stdout.on('data', (d) => res.write(d.toString()));
        child.stderr.on('data', (d) => res.write(d.toString()));
    }

    // === VALIDAÇÃO PRE-BUILD ===
    res.write('INFO: Validando projeto antes de iniciar...\n');
    try {
        const validation = validateAndFixProject(cwd);
        if (validation.fixes.length > 0) {
            for (const fix of validation.fixes) {
                res.write(`INFO: [AUTO-FIX] ${fix}\n`);
            }
        }
        if (validation.issues.length > 0) {
            for (const issue of validation.issues) {
                res.write(`STDERR: [AVISO] ${issue}\n`);
            }
        }
        if (validation.valid) {
            res.write('INFO: Validação OK - projeto sem problemas detectados.\n');
        }
    } catch (e) {
        res.write(`STDERR: Erro durante validação: ${e.message}\n`);
    }

    // Executa instalação se necessário
    async function runInstallIfNeeded() {
        if (!needsInstall) {
            res.write('INFO: node_modules encontrado. Pulando instalação.\n');
            return 0;
        }
        res.write('INFO: node_modules ausente. Iniciando instalação...\n');
        return await new Promise((resolve) => {
            const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
            const args = process.platform === 'win32'
                ? ['-Command', `${pm} install`]
                : ['-c', `${pm} install`];
            const installProc = spawn(shell, args, { cwd, env: process.env });
            pipe(installProc);
            installProc.on('close', (code) => {
                res.write(`INSTALL_CLOSE: ${code}\n`);
                resolve(code || 0);
            });
        });
    }

    const installCode = await runInstallIfNeeded();
    if (installCode !== 0) {
        res.write('ERROR: Falha na instalação de dependências.\n');
        return res.end();
    }

    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const args = process.platform === 'win32'
        ? ['-Command', `${pm} run dev`]
        : ['-c', `${pm} run dev`];
    const devProc = spawn(shell, args, { cwd, env: process.env });
    currentProcess = devProc;

    pipe(devProc);
    devProc.on('close', (code) => {
        res.write(`CLOSE: ${code}\n`);
        res.end();
        currentProcess = null;
    });
    devProc.on('error', (err) => {
        res.write(`ERROR: ${err.message}\n`);
        res.end();
        currentProcess = null;
    });
});

// Rota para preparar o diretório de um projeto
app.post('/prepare-project', (req, res) => {
    const { projectName } = req.body;
    if (!projectName) {
        return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    }

    const projectDir = path.join(PROJECTS_ROOT, projectName);
    
    try {
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
            console.log(`Nova subpasta de projeto criada: ${projectDir}`);
        }
        res.json({ 
            success: true, 
            path: projectDir,
            name: projectName
        });
    } catch (err) {
        console.error(`Erro ao criar subpasta do projeto: ${err.message}`);
        res.status(500).json({ error: `Erro ao criar diretório do projeto: ${err.message}` });
    }
});

// Rota para salvar arquivos na pasta do projeto
app.post('/save-file', (req, res) => {
    const { projectName, filePath, content } = req.body;
    
    if (!projectName || !filePath) {
        return res.status(400).json({ error: 'projectName e filePath são obrigatórios' });
    }

    const projectDir = path.join(PROJECTS_ROOT, projectName);
    const fullPath = path.join(projectDir, filePath);
    
    try {
        // Garante que o diretório do arquivo exista
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(fullPath, content, 'utf8');
        res.json({ success: true, path: fullPath });
    } catch (err) {
        console.error(`Erro ao salvar arquivo ${filePath}: ${err.message}`);
        res.status(500).json({ error: `Erro ao salvar arquivo: ${err.message}` });
    }
});

// ============================================================
// Rota para ler arquivos de um projeto (incluindo imagens como binários)
// ============================================================
app.post('/read-project', (req, res) => {
    const { projectName } = req.body;
    if (!projectName) {
        return res.status(400).json({ error: 'projectName é obrigatório' });
    }

    const projectDir = path.join(PROJECTS_ROOT, projectName);
    if (!fs.existsSync(projectDir)) {
        return res.status(404).json({ error: 'Projeto não encontrado em Projetos/' + projectName });
    }

    // Extensões de texto (lê conteúdo)
    const textAllowed = /\.(tsx|ts|js|jsx|css|json|html|md|txt|yaml|yml|toml|env|gitignore|prettierrc|eslintrc|editorconfig)$/i;
    // Extensões de assets/binários (registra apenas path)
    const binaryAllowed = /\.(png|jpg|jpeg|gif|svg|webp|ico|bmp|tiff|mp3|mp4|wav|ogg|webm|woff|woff2|ttf|eot|otf|pdf)$/i;
    
    const denyDirs = new Set(['node_modules', '.git', 'dist', '.vite', 'build', '.next', '.cache', '.turbo']);
    const files = [];

    function scan(dir, base) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            console.warn('Falha ao ler diretório', dir, err.message);
            return;
        }
        
        for (const entry of entries) {
            const rel = base ? path.join(base, entry.name) : entry.name;
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (denyDirs.has(entry.name)) continue;
                scan(abs, rel);
            } else {
                const normalizedRel = rel.replace(/\\/g, '/');
                
                if (textAllowed.test(entry.name)) {
                    try {
                        const code = fs.readFileSync(abs, 'utf8');
                        files.push({ path: normalizedRel, code, binary: false });
                    } catch (err) {
                        console.warn('Falha ao ler', abs, err.message);
                        // Tenta com encoding latin1 como fallback
                        try {
                            const code = fs.readFileSync(abs, 'latin1');
                            files.push({ path: normalizedRel, code, binary: false });
                        } catch (err2) {
                            console.warn('Falha com fallback encoding', abs, err2.message);
                        }
                    }
                } else if (binaryAllowed.test(entry.name)) {
                    // Para binários, apenas registra o path (sem conteúdo)
                    try {
                        const stat = fs.statSync(abs);
                        files.push({ 
                            path: normalizedRel, 
                            code: '', 
                            binary: true,
                            size: stat.size,
                            assetUrl: `/project-assets/${path.basename(path.dirname(projectDir))}/${normalizedRel}`
                        });
                    } catch (err) {
                        files.push({ path: normalizedRel, code: '', binary: true });
                    }
                }
            }
        }
    }

    try {
        scan(projectDir, '');
        res.json({ success: true, files, path: projectDir });
    } catch (err) {
        console.error('Erro ao ler projeto:', err.message);
        res.status(500).json({ error: 'Erro ao ler projeto: ' + err.message });
    }
});

// Rota para excluir arquivo de um projeto
app.post('/delete-file', (req, res) => {
    const { projectName, filePath } = req.body;
    if (!projectName || !filePath) {
        return res.status(400).json({ error: 'projectName e filePath sao obrigatorios' });
    }

    const fullPath = path.join(PROJECTS_ROOT, projectName, filePath);

    try {
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'Arquivo nao encontrado' });
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(fullPath);
        }
        res.json({ success: true, deleted: filePath });
    } catch (err) {
        console.error(`Erro ao excluir ${filePath}:`, err.message);
        res.status(500).json({ error: `Erro ao excluir: ${err.message}` });
    }
});

// Rota para mover/renomear arquivo dentro de um projeto
app.post('/move-file', (req, res) => {
    const { projectName, oldPath, newPath } = req.body;
    if (!projectName || !oldPath || !newPath) {
        return res.status(400).json({ error: 'projectName, oldPath e newPath sao obrigatorios' });
    }

    const srcFull = path.join(PROJECTS_ROOT, projectName, oldPath);
    const dstFull = path.join(PROJECTS_ROOT, projectName, newPath);

    try {
        if (!fs.existsSync(srcFull)) {
            return res.status(404).json({ error: 'Arquivo de origem nao encontrado' });
        }
        // Garante que o diretorio destino exista
        const dstDir = path.dirname(dstFull);
        if (!fs.existsSync(dstDir)) {
            fs.mkdirSync(dstDir, { recursive: true });
        }
        fs.renameSync(srcFull, dstFull);
        res.json({ success: true, from: oldPath, to: newPath });
    } catch (err) {
        console.error(`Erro ao mover ${oldPath} -> ${newPath}:`, err.message);
        res.status(500).json({ error: `Erro ao mover: ${err.message}` });
    }
});

// Rota para criar arquivo vazio dentro de uma pasta do projeto
app.post('/create-file', (req, res) => {
    const { projectName, filePath, content } = req.body;
    if (!projectName || !filePath) {
        return res.status(400).json({ error: 'projectName e filePath sao obrigatorios' });
    }

    const fullPath = path.join(PROJECTS_ROOT, projectName, filePath);

    try {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content || '', 'utf8');
        res.json({ success: true, path: fullPath });
    } catch (err) {
        console.error(`Erro ao criar ${filePath}:`, err.message);
        res.status(500).json({ error: `Erro ao criar: ${err.message}` });
    }
});

app.post('/execute', (req, res) => {
    const { command, cwd } = req.body;

    if (!command || !cwd) {
        return res.status(400).json({ error: 'Comando e diretório (cwd) são obrigatórios' });
    }

    // Se já houver um processo rodando (como um dev server), mata ele antes de rodar outro
    if (currentProcess) {
        try {
            currentProcess.kill();
        } catch (e) {}
    }

    console.log(`Executando: ${command} em ${cwd}`);

    // Configura a execução via PowerShell no Windows
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const args = process.platform === 'win32' ? ['-Command', command] : ['-c', command];

    const child = spawn(shell, args, {
        cwd: cwd,
        env: process.env
    });

    currentProcess = child;

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

    child.stdout.on('data', (data) => {
        res.write(`STDOUT: ${data.toString()}`);
    });

    child.stderr.on('data', (data) => {
        res.write(`STDERR: ${data.toString()}`);
    });

    child.on('close', (code) => {
        res.write(`CLOSE: ${code}`);
        res.end();
        currentProcess = null;
    });

    child.on('error', (err) => {
        res.write(`ERROR: ${err.message}`);
        res.end();
        currentProcess = null;
    });
});

// Rota para matar o processo atualmente rodando
app.post('/kill-process', (req, res) => {
    if (currentProcess) {
        try {
            // No Windows, precisamos matar a arvore de processos
            if (process.platform === 'win32') {
                const { execSync } = require('child_process');
                try {
                    execSync(`taskkill /PID ${currentProcess.pid} /T /F`, { stdio: 'ignore' });
                } catch (e) {
                    currentProcess.kill('SIGTERM');
                }
            } else {
                currentProcess.kill('SIGTERM');
            }
            currentProcess = null;
            res.json({ success: true, message: 'Processo encerrado' });
        } catch (err) {
            res.status(500).json({ error: `Erro ao matar processo: ${err.message}` });
        }
    } else {
        res.json({ success: true, message: 'Nenhum processo rodando' });
    }
});

// Rota para verificar se um diretório existe dentro do cwd
app.post('/check-dir', (req, res) => {
    const { cwd, dirName } = req.body;
    if (!cwd || !dirName) {
        return res.status(400).json({ error: 'cwd e dirName são obrigatórios' });
    }
    const fullPath = path.join(cwd, dirName);
    res.json({ exists: fs.existsSync(fullPath), path: fullPath });
});

// Lista chats salvos de um projeto (.builderai/chats/)
app.post('/list-chats', (req, res) => {
    const { projectName } = req.body;
    if (!projectName) return res.status(400).json({ error: 'projectName é obrigatório' });

    const chatsDir = path.join(PROJECTS_ROOT, projectName, '.builderai', 'chats');
    if (!fs.existsSync(chatsDir)) {
        return res.json({ chats: [] });
    }

    try {
        const files = fs.readdirSync(chatsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const fullPath = path.join(chatsDir, f);
                const stat = fs.statSync(fullPath);
                let meta = { title: f.replace('.json', ''), id: f.replace('.json', '') };
                try {
                    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    if (data.title) meta.title = data.title;
                    if (data.id) meta.id = data.id;
                } catch {}
                return { ...meta, updatedAt: stat.mtime.toISOString(), filename: f };
            })
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        res.json({ chats: files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Lê um chat específico
app.post('/read-chat', (req, res) => {
    const { projectName, chatId } = req.body;
    if (!projectName || !chatId) return res.status(400).json({ error: 'projectName e chatId são obrigatórios' });

    const chatPath = path.join(PROJECTS_ROOT, projectName, '.builderai', 'chats', `${chatId}.json`);
    if (!fs.existsSync(chatPath)) {
        return res.status(404).json({ error: 'Chat não encontrado' });
    }

    try {
        const data = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rota para verificar se o servidor está online
app.get('/status', (req, res) => {
    res.json({ status: 'online', platform: process.platform });
});

app.listen(PORT, () => {
    console.log(`Servidor de comandos BuilderAI rodando em http://localhost:${PORT}`);
    console.log(`Pronto para executar comandos via PowerShell.`);
    console.log(`Assets estáticos servidos em: http://localhost:${PORT}/project-assets/`);
});
