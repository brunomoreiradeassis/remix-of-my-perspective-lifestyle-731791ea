// ---------------------------------------------------------------------------
// projectScanner.ts
// Camada 2 & 4: Escaneamento do projeto existente + Motor de Contextualizacao
// Analisa a estrutura, dependencias, rotas, componentes, temas e configuracoes
// para fornecer contexto rico ao LLM antes de gerar planos.
// ---------------------------------------------------------------------------

export interface ProjectMetadata {
  // Dependencias
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | "unknown";

  // Estrutura
  routes: string[];
  pages: string[];
  components: string[];
  styles: string[];
  configs: string[];
  assets: string[];

  // Relacionamentos
  importMap: Record<string, string[]>; // arquivo -> imports
  exportMap: Record<string, string[]>; // arquivo -> exports
  dependencyGraph: Record<string, string[]>; // arquivo -> arquivos que dependem dele

  // Padroes detectados
  patterns: {
    hasRouter: boolean;
    routerType: string | null; // "react-router" | "next" | "tanstack-router" | null
    hasTailwind: boolean;
    hasTypeScript: boolean;
    stateManagement: string | null; // "zustand" | "redux" | "context" | null
    uiLibrary: string | null; // "shadcn" | "mui" | "antd" | null
    cssStrategy: string | null; // "tailwind" | "modules" | "styled" | "css" | null
  };

  // Resumo textual para o prompt
  summary: string;
}

// ---------------------------------------------------------------------------
// Extrai metadata do package.json (se existir)
// ---------------------------------------------------------------------------
function parsePackageJson(code: string): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  name: string;
} {
  try {
    const pkg = JSON.parse(code);
    return {
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
      scripts: pkg.scripts || {},
      name: pkg.name || "",
    };
  } catch {
    return { dependencies: {}, devDependencies: {}, scripts: {}, name: "" };
  }
}

