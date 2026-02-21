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
// Estado global para monitoramento de erros do Vite
// ============================================================
let viteErrorBuffer = [];
let processedErrors = new Set();
let sseClients = [];

// ============================================================
// Middleware: Servir arquivos estáticos dos projetos (imagens, fontes, etc.)
// ============================================================
app.use('/project-assets', express.static(PROJECTS_ROOT, {
    setHeaders: (res, filePath) => {
        res.set('Access-Control-Allow-Origin', '*');
        if (/\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|mp4|mp3|css|js|json|html)$/i.test(filePath)) {
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
            assets: '/project-assets/<projectName>/... (GET)',
            watchErrors: '/watch-errors (GET - SSE)'
        }
    });
});

// ============================================================
// Helper: Escanear recursivamente arquivos por extensão
// ============================================================
function scanFilesRecursive(dir, extensions, denyDirs = ['node_modules', '.git', 'dist', '.vite', 'build', '.next', '.cache', '.turbo']) {
    const results = [];
    
    function scan(currentDir, basePath) {
        let entries;
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch { return; }
        
        for (const entry of entries) {
            const rel = basePath ? path.join(basePath, entry.name) : entry.name;
            const abs = path.join(currentDir, entry.name);
            
            if (entry.isDirectory()) {
                if (denyDirs.includes(entry.name)) continue;
                scan(abs, rel);
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (extensions.includes(ext)) {
                    results.push({ path: rel.replace(/\\/g, '/'), abs });
                }
            }
        }
    }
    
    scan(dir, '');
    return results;
}