// ---------------------------------------------------------------------------
// Detecta o package manager
// ---------------------------------------------------------------------------
function detectPackageManager(
  files: string[],
): "pnpm" | "npm" | "yarn" | "bun" | "unknown" {
  if (files.some((f) => f.endsWith("pnpm-lock.yaml"))) return "pnpm";
  if (files.some((f) => f.endsWith("yarn.lock"))) return "yarn";
  if (files.some((f) => f.endsWith("bun.lockb"))) return "bun";
  if (files.some((f) => f.endsWith("package-lock.json"))) return "npm";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Extrai imports de um arquivo TS/TSX/JS/JSX
// ---------------------------------------------------------------------------
function extractImports(code: string): string[] {
  const imports: string[] = [];
  const regex =
    /import\s+(?:(?:\{[^}]*\}|[\w*]+)(?:\s*,\s*(?:\{[^}]*\}|[\w*]+))?)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    imports.push(match[1]);
  }
  // dynamic imports
  const dynRegex = /import\(['"]([^'"]+)['"]\)/g;
  while ((match = dynRegex.exec(code)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

// ---------------------------------------------------------------------------
// Extrai exports de um arquivo
// ---------------------------------------------------------------------------
function extractExports(code: string): string[] {
  const exports: string[] = [];
  // export function X / export const X / export default function X
  const regex =
    /export\s+(?:default\s+)?(?:function|const|class|let|var|type|interface|enum)\s+(\w+)/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    exports.push(match[1]);
  }
  // export default anonymous
  if (/export\s+default\s+/.test(code) && exports.length === 0) {
    exports.push("default");
  }
  return exports;
}

// ---------------------------------------------------------------------------
// Resolve um import relativo para um caminho de arquivo no projeto
// ---------------------------------------------------------------------------
function resolveImportPath(
  importPath: string,
  fromFile: string,
  allFiles: string[],
): string | null {
  // Ignora pacotes npm (sem ./ ou ../ e sem @/)
  if (
    !importPath.startsWith(".") &&
    !importPath.startsWith("@/") &&
    !importPath.startsWith("~/")
  ) {
    return null;
  }

  // Converte @/ para src/
  let resolved = importPath;
  if (resolved.startsWith("@/")) {
    resolved = "src/" + resolved.slice(2);
  } else if (resolved.startsWith("~/")) {
    resolved = "src/" + resolved.slice(2);
  } else {
    // Resolve relativo
    const fromDir = fromFile.split("/").slice(0, -1).join("/");
    const parts = resolved.split("/");
    const dirParts = fromDir ? fromDir.split("/") : [];
    for (const part of parts) {
      if (part === "..") {
        dirParts.pop();
      } else if (part !== ".") {
        dirParts.push(part);
      }
    }
    resolved = dirParts.join("/");
  }

  // Tenta achar o arquivo com extensoes comuns
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];
  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (allFiles.includes(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// scanProject - funcao principal
// Recebe a lista de virtualFiles e retorna metadata completa
// ---------------------------------------------------------------------------
export function scanProject(
  virtualFiles: Array<{ path: string; code: string }>,
): ProjectMetadata {
  const allPaths = virtualFiles.map((f) => f.path);

  // Parse package.json
  const pkgFile = virtualFiles.find(
    (f) => f.path === "package.json" || f.path.endsWith("/package.json"),
  );
  const pkg = pkgFile
    ? parsePackageJson(pkgFile.code)
    : { dependencies: {}, devDependencies: {}, scripts: {}, name: "" };

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Classificar arquivos
  const routes: string[] = [];
  const pages: string[] = [];
  const components: string[] = [];
  const styles: string[] = [];
  const configs: string[] = [];
  const assets: string[] = [];

  for (const f of allPaths) {
    const lower = f.toLowerCase();
    if (/\.(css|scss|less|sass)$/i.test(f)) {
      styles.push(f);
    } else if (/\.(json|yaml|yml|toml|env|config\.\w+)$/i.test(f) || lower.includes("config")) {
      configs.push(f);
    } else if (
      /\.(png|jpg|jpeg|gif|svg|webp|ico|mp3|mp4|woff|woff2|ttf|eot)$/i.test(f)
    ) {
      assets.push(f);
    } else if (/src\/pages\//i.test(f) || /app\/.*page\.\w+$/i.test(f)) {
      pages.push(f);
    } else if (/src\/components\//i.test(f) || /components\//i.test(f)) {
      components.push(f);
    }

    // Detectar rotas (React Router)
    if (/route/i.test(f) || /router/i.test(f)) {
      routes.push(f);
    }
  }

  // Extrair paginas de rotas definidas em codigo
  for (const vf of virtualFiles) {
    if (/\.(tsx|ts|jsx|js)$/i.test(vf.path)) {
      const routeMatches = vf.code.matchAll(
        /path:\s*['"]([^'"]+)['"]/g,
      );
      for (const m of routeMatches) {
        if (!routes.includes(m[1])) routes.push(m[1]);
      }
    }
  }

  // Build import/export maps
  const importMap: Record<string, string[]> = {};
  const exportMap: Record<string, string[]> = {};
  const dependencyGraph: Record<string, string[]> = {};

  for (const vf of virtualFiles) {
    if (!/\.(tsx|ts|jsx|js)$/i.test(vf.path)) continue;

    const imports = extractImports(vf.code);
    const exports = extractExports(vf.code);

    importMap[vf.path] = imports;
    exportMap[vf.path] = exports;

    // Resolve cada import para um arquivo local
    for (const imp of imports) {
      const resolved = resolveImportPath(imp, vf.path, allPaths);
      if (resolved) {
        if (!dependencyGraph[resolved]) dependencyGraph[resolved] = [];
        if (!dependencyGraph[resolved].includes(vf.path)) {
          dependencyGraph[resolved].push(vf.path);
        }
      }
    }
  }

  // Detectar padroes
  const patterns = {
    hasRouter:
      "react-router-dom" in allDeps ||
      "react-router" in allDeps ||
      "@tanstack/react-router" in allDeps ||
      "next" in allDeps,
    routerType: "react-router-dom" in allDeps || "react-router" in allDeps
      ? "react-router"
      : "@tanstack/react-router" in allDeps
        ? "tanstack-router"
        : "next" in allDeps
          ? "next"
          : null,
    hasTailwind: "tailwindcss" in allDeps || styles.some((s) => /tailwind/i.test(s)),
    hasTypeScript:
      "typescript" in allDeps ||
      allPaths.some((p) => p.endsWith(".ts") || p.endsWith(".tsx")),
    stateManagement: "zustand" in allDeps
      ? "zustand"
      : "@reduxjs/toolkit" in allDeps || "redux" in allDeps
        ? "redux"
        : allPaths.some((p) => /context/i.test(p))
          ? "context"
          : null,
    uiLibrary: "@shadcn/ui" in allDeps || allPaths.some((p) => /components\/ui\//i.test(p))
      ? "shadcn"
      : "@mui/material" in allDeps
        ? "mui"
        : "antd" in allDeps
          ? "antd"
          : null,
    cssStrategy: "tailwindcss" in allDeps
      ? "tailwind"
      : "styled-components" in allDeps || "@emotion/styled" in allDeps
        ? "styled"
        : styles.some((s) => /\.module\./i.test(s))
          ? "modules"
          : styles.length > 0
            ? "css"
            : null,
  };

  // Gerar resumo textual
  const summaryParts: string[] = [];
  summaryParts.push(`Projeto: ${pkg.name || "sem nome"}`);
  summaryParts.push(
    `Stack: ${patterns.hasTypeScript ? "TypeScript" : "JavaScript"}${patterns.hasTailwind ? " + Tailwind" : ""}${patterns.routerType ? " + " + patterns.routerType : ""}${patterns.uiLibrary ? " + " + patterns.uiLibrary : ""}`,
  );
  summaryParts.push(`Arquivos: ${allPaths.length} total`);
  if (pages.length > 0) summaryParts.push(`Paginas (${pages.length}): ${pages.join(", ")}`);
  if (components.length > 0)
    summaryParts.push(
      `Componentes (${components.length}): ${components.join(", ")}`,
    );
  if (styles.length > 0) summaryParts.push(`Estilos (${styles.length}): ${styles.join(", ")}`);
  if (configs.length > 0) summaryParts.push(`Configs: ${configs.join(", ")}`);

  // Listar dependencias chave
  const keyDeps = Object.keys(allDeps).filter(
    (d) =>
      !d.startsWith("@types/") &&
      !["typescript", "vite", "eslint", "prettier"].includes(d),
  );
  if (keyDeps.length > 0) {
    summaryParts.push(`Dependencias principais: ${keyDeps.slice(0, 20).join(", ")}`);
  }

  // Mostrar grafo de dependencias (arquivos mais dependidos)
  const depEntries = Object.entries(dependencyGraph)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  if (depEntries.length > 0) {
    summaryParts.push("Arquivos mais referenciados:");
    for (const [file, deps] of depEntries) {
      summaryParts.push(`  ${file} (usado por ${deps.length} arquivo${deps.length > 1 ? "s" : ""})`);
    }
  }

  // Listar patterns
  if (patterns.stateManagement)
    summaryParts.push(`State management: ${patterns.stateManagement}`);
  if (patterns.cssStrategy) summaryParts.push(`CSS strategy: ${patterns.cssStrategy}`);

  return {
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
    packageManager: detectPackageManager(allPaths),
    routes,
    pages,
    components,
    styles,
    configs,
    assets,
    importMap,
    exportMap,
    dependencyGraph,
    patterns,
    summary: summaryParts.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// analyzeImpact - dado um plano de modificacoes, detecta arquivos afetados
// que podem precisar ser atualizados em cascata
// ---------------------------------------------------------------------------
export function analyzeImpact(
  meta: ProjectMetadata,
  filesToModify: string[],
  filesToDelete: string[],
): { cascadeFiles: string[]; warnings: string[] } {
  const cascadeFiles: string[] = [];
  const warnings: string[] = [];

  // Para cada arquivo a ser modificado/deletado, checar quem depende dele
  for (const file of [...filesToModify, ...filesToDelete]) {
    const dependents = meta.dependencyGraph[file] || [];
    for (const dep of dependents) {
      if (
        !filesToModify.includes(dep) &&
        !filesToDelete.includes(dep) &&
        !cascadeFiles.includes(dep)
      ) {
        cascadeFiles.push(dep);
      }
    }
  }

  // Alertas para arquivos a serem deletados que possuem dependentes
  for (const file of filesToDelete) {
    const dependents = meta.dependencyGraph[file] || [];
    if (dependents.length > 0) {
      warnings.push(
        `AVISO: Excluir "${file}" vai quebrar: ${dependents.join(", ")}`,
      );
    }
  }

  return { cascadeFiles, warnings };
}

// ---------------------------------------------------------------------------
// generateDiffSummary - cria um resumo diff entre conteudo antigo e novo
// ---------------------------------------------------------------------------
export function generateDiffSummary(
  oldCode: string,
  newCode: string,
  filePath: string,
): string {
  const oldLines = oldCode.split("\n");
  const newLines = newCode.split("\n");

  const added = newLines.filter((l) => !oldLines.includes(l)).length;
  const removed = oldLines.filter((l) => !newLines.includes(l)).length;
  const unchanged = newLines.filter((l) => oldLines.includes(l)).length;

  return `${filePath}: +${added} -${removed} ~${unchanged} linhas`;
}

// ---------------------------------------------------------------------------
// searchFilesByKeyword - busca nos arquivos por palavras-chave do prompt
// Retorna os arquivos mais relevantes com pontuacao de relevancia
// ---------------------------------------------------------------------------
export function searchFilesByKeyword(
  virtualFiles: Array<{ path: string; code: string }>,
  keywords: string[],
  maxResults = 10,
): Array<{ path: string; code: string; score: number; matchedKeywords: string[] }> {
  if (keywords.length === 0 || virtualFiles.length === 0) return [];

  const results: Array<{ path: string; code: string; score: number; matchedKeywords: string[] }> = [];

  for (const vf of virtualFiles) {
    // Skip node_modules, dist, etc
    if (/node_modules|\.git|dist|\.vite/i.test(vf.path)) continue;

    const lowerCode = vf.code.toLowerCase();
    const lowerPath = vf.path.toLowerCase();
    let score = 0;
    const matchedKeywords: string[] = [];

    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase();
      
      // Match no path (alta prioridade)
      if (lowerPath.includes(lowerKw)) {
        score += 10;
        if (!matchedKeywords.includes(kw)) matchedKeywords.push(kw);
      }
      
      // Match no nome do arquivo (altissima prioridade)
      const filename = vf.path.split("/").pop()?.toLowerCase() || "";
      if (filename.includes(lowerKw)) {
        score += 20;
        if (!matchedKeywords.includes(kw)) matchedKeywords.push(kw);
      }
      
      // Match no conteudo
      const codeMatches = lowerCode.split(lowerKw).length - 1;
      if (codeMatches > 0) {
        score += Math.min(codeMatches, 5); // Max 5 pontos por keyword no codigo
        if (!matchedKeywords.includes(kw)) matchedKeywords.push(kw);
      }
      
      // Match em imports (media prioridade)
      if (lowerCode.includes(`import`) && lowerCode.includes(lowerKw)) {
        score += 3;
      }
      
      // Match em exports (media prioridade)
      if (lowerCode.includes(`export`) && lowerCode.includes(lowerKw)) {
        score += 3;
      }
    }

    if (score > 0) {
      results.push({ path: vf.path, code: vf.code, score, matchedKeywords });
    }
  }

  // Ordena por pontuacao decrescente
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, maxResults);
}