// ============================================================
// Auto-fix: Corrige um erro do Vite baseado no padrão detectado
// ============================================================
function autoFixViteError(errorMessage, projectDir) {
    const fixes = [];
    
    // Pattern 1: @layer sem @tailwind directives
    const layerMatch = errorMessage.match(/`@layer\s+(base|components|utilities)`.*no matching.*`@tailwind\s+(base|components|utilities)`/i)
        || errorMessage.match(/@layer\s+(base|components|utilities).*@tailwind/i);
    if (layerMatch || /`@layer base` is used but no matching `@tailwind base`/i.test(errorMessage)) {
        // Encontra o arquivo CSS mencionado no erro
        const fileMatch = errorMessage.match(/([^\s:]+\.css):\d+:\d+/i) || errorMessage.match(/File:\s*([^\s:]+\.css)/i);
        let cssFile = null;
        
        if (fileMatch) {
            // Extrai apenas o caminho relativo ao projeto
            const fullPath = fileMatch[1].replace(/\\/g, '/');
            const projIdx = fullPath.indexOf('/src/');
            cssFile = projIdx >= 0 ? fullPath.substring(projIdx + 1) : fullPath;
        }
        
        // Se não encontrou no erro, escaneia todos os CSS
        const cssFiles = cssFile 
            ? [{ path: cssFile, abs: path.join(projectDir, cssFile) }]
            : scanFilesRecursive(projectDir, ['.css']);
        
        for (const file of cssFiles) {
            if (!fs.existsSync(file.abs)) continue;
            try {
                let content = fs.readFileSync(file.abs, 'utf8');
                const hasLayer = /@layer\s+(base|components|utilities)/i.test(content);
                const hasTailwind = /@tailwind\s+(base|components|utilities)/i.test(content);
                
                if (hasLayer && !hasTailwind) {
                    const tailwindDirectives = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n';
                    
                    // Encontra posição após últimos @import
                    const importRegex = /@import\s+[^;]+;/g;
                    let lastImportEnd = 0;
                    let match;
                    while ((match = importRegex.exec(content)) !== null) {
                        lastImportEnd = match.index + match[0].length;
                    }
                    
                    if (lastImportEnd > 0) {
                        content = content.slice(0, lastImportEnd) + '\n\n' + tailwindDirectives + content.slice(lastImportEnd);
                    } else {
                        content = tailwindDirectives + content;
                    }
                    
                    fs.writeFileSync(file.abs, content, 'utf8');
                    fixes.push(`Adicionado @tailwind base/components/utilities em ${file.path}`);
                }
            } catch (e) {
                console.warn(`Erro ao corrigir ${file.path}:`, e.message);
            }
        }
    }
    
    // Pattern 2: @import depois de @tailwind
    if (/@import.*depois.*@tailwind|@import.*after.*@tailwind|@import must precede/i.test(errorMessage)) {
        const cssFiles = scanFilesRecursive(projectDir, ['.css']);
        for (const file of cssFiles) {
            try {
                let content = fs.readFileSync(file.abs, 'utf8');
                const firstImportIdx = content.search(/@import\s+[^;]+;/);
                const firstTailwindIdx = content.search(/@tailwind\s+(base|components|utilities)\s*;/);
                
                if (firstImportIdx !== -1 && firstTailwindIdx !== -1 && firstTailwindIdx < firstImportIdx) {
                    const importRegex = /@import\s+[^;]+;/g;
                    const imports = [];
                    let m;
                    while ((m = importRegex.exec(content)) !== null) imports.push(m[0]);
                    
                    if (imports.length > 0) {
                        const withoutImports = content.replace(importRegex, '').trimStart();
                        content = `${imports.join('\n')}\n\n${withoutImports}`;
                        fs.writeFileSync(file.abs, content, 'utf8');
                        fixes.push(`Reorganizado @import para o topo em ${file.path}`);
                    }
                }
            } catch (e) { /* skip */ }
        }
    }
    
    // Pattern 3: Porta em conflito
    if (/EADDRINUSE|port.*already in use|porta.*em uso/i.test(errorMessage)) {
        const configFiles = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'];
        for (const cf of configFiles) {
            const cfPath = path.join(projectDir, cf);
            if (fs.existsSync(cfPath)) {
                try {
                    let code = fs.readFileSync(cfPath, 'utf8');
                    const portMatch = code.match(/port\s*:\s*(\d+)/);
                    if (portMatch) {
                        const oldPort = Number(portMatch[1]);
                        const newPort = oldPort === 8080 ? 8081 : oldPort + 1;
                        code = code.replace(/port\s*:\s*\d+/, `port: ${newPort}`);
                        fs.writeFileSync(cfPath, code, 'utf8');
                        fixes.push(`Porta alterada de ${oldPort} para ${newPort} em ${cf}`);
                    }
                } catch { /* skip */ }
                break;
            }
        }
    }
    
    // Pattern 4: export default faltando em App
    if (/does not provide an export named 'default'.*App|App.*export default/i.test(errorMessage)) {
        for (const appFile of ['src/App.tsx', 'src/App.jsx', 'src/App.ts', 'src/App.js']) {
            const appPath = path.join(projectDir, appFile);
            if (fs.existsSync(appPath)) {
                try {
                    let code = fs.readFileSync(appPath, 'utf8');
                    const hasExportDefault = /export\s+default\s+(function|class|const|let|var|\w)/m.test(code);
                    const hasDefaultExport = /export\s*\{\s*[^}]*\bas\s+default\b/m.test(code);
                    
                    if (!hasExportDefault && !hasDefaultExport) {
                        const funcMatch = code.match(/(?:function|const)\s+(App)\s*[=(]/i);
                        const componentName = funcMatch?.[1] || 'App';
                        code = code.trimEnd() + `\n\nexport default ${componentName};\n`;
                        fs.writeFileSync(appPath, code, 'utf8');
                        fixes.push(`Adicionado export default ${componentName} em ${appFile}`);
                    }
                } catch { /* skip */ }
                break;
            }
        }
    }
    
    // Pattern 5: PostCSS/Tailwind config missing
    if (/Cannot find.*tailwindcss|tailwind.*not found|postcss.*plugin.*not found/i.test(errorMessage)) {
        // Verifica se postcss.config existe
        const postcssConfigs = ['postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs'];
        const hasPostcss = postcssConfigs.some(c => fs.existsSync(path.join(projectDir, c)));
        
        if (!hasPostcss) {
            const postcssContent = `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`;
            fs.writeFileSync(path.join(projectDir, 'postcss.config.js'), postcssContent, 'utf8');
            fixes.push('Criado postcss.config.js com tailwindcss e autoprefixer');
        }
        
        // Verifica se tailwind.config existe
        const tailwindConfigs = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs'];
        const hasTailwind = tailwindConfigs.some(c => fs.existsSync(path.join(projectDir, c)));
        
        if (!hasTailwind) {
            const tailwindContent = `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n};\n`;
            fs.writeFileSync(path.join(projectDir, 'tailwind.config.ts'), tailwindContent, 'utf8');
            fixes.push('Criado tailwind.config.ts com configuração padrão');
        }
    }
    
    // Pattern 6: Failed to resolve import
    if (/Failed to resolve import|Module ".*" has been externalized/i.test(errorMessage)) {
        const importMatch = errorMessage.match(/Failed to resolve import "([^"]+)" from "([^"]+)"/i);
        if (importMatch) {
            const moduleName = importMatch[1];
            const fromFile = importMatch[2];
            // Se é um import relativo, tenta verificar se o arquivo existe
            if (moduleName.startsWith('.') || moduleName.startsWith('/')) {
                fixes.push(`[INFO] Import relativo quebrado: "${moduleName}" em "${fromFile}" - requer correção manual ou via IA`);
            } else {
                fixes.push(`[INFO] Pacote "${moduleName}" pode estar faltando - tente: pnpm add ${moduleName}`);
            }
        }
    }
    
    // Pattern 7: Pre-transform error genérico com CSS
    if (/Pre-transform error.*\.css/i.test(errorMessage)) {
        // Tenta fix genérico em todos os CSS do projeto
        const cssFiles = scanFilesRecursive(projectDir, ['.css']);
        for (const file of cssFiles) {
            try {
                let content = fs.readFileSync(file.abs, 'utf8');
                let changed = false;
                
                // Fix @layer sem @tailwind
                const hasLayer = /@layer\s+(base|components|utilities)/i.test(content);
                const hasTailwind = /@tailwind\s+(base|components|utilities)/i.test(content);
                
                if (hasLayer && !hasTailwind) {
                    const tailwindDirectives = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n';
                    const importRegex = /@import\s+[^;]+;/g;
                    let lastImportEnd = 0;
                    let m;
                    while ((m = importRegex.exec(content)) !== null) {
                        lastImportEnd = m.index + m[0].length;
                    }
                    
                    if (lastImportEnd > 0) {
                        content = content.slice(0, lastImportEnd) + '\n\n' + tailwindDirectives + content.slice(lastImportEnd);
                    } else {
                        content = tailwindDirectives + content;
                    }
                    changed = true;
                }
                
                // Fix @import after @tailwind
                const firstImportIdx = content.search(/@import\s+[^;]+;/);
                const firstTailwindIdx = content.search(/@tailwind\s+(base|components|utilities)\s*;/);
                if (firstImportIdx !== -1 && firstTailwindIdx !== -1 && firstTailwindIdx < firstImportIdx) {
                    const impRegex = /@import\s+[^;]+;/g;
                    const imports = [];
                    let mm;
                    while ((mm = impRegex.exec(content)) !== null) imports.push(mm[0]);
                    if (imports.length > 0) {
                        content = imports.join('\n') + '\n\n' + content.replace(impRegex, '').trimStart();
                        changed = true;
                    }
                }
                
                if (changed) {
                    fs.writeFileSync(file.abs, content, 'utf8');
                    fixes.push(`Auto-fix CSS aplicado em ${file.path}`);
                }
            } catch { /* skip */ }
        }
    }
    
    return fixes;
}

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
            if (!/<script.*src=.*main\.(tsx|ts|jsx|js)/i.test(html)) {
                issues.push('index.html não aponta para nenhum entry point (main.tsx/ts/jsx/js)');
                for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
                    if (fs.existsSync(path.join(projectDir, `src/main.${ext}`))) {
                        if (!html.includes(`/src/main.${ext}`)) {
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
                    const funcMatch = code.match(/(?:function|const)\s+(App)\s*[=(]/i);
                    const className = code.match(/class\s+(App)\s+/i);
                    const componentName = funcMatch?.[1] || className?.[1] || 'App';
                    
                    if (!code.includes(`export { ${componentName} }`)) {
                        code = code.trimEnd() + `\n\nexport default ${componentName};\n`;
                        fs.writeFileSync(appPath, code, 'utf8');
                        fixes.push(`Adicionado "export default ${componentName}" ao ${appFile}`);
                    } else {
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
            break;
        }
    }

    // 3. Verificar main.tsx/main.ts importa App corretamente
    for (const mainFile of ['src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/main.js']) {
        const mainPath = path.join(projectDir, mainFile);
        if (fs.existsSync(mainPath)) {
            try {
                let code = fs.readFileSync(mainPath, 'utf8');
                if (!code.includes('./App') && !code.includes("'./App'") && !code.includes('"./App"')) {
                    issues.push(`${mainFile} não importa App`);
                }
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
                const portMatch = code.match(/port\s*:\s*(\d+)/);
                if (portMatch && Number(portMatch[1]) === 8080) {
                    issues.push(`${configFile} usa porta 8080 (conflito com BuilderAI)`);
                    code = code.replace(/port\s*:\s*8080/, 'port: 8081');
                    fs.writeFileSync(configPath, code, 'utf8');
                    fixes.push(`Porta alterada de 8080 para 8081 no ${configFile}`);
                }
                if (!portMatch) {
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

    // 6. UNIVERSAL: Escanear TODOS os CSS recursivamente
    const allCssFiles = scanFilesRecursive(projectDir, ['.css']);
    for (const cssFileInfo of allCssFiles) {
        try {
            let cssContent = fs.readFileSync(cssFileInfo.abs, 'utf8');
            const hasLayer = /@layer\s+(base|components|utilities)/i.test(cssContent);
            const hasTailwindDirective = /@tailwind\s+(base|components|utilities)/i.test(cssContent);
            
            if (hasLayer && !hasTailwindDirective) {
                issues.push(`${cssFileInfo.path} usa @layer sem @tailwind directives`);
                
                const tailwindDirectives = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n';
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
                
                fs.writeFileSync(cssFileInfo.abs, cssContent, 'utf8');
                fixes.push(`Adicionado @tailwind base/components/utilities ao ${cssFileInfo.path}`);
            }

            // Verifica @import depois de @tailwind
            const firstImportIndex = cssContent.search(/@import\s+[^;]+;/);
            const firstTailwindIndex = cssContent.search(/@tailwind\s+(base|components|utilities)\s*;/);

            if (firstImportIndex !== -1 && firstTailwindIndex !== -1 && firstTailwindIndex < firstImportIndex) {
                issues.push(`${cssFileInfo.path} tem @import depois de @tailwind (deve vir antes de todas as declarações)`);

                const importRegex2 = /@import\s+[^;]+;/g;
                const imports = [];
                let m2;
                while ((m2 = importRegex2.exec(cssContent)) !== null) {
                    imports.push(m2[0]);
                }

                if (imports.length > 0) {
                    const cssWithoutImports = cssContent.replace(importRegex2, '').trimStart();
                    const newCss = `${imports.join('\n')}\n\n${cssWithoutImports}`;
                    fs.writeFileSync(cssFileInfo.abs, newCss, 'utf8');
                    cssContent = newCss;
                    fixes.push(`Reorganizado @import para o topo em ${cssFileInfo.path}`);
                }
            }
        } catch (e) {
            issues.push(`Erro ao verificar ${cssFileInfo.path}: ${e.message}`);
        }
    }

    // 7. Verificar se postcss.config e tailwind.config existem quando Tailwind é usado
    const usesTailwind = allCssFiles.some(f => {
        try {
            const c = fs.readFileSync(f.abs, 'utf8');
            return /@tailwind|@layer|@apply/i.test(c);
        } catch { return false; }
    });
    
    if (usesTailwind) {
        const postcssConfigs = ['postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs'];
        const hasPostcss = postcssConfigs.some(c => fs.existsSync(path.join(projectDir, c)));
        if (!hasPostcss) {
            issues.push('Projeto usa Tailwind mas não tem postcss.config');
            const postcssContent = `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`;
            fs.writeFileSync(path.join(projectDir, 'postcss.config.js'), postcssContent, 'utf8');
            fixes.push('Criado postcss.config.js');
        }
        
        const tailwindConfigs = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs'];
        const hasTailwindConfig = tailwindConfigs.some(c => fs.existsSync(path.join(projectDir, c)));
        if (!hasTailwindConfig) {
            issues.push('Projeto usa Tailwind mas não tem tailwind.config');
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
// SSE: Monitoramento contínuo de erros do Vite
// ============================================================
app.get('/watch-errors', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();
    
    // Registra o cliente SSE
    sseClients.push(res);
    
    // Envia heartbeat a cada 15 segundos
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15000);
    
    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients = sseClients.filter(c => c !== res);
    });
});

// Broadcast SSE para todos os clientes conectados
function broadcastSSE(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => {
        try { client.write(msg); } catch { /* skip dead clients */ }
    });
}

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

    // Limpa estado de erros ao iniciar novo dev
    viteErrorBuffer = [];
    processedErrors = new Set();

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
        child.stderr.on('data', (d) => {
            const text = d.toString();
            res.write(text);
            // Captura erros do stderr para monitoramento
            handleViteStderr(text, cwd);
        });
    }

    // === VALIDAÇÃO PRE-BUILD ===
    res.write('INFO: Validando projeto antes de iniciar...\n');
    try {
        const validation = validateAndFixProject(cwd);
        if (validation.fixes.length > 0) {
            for (const fix of validation.fixes) {
                res.write(`INFO: [AUTO-FIX] ${fix}\n`);
                broadcastSSE({ type: 'auto-fix', message: fix, autoFixed: true, file: extractFileFromFix(fix) });
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

// ============================================================
// Monitoramento de stderr do Vite com auto-fix
// ============================================================
let errorDebounceTimer = null;

function handleViteStderr(text, projectDir) {
    const ansi = /\x1B\[[0-?]*[ -/]*[@-~]/g;
    const cleaned = text.replace(ansi, '').trim();
    if (!cleaned) return;
    
    // Padrões de erro relevantes do Vite/PostCSS/TypeScript
    const errorPatterns = [
        /Pre-transform error/i,
        /Internal server error/i,
        /@layer.*no matching.*@tailwind/i,
        /`@layer base` is used but no matching/i,
        /Failed to resolve import/i,
        /Module not found/i,
        /Cannot find module/i,
        /error TS\d+/i,
        /SyntaxError/i,
        /RollupError/i,
        /postcss/i,
        /EADDRINUSE/i,
        /Unexpected token/i,
        /does not provide an export named/i,
    ];
    
    const isError = errorPatterns.some(p => p.test(cleaned));
    if (!isError) return;
    
    // Cria hash simples do erro para evitar processar duplicados
    const errorKey = cleaned.substring(0, 200);
    if (processedErrors.has(errorKey)) return;
    processedErrors.add(errorKey);
    
    // Debounce: espera 1s antes de tentar auto-fix
    clearTimeout(errorDebounceTimer);
    errorDebounceTimer = setTimeout(() => {
        const fixResults = autoFixViteError(cleaned, projectDir);
        
        if (fixResults.length > 0) {
            // Auto-fix aplicado com sucesso
            fixResults.forEach(fix => {
                console.log(`[AUTO-FIX] ${fix}`);
                broadcastSSE({ 
                    type: 'auto-fix', 
                    message: fix, 
                    autoFixed: true,
                    file: extractFileFromFix(fix),
                    originalError: cleaned.substring(0, 300)
                });
            });
        } else {
            // Não conseguiu auto-fix, reporta o erro
            broadcastSSE({ 
                type: 'error', 
                message: cleaned.substring(0, 500), 
                autoFixed: false,
                file: extractFileFromError(cleaned)
            });
        }
    }, 1000);
}

// Extrai nome do arquivo de uma mensagem de fix
function extractFileFromFix(fix) {
    const m = fix.match(/(?:em|ao|in)\s+(\S+\.\w+)/i);
    return m ? m[1] : null;
}

// Extrai nome do arquivo de uma mensagem de erro
function extractFileFromError(error) {
    const m = error.match(/([^\s:]+\.(css|tsx?|jsx?|ts|js)):\d+/i)
        || error.match(/File:\s*([^\s:]+)/i);
    if (m) {
        const fullPath = m[1].replace(/\\/g, '/');
        const srcIdx = fullPath.indexOf('/src/');
        return srcIdx >= 0 ? fullPath.substring(srcIdx + 1) : fullPath;
    }
    return null;
}

// ============================================================
// Rotas de gerenciamento de projeto
// ============================================================

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

    const textAllowed = /\.(tsx|ts|js|jsx|css|json|html|md|txt|yaml|yml|toml|env|gitignore|prettierrc|eslintrc|editorconfig)$/i;
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
                        try {
                            const code = fs.readFileSync(abs, 'latin1');
                            files.push({ path: normalizedRel, code, binary: false });
                        } catch (err2) {
                            console.warn('Falha com fallback encoding', abs, err2.message);
                        }
                    }
                } else if (binaryAllowed.test(entry.name)) {
                    try {
                        const stat = fs.statSync(abs);
                        files.push({ 
                            path: normalizedRel, 
                            code: '', 
                            binary: true,
                            size: stat.size,
                            assetUrl: `/project-assets/${projectName}/${normalizedRel}`
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

    if (currentProcess) {
        try {
            currentProcess.kill();
        } catch (e) {}
    }

    console.log(`Executando: ${command} em ${cwd}`);

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
        const text = data.toString();
        res.write(`STDERR: ${text}`);
        // Captura erros do stderr para monitoramento
        handleViteStderr(text, cwd);
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
    console.log(`Monitoramento SSE de erros em: http://localhost:${PORT}/watch-errors`);
});
