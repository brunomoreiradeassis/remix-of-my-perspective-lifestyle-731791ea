import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { 
  getDirectoryHandle, 
  saveDirectoryHandle, 
  clearDirectoryHandle, 
  getAllDirectoryHandles, 
  openDB,
  removeDirectoryHandle 
} from "@/lib/db";
import { toast } from "@/components/ui/use-toast";

interface OllamaModel {
  name: string;
  size: string;
  modified_at: string;
}

interface OllamaConfig {
  baseUrl: string;
  selectedModel: string;
  temperature: number;
  maxTokens: number;
}

interface OllamaContextType {
  isConnected: boolean;
  isChecking: boolean;
  latencyMs: number | null;
  connectionAttempts: number;
  lastConnectionError: string | null;
  config: OllamaConfig;
  models: OllamaModel[];
  updateConfig: (partial: Partial<OllamaConfig>) => void;
  checkConnection: () => Promise<boolean>;
  previewCode: string | null;
  setPreviewCode: (code: string | null) => void;
  pushPreviewCode: (code: string) => void;
  undoPreview: () => void;
  redoPreview: () => void;
  previewHistory: string[];
  previewIndex: number;
  virtualFiles: Array<{ path: string; code: string; ai: boolean; binary?: boolean }>;
  addVirtualFile: (path: string, code: string, ai?: boolean) => void;
  updateVirtualFile: (path: string, code: string) => void;
  renameVirtualFile: (oldPath: string, newPath: string) => Promise<void>;
  deleteVirtualFile: (path: string) => void;
  moveVirtualFile: (oldPath: string, newPath: string) => Promise<void>;
  deleteFolderRemote: (folderPath: string) => Promise<void>;
  createFileRemote: (filePath: string, content?: string) => Promise<void>;
  dirHandle: FileSystemDirectoryHandle | null;
  projectPath: string | null;
  devServerUrl: string | null;
  devServerPort: number | null;
  setManualPort: (port: number) => void;
  nodeModulesAvailable: boolean;
  openDirectory: () => Promise<void>;
  openRecentDirectory: (handle: FileSystemDirectoryHandle, path?: string) => Promise<void>;
  refreshFiles: () => Promise<void>;
  recentProjects: Array<{ name: string; handle: FileSystemDirectoryHandle; path?: string }>;
  removeRecentProject: (name: string) => void;
  runProjectCommands: () => Promise<void>;
  commandProgress: {
    status: "idle" | "checking" | "installing" | "installing-force" | "starting" | "running" | "error";
    progress: number;
    message: string;
  };
  consoleErrors: string[];
  addConsoleError: (error: string) => void;
  clearConsoleErrors: () => void;
  buildErrors: string[];
  addBuildError: (error: string) => void;
  clearBuildErrors: () => void;
  allErrors: Array<{ type: "build" | "console"; message: string }>;
  pendingErrorFix: string | null;
  setPendingErrorFix: (msg: string | null) => void;
  runBuildCheck: () => Promise<void>;
  nukeNodeModules: () => Promise<void>;
  installDependency: (pkg: string) => Promise<void>;
  isFixingErrors: boolean;
  autoFixLog: Array<{ message: string; file: string | null; timestamp: string }>;
  clearAutoFixLog: () => void;
  projectComponents: string[];
  projectTemplate: string;
  lastPrompt: string | null;
  setLastPrompt: (p: string | null) => void;
  lastError: string | null;
  setLastError: (e: string | null) => void;
  currentFile: string | null;
  setCurrentFile: (p: string | null) => void;
  // Chat session management
  chatSessions: Array<{ id: string; title: string; updatedAt: string }>;
  currentChatId: string | null;
  setCurrentChatId: (id: string | null) => void;
  saveChatSession: (chatId: string, title: string, messages: any[]) => Promise<void>;
  loadChatSession: (chatId: string) => Promise<any[] | null>;
  loadChatSessions: () => Promise<void>;
  projectName: string | null;
  // Terminal integrado
  terminalLines: Array<{ text: string; type: "stdout" | "stderr" | "info" | "error" | "system" }>;
  terminalRunning: boolean;
  terminalHistory: string[];
  runTerminalCommand: (cmd: string, cwdOverride?: string) => Promise<void>;
  killProcess: () => Promise<void>;
  clearTerminal: () => void;
  serverOnline: boolean;
}

const defaultConfig: OllamaConfig = {
  baseUrl: "http://localhost:11434",
  selectedModel: "",
  temperature: 0.7,
  maxTokens: 8192,
};

const OllamaContext = createContext<OllamaContextType | null>(null);

export function OllamaProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const checkConnectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCheckingRef = useRef(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [lastConnectionError, setLastConnectionError] = useState<string | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [previewHistory, setPreviewHistory] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number>(-1);
  const [virtualFiles, setVirtualFiles] = useState<Array<{ path: string; code: string; ai: boolean; binary?: boolean }>>([]);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Terminal integrado
  const [terminalLines, setTerminalLines] = useState<Array<{ text: string; type: "stdout" | "stderr" | "info" | "error" | "system" }>>([]);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("terminal-history") || "[]"); } catch { return []; }
  });
  const [serverOnline, setServerOnline] = useState(false);
  const [currentFileState, setCurrentFileState] = useState<string | null>(() => {
    const saved = localStorage.getItem("current-file");
    return saved ? saved : null;
  });
  const currentFile = currentFileState;

  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(() => localStorage.getItem("current-project-path"));
  const [devServerUrl, setDevServerUrl] = useState<string | null>(() => {
    const saved = localStorage.getItem("last-preview-url");
    // Nunca restaurar a porta 8080 (porta do proprio sistema)
    if (saved && /localhost:8080/i.test(saved)) return null;
    return saved;
  });
  const [devServerPort, setDevServerPort] = useState<number | null>(() => {
    const p = localStorage.getItem("last-preview-port");
    if (p && Number(p) === 8080) return null;
    return p ? Number(p) : null;
  });
  const [nodeModulesAvailable, setNodeModulesAvailable] = useState(false);
  const [recentProjects, setRecentProjects] = useState<Array<{ name: string; handle: FileSystemDirectoryHandle; path?: string }>>([]);
  const [commandProgress, setCommandProgress] = useState<{
    status: "idle" | "checking" | "installing" | "installing-force" | "starting" | "running" | "error";
    progress: number;
    message: string;
  }>({ status: "idle", progress: 0, message: "" });
  const [consoleErrors, setConsoleErrors] = useState<string[]>([]);
  const [pendingErrorFix, setPendingErrorFix] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; updatedAt: string }>>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(() => localStorage.getItem("current-chat-id"));

  const derivedProjectName = dirHandle?.name || (() => {
    if (projectPath) {
      const parts = projectPath.replace(/\\+/g, '/').split('/');
      return parts[parts.length - 1] || parts[parts.length - 2] || null;
    }
    return null;
  })();

  const setManualPort = useCallback((port: number) => {
    const url = `http://localhost:${port}/`;
    setDevServerUrl(url);
    setDevServerPort(port);
    setCommandProgress({ status: "running", progress: 100, message: "Servidor dev rodando!" });
    localStorage.setItem("last-preview-url", url);
    localStorage.setItem("last-preview-port", String(port));
    window.dispatchEvent(new StorageEvent("storage", { key: "last-preview-url", newValue: url }));
  }, []);

  const addConsoleError = useCallback((error: string) => {
    setConsoleErrors(prev => {
      if (prev.includes(error)) return prev;
      return [...prev, error];
    });
  }, []);

  const clearConsoleErrors = useCallback(() => {
    setConsoleErrors([]);
  }, []);

  const [buildErrors, setBuildErrors] = useState<string[]>([]);
  const [isFixingErrors, setIsFixingErrors] = useState(false);
  const [autoFixLog, setAutoFixLog] = useState<Array<{ message: string; file: string | null; timestamp: string }>>([]);

  const addBuildError = useCallback((error: string) => {
    setBuildErrors(prev => {
      if (prev.includes(error)) return prev;
      return [...prev, error];
    });
  }, []);

  const clearBuildErrors = useCallback(() => {
    setBuildErrors([]);
  }, []);

  const clearAutoFixLog = useCallback(() => {
    setAutoFixLog([]);
  }, []);

  // Combina todos os erros em uma lista unificada
  const allErrors = useMemo(() => {
    const items: Array<{ type: "build" | "console"; message: string }> = [];
    buildErrors.forEach(e => items.push({ type: "build", message: e }));
    consoleErrors.forEach(e => items.push({ type: "console", message: e }));
    return items;
  }, [buildErrors, consoleErrors]);

  // Verifica erros de build rodando `pnpm run build` ou `npx tsc --noEmit`
  const runBuildCheck = useCallback(async () => {
    const pName = dirHandle?.name || derivedProjectName;
    const cwd = projectPath || (pName ? `d:\\AI-Projetos\\BuilderAI\\Projetos\\${pName}` : null);
    if (!cwd) return;

    try {
      const statusRes = await fetch("http://localhost:3001/status").catch(() => null);
      if (!statusRes?.ok) return;

      let platform = "win32";
      try {
        const json = await statusRes.json();
        if (json && typeof json.platform === "string") {
          platform = json.platform;
        }
      } catch {}

      clearBuildErrors();

      const ansi = /\x1B\[[0-?]*[ -/]*[@-~]/g;
      const errorPattern = /error TS\d+|Cannot find|is not assignable|has no exported member|Module.*not found|Unexpected token|Failed to resolve import|plugin:vite:import-analysis|RollupError|Does the file exist\?/i;

      const runAndCollect = async (command: string) => {
        const res = await fetch("http://localhost:3001/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, cwd })
        });
        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value);
        }

        const lines = buffer.replace(ansi, "").split(/\r?\n/);
        const errorLines = lines.filter(l => {
          const cleaned = l.replace(/^(STDOUT|STDERR):\s?/, "").trim();
          return errorPattern.test(cleaned) && cleaned.length > 10;
        });
        errorLines.forEach(l => {
          const cleaned = l.replace(/^(STDOUT|STDERR):\s?/, "").trim();
          addBuildError(cleaned);
        });
      };

      await runAndCollect("npx tsc --noEmit 2>&1; exit 0");

      const viteCommand =
        platform === "win32"
          ? "if (Test-Path pnpm-lock.yaml) { pnpm run build } elseif (Test-Path package-lock.json) { npm run build } elseif (Test-Path yarn.lock) { yarn build } elseif (Test-Path bun.lockb) { bun run build } else { npm run build } 2>&1; exit 0"
          : "if [ -f pnpm-lock.yaml ]; then pnpm run build; elif [ -f package-lock.json ]; then npm run build; elif [ -f yarn.lock ]; then yarn build; elif [ -f bun.lockb ]; then bun run build; else npm run build; fi 2>&1; exit 0";

      await runAndCollect(viteCommand);
    } catch (e) {
      console.error("Build check failed:", e);
    }
  }, [dirHandle, derivedProjectName, projectPath, clearBuildErrors, addBuildError]);

  const ansiRegex = useMemo(() => /\x1B\[[0-?]*[ -/]*[@-~]/g, []);

  const clearTerminal = useCallback(() => {
    setTerminalLines([]);
  }, []);

  const killProcess = useCallback(async () => {
    try {
      await fetch("http://localhost:3001/kill-process", { method: "POST", headers: { "Content-Type": "application/json" } });
      setTerminalLines(prev => [...prev, { text: "[Processo encerrado pelo usuario]", type: "system" }]);
      setTerminalRunning(false);
    } catch {
      setTerminalLines(prev => [...prev, { text: "[Erro ao encerrar processo]", type: "error" }]);
    }
  }, []);

  const runTerminalCommand = useCallback(async (cmd: string, cwdOverride?: string) => {
    const pName = dirHandle?.name || derivedProjectName;
    const cwd = cwdOverride || projectPath || (pName ? `d:\\AI-Projetos\\BuilderAI\\Projetos\\${pName}` : null);

    if (!cwd) {
      setTerminalLines(prev => [...prev, { text: "Nenhum projeto aberto. Abra uma pasta primeiro.", type: "error" }]);
      return;
    }
    if (!serverOnline) {
      setTerminalLines(prev => [...prev, { text: "Servidor offline. Rode: node scripts/command-server.cjs", type: "error" }]);
      return;
    }

    // Mata processo anterior se estiver rodando
    if (terminalRunning) {
      await killProcess();
      await new Promise(r => setTimeout(r, 300));
    }

    // Adiciona ao historico
    setTerminalHistory(prev => {
      const next = [cmd, ...prev.filter(c => c !== cmd)].slice(0, 30);
      try { localStorage.setItem("terminal-history", JSON.stringify(next)); } catch {}
      return next;
    });

    // Linha com o prompt
    const ts = new Date().toLocaleTimeString("pt-BR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setTerminalLines(prev => [...prev, { text: `${ts}  $ ${cmd}`, type: "system" }]);
    setTerminalRunning(true);

    let buffer = "";
    try {
      const res = await fetch("http://localhost:3001/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, cwd })
      });
      if (!res.ok || !res.body) throw new Error("Falha ao iniciar execucao");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const raw of lines) {
          let cleaned = raw.replace(ansiRegex, "").trim();
          if (!cleaned) continue;

          let type: "stdout" | "stderr" | "info" | "error" | "system" = "stdout";

          if (cleaned.startsWith("STDERR:")) {
            cleaned = cleaned.replace(/^STDERR:\s?/, "");
            type = /error|fail|ERR!/i.test(cleaned) ? "error" : "stderr";
          } else if (cleaned.startsWith("STDOUT:")) {
            cleaned = cleaned.replace(/^STDOUT:\s?/, "");
          } else if (cleaned.startsWith("CLOSE:")) {
            const code = cleaned.replace(/^CLOSE:\s?/, "").trim();
            type = "system";
            cleaned = `[Processo finalizado: codigo ${code}]`;
          } else if (cleaned.startsWith("ERROR:")) {
            type = "error";
          } else if (cleaned.startsWith("INFO:") || cleaned.startsWith("INSTALL_CLOSE:")) {
            cleaned = cleaned.replace(/^(INFO|INSTALL_CLOSE):\s?/, "");
            type = "info";
          }

          // Detecta erros de build/vite no output do terminal e adiciona ao diagnostico
          const terminalErrorPattern = /Failed to resolve import|plugin:vite:import-analysis|Cannot find module|Module not found|error TS\d+|Does the file exist|RollupError|SyntaxError|Unexpected token/i;
          if (terminalErrorPattern.test(cleaned) && cleaned.length > 15) {
            addBuildError(cleaned);
          }

          // Atualiza progresso automaticamente baseado no output do terminal
          const lowerCleaned = cleaned.toLowerCase();
          if (/pnpm install|npm install|yarn install|installing|lockfile|resolving|added \d+ packages/.test(lowerCleaned)) {
            setCommandProgress(prev => {
              if (prev.status === "idle") return prev;
              const newProgress = Math.min(prev.progress + 5, 60);
              return { ...prev, status: "installing", progress: newProgress, message: "Instalando dependencias..." };
            });
          }
          if (/pnpm run dev|npm run dev|yarn dev|bun dev|vite|starting|dev server/.test(lowerCleaned)) {
            setCommandProgress(prev => {
              if (prev.status === "idle") return prev;
              return { ...prev, status: "starting", progress: 80, message: "Iniciando servidor dev..." };
            });
          }
          if (/ready in|local:\s*http|network:\s*http|hmr ready|compiled successfully/.test(lowerCleaned)) {
            setCommandProgress(prev => {
              if (prev.status === "idle") return prev;
              return { ...prev, status: "running", progress: 100, message: "Servidor dev rodando!" };
            });
          }
          if (/INSTALL_CLOSE|added \d+ packages|up to date/.test(cleaned)) {
            setCommandProgress(prev => {
              if (prev.status === "idle") return prev;
              return { ...prev, status: "installing", progress: 65, message: "Dependencias instaladas. Iniciando dev..." };
            });
          }

          // Detecta URL do dev server
          const SYSTEM_PORT = 8080;
          const urlMatch = cleaned.match(/http:\/\/localhost:(\d{2,5})/i) || cleaned.match(/http:\/\/127\.0\.0\.1:(\d{2,5})/i);
          if (urlMatch && Number(urlMatch[1]) !== SYSTEM_PORT) {
            const url = `http://localhost:${urlMatch[1]}/`;
            try {
              localStorage.setItem("last-preview-url", url);
              localStorage.setItem("last-preview-port", urlMatch[1]);
              setDevServerUrl(url);
              setDevServerPort(Number(urlMatch[1]));
              window.dispatchEvent(new StorageEvent("storage", { key: "last-preview-url", newValue: url }));
              setCommandProgress({ status: "running", progress: 100, message: "Servidor dev rodando!" });
            } catch { /* noop */ }
            type = "info";
          }

          setTerminalLines(prev => {
            const next = [...prev, { text: cleaned, type }];
            // Limita a 500 linhas para performance
            return next.length > 500 ? next.slice(-500) : next;
          });
        }
      }

      // Flush do buffer restante
      if (buffer.trim()) {
        const cleaned = buffer.replace(ansiRegex, "").replace(/^(STDOUT|STDERR):\s?/, "").trim();
        if (cleaned) {
          setTerminalLines(prev => [...prev, { text: cleaned, type: "stdout" }]);
        }
      }
    } catch (e: any) {
      setTerminalLines(prev => [...prev, { text: `ERRO: ${e.message || "Falha desconhecida"}`, type: "error" }]);
      setCommandProgress({ status: "error", progress: 0, message: `Erro: ${e.message || "Falha"}` });
    } finally {
      setTerminalRunning(false);
    }
  }, [dirHandle, derivedProjectName, projectPath, serverOnline, terminalRunning, killProcess, ansiRegex, addBuildError, setCommandProgress]);

  // Apaga node_modules e reinstala - agora via terminal centralizado
  const nukeNodeModules = useCallback(async () => {
    toast({ title: "Limpando node_modules", description: "Removendo e reinstalando via terminal..." });
    setCommandProgress({ status: "installing", progress: 10, message: "Removendo node_modules..." });
    await runTerminalCommand("Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue; pnpm install");
    setCommandProgress({ status: "idle", progress: 0, message: "" });
  }, [runTerminalCommand, setCommandProgress]);

  // Instala um pacote especifico - agora via terminal centralizado
  const installDependency = useCallback(async (pkg: string) => {
    toast({ title: "Instalando", description: `Instalando ${pkg} via terminal...` });
    await runTerminalCommand(`pnpm add ${pkg}`);
  }, [runTerminalCommand]);

  // Ping servidor periodicamente
  useEffect(() => {
    const ping = async () => {
      try {
        const r = await fetch("http://localhost:3001/status").catch(() => null);
        setServerOnline(!!r?.ok);
      } catch { setServerOnline(false); }
    };
    ping();
    const interval = setInterval(ping, 15000);
    return () => clearInterval(interval);
  }, []);

  // SSE: Monitoramento contínuo de erros do Vite via /watch-errors
  useEffect(() => {
    if (!serverOnline) return;
    
    let es: EventSource | null = null;
    try {
      es = new EventSource("http://localhost:3001/watch-errors");
      
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'auto-fix') {
            setAutoFixLog(prev => [...prev, { 
              message: data.message, 
              file: data.file || null, 
              timestamp: new Date().toISOString() 
            }]);
            toast({
              title: "Auto-Fix aplicado",
              description: data.message,
              duration: 4000,
            });
          } else if (data.type === 'error') {
            addBuildError(data.message);
          }
        } catch { /* skip malformed data */ }
      };
      
      es.onerror = () => {
        // EventSource auto-reconnects
      };
    } catch { /* SSE not available */ }
    
    return () => {
      if (es) es.close();
    };
  }, [serverOnline, addBuildError]);

  // Limpar qualquer referencia salva a porta 8080 (porta do sistema)
  useEffect(() => {
    const savedUrl = localStorage.getItem("last-preview-url");
    const savedPort = localStorage.getItem("last-preview-port");
    if (savedUrl && /localhost:8080/i.test(savedUrl)) {
      localStorage.removeItem("last-preview-url");
    }
    if (savedPort && savedPort === "8080") {
      localStorage.removeItem("last-preview-port");
    }
  }, []);

  // Captura global de erros do window (console errors)
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const msg = `${event.message} (${event.filename || "unknown"}:${event.lineno || 0}:${event.colno || 0})`;
      addConsoleError(msg);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason instanceof Error
        ? `Unhandled Promise: ${reason.message}`
        : `Unhandled Promise: ${String(reason)}`;
      addConsoleError(msg);
    };
    const handlePostMessage = (event: MessageEvent) => {
      if (event.data && typeof event.data === "object" && event.data.type === "iframe-error") {
        addConsoleError(`[iframe] ${event.data.message || "Unknown iframe error"}`);
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    window.addEventListener("message", handlePostMessage);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
      window.removeEventListener("message", handlePostMessage);
    };
  }, [addConsoleError]);

  // On startup: NÃO restaurar arquivos automaticamente. Explorer começa vazio.
  // Apenas carrega a lista de projetos recentes para o modal.
  useEffect(() => {
    async function init() {
      try {
        // Limpa qualquer estado persistido de sessão anterior
        setVirtualFiles([]);
        setDirHandle(null);
        setProjectPath(null);
        setCurrentFileState(null);
        localStorage.removeItem("current-project-path");
        localStorage.removeItem("current-file");

        // Carrega apenas a lista de recentes para o modal
        const allHandles = await getAllDirectoryHandles();
        setRecentProjects(allHandles);
      } catch (e) {
        console.error("Error during init:", e);
      }
    }
    init();
  }, []);

  // Smart dev: uses /smart-dev endpoint instead of PowerShell commands
  const startSmartDev = useCallback(async (cwd: string) => {
    if (!serverOnline) {
      setTerminalLines(prev => [...prev, { text: "Servidor offline. Rode: node scripts/command-server.cjs", type: "error" }]);
      return;
    }

    // Kill previous process
    if (terminalRunning) {
      await killProcess();
      await new Promise(r => setTimeout(r, 300));
    }

    // Validação removida aqui - o /smart-dev já faz a validação internamente
    setCommandProgress({ status: "checking", progress: 5, message: "Verificando dependências..." });
    setTerminalRunning(true);

    const ts = new Date().toLocaleTimeString("pt-BR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setTerminalLines(prev => [...prev, { text: `${ts}  $ smart-dev (${cwd})`, type: "system" }]);

    let buffer = "";
    try {
      const res = await fetch("http://localhost:3001/smart-dev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd })
      });
      if (!res.ok || !res.body) throw new Error("Falha ao iniciar smart-dev");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const raw of lines) {
          let cleaned = raw.replace(ansiRegex, "").trim();
          if (!cleaned) continue;

          let type: "stdout" | "stderr" | "info" | "error" | "system" = "stdout";

          if (cleaned.startsWith("STDERR:")) {
            cleaned = cleaned.replace(/^STDERR:\s?/, "");
            type = /error|fail|ERR!/i.test(cleaned) ? "error" : "stderr";
          } else if (cleaned.startsWith("STDOUT:")) {
            cleaned = cleaned.replace(/^STDOUT:\s?/, "");
          } else if (cleaned.startsWith("CLOSE:")) {
            const code = cleaned.replace(/^CLOSE:\s?/, "").trim();
            type = "system";
            cleaned = `[Processo finalizado: codigo ${code}]`;
          } else if (cleaned.startsWith("ERROR:")) {
            type = "error";
          } else if (cleaned.startsWith("INFO:") || cleaned.startsWith("INSTALL_CLOSE:")) {
            cleaned = cleaned.replace(/^(INFO|INSTALL_CLOSE):\s?/, "");
            type = "info";
          }

          // Detect build errors
          const terminalErrorPattern = /Failed to resolve import|plugin:vite:import-analysis|Cannot find module|Module not found|error TS\d+|Does the file exist|RollupError|SyntaxError|Unexpected token/i;
          if (terminalErrorPattern.test(cleaned) && cleaned.length > 15) {
            addBuildError(cleaned);
          }

          // Update progress
          const lowerCleaned = cleaned.toLowerCase();
          if (/pnpm install|npm install|yarn install|installing|lockfile|resolving|added \d+ packages/.test(lowerCleaned)) {
            setCommandProgress(prev => {
              if (prev.status === "idle") return prev;
              const newProgress = Math.min(prev.progress + 5, 60);
              return { ...prev, status: "installing", progress: newProgress, message: "Instalando dependencias..." };
            });
          }
          if (/pnpm run dev|npm run dev|yarn dev|bun dev|vite|starting|dev server/.test(lowerCleaned)) {
            setCommandProgress(prev => {
              if (prev.status === "idle") return prev;
              return { ...prev, status: "starting", progress: 80, message: "Iniciando servidor dev..." };
            });
          }
          if (/ready in|local:\s*http|network:\s*http|hmr ready|compiled successfully/.test(lowerCleaned)) {
            setCommandProgress(prev => {
              if (prev.status === "idle") return prev;
              return { ...prev, status: "running", progress: 100, message: "Servidor dev rodando!" };
            });
          }
          if (/INSTALL_CLOSE|added \d+ packages|up to date|node_modules encontrado/.test(cleaned)) {
            setCommandProgress(prev => {
              if (prev.status === "idle") return prev;
              return { ...prev, status: "installing", progress: 65, message: "Dependencias OK. Iniciando dev..." };
            });
          }

          // Detect dev server URL
          const SYSTEM_PORT = 8080;
          const urlMatch = cleaned.match(/http:\/\/localhost:(\d{2,5})/i) || cleaned.match(/http:\/\/127\.0\.0\.1:(\d{2,5})/i);
          if (urlMatch && Number(urlMatch[1]) !== SYSTEM_PORT) {
            const url = `http://localhost:${urlMatch[1]}/`;
            try {
              localStorage.setItem("last-preview-url", url);
              localStorage.setItem("last-preview-port", urlMatch[1]);
              setDevServerUrl(url);
              setDevServerPort(Number(urlMatch[1]));
              window.dispatchEvent(new StorageEvent("storage", { key: "last-preview-url", newValue: url }));
              setCommandProgress({ status: "running", progress: 100, message: "Servidor dev rodando!" });
            } catch { /* noop */ }
            type = "info";
          }

          setTerminalLines(prev => {
            const next = [...prev, { text: cleaned, type }];
            return next.length > 500 ? next.slice(-500) : next;
          });
        }
      }

      if (buffer.trim()) {
        const cleaned = buffer.replace(ansiRegex, "").trim();
        if (cleaned) {
          setTerminalLines(prev => [...prev, { text: cleaned, type: "stdout" }]);
        }
      }
    } catch (e: any) {
      setTerminalLines(prev => [...prev, { text: `ERRO: ${e.message || "Falha desconhecida"}`, type: "error" }]);
      setCommandProgress({ status: "error", progress: 0, message: `Erro: ${e.message || "Falha"}` });
    } finally {
      setTerminalRunning(false);
    }
  }, [serverOnline, terminalRunning, killProcess, ansiRegex, addBuildError]);

  // Helper: verifica se o dev server já está rodando e acessível
  const isDevServerAlive = useCallback(async (): Promise<boolean> => {
    if (!devServerUrl) return false;
    try {
      const res = await fetch(devServerUrl, { method: "HEAD", mode: "no-cors" });
      return true; // no-cors sempre retorna opaque, mas se não lançar exceção, está acessível
    } catch {
      return false;
    }
  }, [devServerUrl]);

  const runProjectCommands = useCallback(async () => {
    if (!dirHandle) return;
    const cwd = projectPath || `d:\\AI-Projetos\\BuilderAI\\Projetos\\${dirHandle.name}`;
    
    // Se o dev server já está rodando, apenas recarrega o preview
    const alive = await isDevServerAlive();
    if (alive && commandProgress.status === "running") {
      // Dispara reload no preview via evento
      window.dispatchEvent(new StorageEvent("storage", { key: "last-preview-url", newValue: devServerUrl }));
      toast({ title: "Preview recarregado", description: "O servidor já estava rodando." });
      return;
    }

    try {
      await startSmartDev(cwd);
      toast({ 
        title: "Projeto iniciado", 
        description: "Acompanhe o progresso no painel Terminal.",
      });
    } catch (e: any) {
      setCommandProgress({ status: "error", progress: 0, message: `Erro: ${e.message}` });
      toast({
        title: "Erro de Execucao",
        description: e.message,
        variant: "destructive"
      });
    }
  }, [dirHandle, projectPath, startSmartDev, isDevServerAlive, commandProgress.status, devServerUrl]);

  // Limpa todo o estado do projeto anterior antes de carregar um novo
  const resetProjectState = useCallback(async () => {
    // 1. Mata qualquer processo rodando no terminal (pnpm run dev, etc.)
    if (terminalRunning) {
      try {
        await killProcess();
        await new Promise(r => setTimeout(r, 500));
      } catch { /* silently fail */ }
    }

    // 2. Limpa virtual files do projeto anterior
    setVirtualFiles([]);

    // 3. Limpa estado do terminal
    setTerminalLines([{ text: "[Projeto anterior encerrado. Carregando novo projeto...]", type: "system" }]);

    // 4. Limpa erros de build (projeto-específicos), mantém console errors para persistência
    setBuildErrors([]);

    // 5. Limpa dev server info do projeto anterior
    setDevServerUrl(null);
    setDevServerPort(null);

    // 6. Limpa referencia de arquivo atual
    setCurrentFileState(null);
    localStorage.removeItem("current-file");

    // 7. Reseta progress
    setCommandProgress({ status: "idle", progress: 0, message: "" });

    // 8. Limpa preview do projeto anterior
    setPreviewCode(null);
    setPreviewHistory([]);
    setPreviewIndex(-1);
    setNodeModulesAvailable(false);
  }, [terminalRunning, killProcess]);

  const openDirectory = useCallback(async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: "readwrite",
      });
      
      // IMPORTANTE: Limpa todo o estado do projeto anterior ANTES de carregar o novo
      await resetProjectState();

      // Ao abrir uma pasta, notificamos o servidor para preparar a subpasta em "Projetos"
      let finalPath = "";
      const fallbackPath = `d:\\AI-Projetos\\BuilderAI\\Projetos\\${handle.name}`;
      try {
        const res = await fetch("http://localhost:3001/prepare-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectName: handle.name })
        });
        if (res.ok) {
          const data = await res.json();
          finalPath = data.path;
          setProjectPath(finalPath);
          localStorage.setItem("current-project-path", finalPath);
        } else {
          // Fallback imediato para garantir que o terminal aponte para Projetos/<nome>
          setProjectPath(fallbackPath);
          localStorage.setItem("current-project-path", fallbackPath);
        }
      } catch (err) {
        console.warn("Não foi possível sincronizar com o servidor de projetos:", err);
        // Define fallback mesmo sem servidor de comandos
        setProjectPath(fallbackPath);
        localStorage.setItem("current-project-path", fallbackPath);
      }

      const finalPathForDb = projectPath || localStorage.getItem("current-project-path") || undefined;
      await saveDirectoryHandle(handle, finalPathForDb ?? undefined);
      setDirHandle(handle);
      const hasNodeModules = await handle.getDirectoryHandle("node_modules").then(() => true).catch(() => false);
      setNodeModulesAvailable(hasNodeModules);
      
      // Update recent projects list
      const allHandles = await getAllDirectoryHandles();
      setRecentProjects(allHandles);
      
      // Load files from the newly opened directory AND sync them to remote Projetos folder
      await loadFilesFromHandle(handle, true);

      toast({ 
        title: "Projeto Importado", 
        description: `Os arquivos de ${handle.name} foram copiados para a pasta Projetos.` 
      });
      if (!hasNodeModules) {
        toast({
          title: "node_modules ausente",
          description: "Instalando dependências via terminal.",
        });
      }
      
      // Start smart-dev apenas se o servidor não estiver rodando
      const projectCwd = finalPath || fallbackPath;
      const alreadyAlive = await isDevServerAlive();
      if (alreadyAlive && commandProgress.status === "running") {
        window.dispatchEvent(new StorageEvent("storage", { key: "last-preview-url", newValue: devServerUrl }));
        toast({ title: "Preview recarregado", description: "Servidor dev já estava rodando." });
      } else {
        try {
          await startSmartDev(projectCwd);
        } catch (e: unknown) { void e; }
      }

      // Auto build-check apos abrir projeto
      setTimeout(() => {
        runBuildCheck().catch(() => {});
      }, 3000);
    } catch (e: any) {
      if (e.name === "AbortError") return;
      console.error(e);
      toast({ 
        title: "Erro ao abrir pasta", 
        description: e.message, 
        variant: "destructive" 
      });
    }
  }, [resetProjectState, runTerminalCommand]);

  const openRecentDirectory = useCallback(async (handle: FileSystemDirectoryHandle, path?: string) => {
    try {
      // IMPORTANTE: Limpa todo o estado do projeto anterior ANTES de carregar o novo
      await resetProjectState();

      // Se for um caminho de Projetos sem handle válido, carrega remotamente
      if (!handle && path && /[\\\/]Projetos[\\\/]/.test(path)) {
        const parts = path.replace(/\\+/g, '/').split('/');
        const projectName = parts[parts.length - 1] || parts[parts.length - 2];
        await loadRemoteProject(projectName, path);
        return;
      }

      const requestPerm = (handle as any).requestPermission;
      const queryPerm = (handle as any).queryPermission;
      const status = typeof requestPerm === "function"
        ? await requestPerm.call(handle, { mode: "readwrite" })
        : typeof queryPerm === "function"
          ? await queryPerm.call(handle, { mode: "readwrite" })
          : "granted";
      if (status === "granted") {
        await saveDirectoryHandle(handle, path);
        setDirHandle(handle);
        const hasNodeModules = await handle.getDirectoryHandle("node_modules").then(() => true).catch(() => false);
        setNodeModulesAvailable(hasNodeModules);
        
        if (path) {
          setProjectPath(path);
          localStorage.setItem("current-project-path", path);
        } else {
          // Tenta recuperar via prepare-project para garantir consistência
          const fallbackPath = `d:\\AI-Projetos\\BuilderAI\\Projetos\\${handle.name}`;
          try {
            const res = await fetch("http://localhost:3001/prepare-project", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectName: handle.name })
            });
            if (res.ok) {
              const data = await res.json();
              setProjectPath(data.path);
              localStorage.setItem("current-project-path", data.path);
            } else {
              setProjectPath(fallbackPath);
              localStorage.setItem("current-project-path", fallbackPath);
            }
          } catch (err) { 
            // Fallback sem servidor
            setProjectPath(fallbackPath);
            localStorage.setItem("current-project-path", fallbackPath);
          }
        }

        await loadFilesFromHandle(handle);
        toast({ 
          title: "Projeto carregado", 
          description: `Pasta: ${handle.name}` 
        });
        if (!hasNodeModules) {
          toast({
            title: "node_modules ausente",
            description: "Instalando dependências via terminal.",
          });
        }
        // Start smart-dev apenas se o servidor não estiver rodando
        const recentCwd = path || localStorage.getItem("current-project-path") || `d:\\AI-Projetos\\BuilderAI\\Projetos\\${handle.name}`;
        const alreadyRunning = await isDevServerAlive();
        if (alreadyRunning && commandProgress.status === "running") {
          window.dispatchEvent(new StorageEvent("storage", { key: "last-preview-url", newValue: devServerUrl }));
          toast({ title: "Preview recarregado", description: "Servidor dev já estava rodando." });
        } else {
          try {
            await startSmartDev(recentCwd);
          } catch (e: unknown) { void e; }
        }
      }
    } catch (e: any) {
      console.error(e);
      toast({ 
        title: "Erro ao abrir projeto recente", 
        description: e.message, 
        variant: "destructive" 
      });
    }
  }, [resetProjectState, runTerminalCommand]);

  const removeRecentProject = useCallback(async (name: string) => {
    try {
      await removeDirectoryHandle(name);
      setRecentProjects(prev => prev.filter(p => p.name !== name));
      
      if (dirHandle?.name === name) {
        setDirHandle(null);
        setProjectPath(null);
        localStorage.removeItem("current-project-path");
        setVirtualFiles([]);
        await clearDirectoryHandle();
      }
      
      toast({ title: "Removido dos recentes", description: name });
    } catch (e) {
      console.error(e);
    }
  }, [dirHandle]);

  const syncProjectToRemote = async (handle: FileSystemDirectoryHandle, files: Array<{ path: string; code: string; binary?: boolean }>) => {
    // Filtra apenas arquivos de texto para sincronização (binários ficam no disco)
    const textFiles = files.filter(f => !f.binary);
    if (!textFiles.length) return;
    
    console.log(`[OllamaContext] Sincronizando ${textFiles.length} arquivos de texto para a pasta Projetos/${handle.name}...`);
    
    // Sincroniza em batches para não sobrecarregar o servidor
    for (const file of textFiles) {
      try {
        await fetch("http://localhost:3001/save-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectName: handle.name,
            filePath: file.path,
            content: file.code
          })
        });
      } catch (err) {
        console.error(`Erro ao sincronizar ${file.path}:`, err);
      }
    }
    console.log(`[OllamaContext] Sincronização concluída para ${handle.name}`);
  };

  const loadFilesFromHandle = async (handle: FileSystemDirectoryHandle, autoSyncToRemote = false) => {
    const files: Array<{ path: string; code: string; ai: boolean; binary?: boolean }> = [];
    
    // Extensões de texto (lê conteúdo)
    const textPattern = /\.(tsx|ts|js|jsx|css|json|html|md|txt|yaml|yml|toml|env|gitignore|prettierrc|eslintrc|editorconfig)$/i;
    // Extensões de assets/binários (registra apenas path)
    const binaryPattern = /\.(png|jpg|jpeg|gif|svg|webp|ico|bmp|tiff|mp3|mp4|wav|ogg|webm|woff|woff2|ttf|eot|otf|pdf)$/i;
    
    async function scan(currentHandle: FileSystemDirectoryHandle, currentPath = "") {
      for await (const entry of (currentHandle as any).values()) {
        const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        
        // Ignore common bulky/system directories
        if (entry.kind === "directory") {
          if (["node_modules", ".git", "dist", ".vite", "build", ".next", ".cache"].includes(entry.name)) continue;
          await scan(entry, entryPath);
        } else if (entry.kind === "file") {
          if (textPattern.test(entry.name)) {
            try {
              const file = await entry.getFile();
              const code = await file.text();
              files.push({ path: entryPath, code, ai: false, binary: false });
            } catch (e) {
              console.warn(`Falha ao ler arquivo ${entryPath}:`, e);
            }
          } else if (binaryPattern.test(entry.name)) {
            // Para binários, apenas registra o path (sem conteúdo)
            files.push({ path: entryPath, code: '', ai: false, binary: true });
          }
        }
      }
    }

    try {
      await scan(handle);
      console.log(`[OllamaContext] ${files.length} arquivos carregados do explorador.`);
      
      // Se solicitado, sincroniza os arquivos carregados com o servidor remoto (pasta Projetos)
      if (autoSyncToRemote) {
        await syncProjectToRemote(handle, files);
        // Garante que projectPath esteja definido mesmo sem resposta do servidor
        if (!projectPath) {
          const fallbackPath = `d:\\AI-Projetos\\BuilderAI\\Projetos\\${(handle as any).name}`;
          setProjectPath(fallbackPath);
          localStorage.setItem("current-project-path", fallbackPath);
        }
      }
      
      // So atualiza se houver mudanca real para evitar re-renders desnecessarios
      setVirtualFiles(prev => {
        const isDifferent = JSON.stringify(prev) !== JSON.stringify(files);
        return isDifferent ? files : prev;
      });
      
      if (files.length > 0 && !currentFileState) {
        const firstFile = files[0].path;
        setCurrentFileState(firstFile);
        localStorage.setItem("current-file", firstFile);
      }
    } catch (e) {
      console.error("Error scanning directory:", e);
    }
  };

  const refreshFiles = useCallback(async () => {
    if (dirHandle) {
      await loadFilesFromHandle(dirHandle);
    }
  }, [dirHandle]);

  // Carrega um projeto diretamente da pasta "Projetos" via servidor
  const loadRemoteProject = async (projectName: string, absolutePath?: string) => {
    try {
      const res = await fetch("http://localhost:3001/read-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName })
      });
      if (!res.ok) throw new Error("Falha ao ler projeto remoto");
      const data = await res.json();
      const files = (data.files as Array<{ path: string; code: string; binary?: boolean }>) || [];
      const mapped = files.map(f => ({ path: f.path, code: f.code || '', ai: false, binary: !!f.binary }));
      setVirtualFiles(mapped);
      setProjectPath(absolutePath || data.path);
      localStorage.setItem("current-project-path", absolutePath || data.path);
      if (mapped.length > 0) {
        // Seleciona primeiro arquivo de texto como arquivo ativo
        const firstTextFile = mapped.find(f => !f.binary);
        if (firstTextFile) {
          setCurrentFileState(firstTextFile.path);
        } else {
          setCurrentFileState(mapped[0].path);
        }
      }
      toast({ title: "Projeto remoto carregado", description: projectName });
    } catch (e: any) {
      console.error(e);
      toast({ title: "Erro ao carregar projeto remoto", description: e.message, variant: "destructive" });
    }
  };

  // Polling para sincronização em tempo real com o disco
  useEffect(() => {
    if (!dirHandle) return;
    
    // Pequeno atraso inicial e depois polling
    const interval = setInterval(() => {
      refreshFiles();
    }, 5000); // Aumentado para 5s para evitar sobrecarga com a nova sincronização remota
    
    return () => clearInterval(interval);
  }, [dirHandle, refreshFiles]);

  const getFileHandle = async (path: string, create = false) => {
    if (!dirHandle) return null;
    
    const parts = path.split(/[\\\/]/);
    let currentDir = dirHandle;
    
    // Navigate/create subdirectories
    for (let i = 0; i < parts.length - 1; i++) {
      try {
        currentDir = await currentDir.getDirectoryHandle(parts[i], { create });
      } catch (err) {
        if (!create) return null;
        throw err;
      }
    }
    
    return await currentDir.getFileHandle(parts[parts.length - 1], { create });
  };

  const syncFileToDisk = async (path: string, code: string) => {
    // Sync local (FileSystemHandle) - se disponivel
    if (dirHandle) {
      try {
        const fileHandle = await getFileHandle(path, true);
        if (fileHandle) {
          const writable = await fileHandle.createWritable();
          await writable.write(code);
          await writable.close();
        }
      } catch (e: any) {
        console.error(`Error syncing ${path} to local disk:`, e);
      }
    }

    // Sync remoto (Servidor Projetos) - SEMPRE que tivermos nome do projeto
    const pName = dirHandle?.name || derivedProjectName;
    if (pName) {
      try {
        await fetch("http://localhost:3001/save-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectName: pName,
            filePath: path,
            content: code
          })
        });
      } catch (err) {
        console.error("Erro ao sincronizar arquivo com servidor remoto:", err);
      }
    }
  };

  const deleteFileFromDisk = async (path: string) => {
    // Sync local (FileSystemHandle)
    if (dirHandle) {
      try {
        const parts = path.split(/[\\\/]/);
        let currentDir = dirHandle;
        
        for (let i = 0; i < parts.length - 1; i++) {
          currentDir = await currentDir.getDirectoryHandle(parts[i]);
        }
        
        await currentDir.removeEntry(parts[parts.length - 1]);
      } catch (e: any) {
        if (e.name !== "NotFoundError") {
          console.error(`Error deleting ${path} from disk:`, e);
          toast({ 
            title: "Erro ao excluir", 
            description: `Nao foi possivel excluir ${path}: ${e.message}`, 
            variant: "destructive" 
          });
        }
      }
    }

    // Sync remoto (Servidor Projetos) - SEMPRE que tivermos nome do projeto
    const pName = dirHandle?.name || derivedProjectName;
    if (pName) {
      fetch("http://localhost:3001/delete-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: pName,
          filePath: path,
        }),
      }).catch((err) =>
        console.error("Erro ao excluir arquivo no servidor remoto:", err)
      );
    }
  };
  const [config, setConfig] = useState<OllamaConfig>(() => {
    const saved = localStorage.getItem("ollama-config");
    return saved ? { ...defaultConfig, ...JSON.parse(saved) } : defaultConfig;
  });

  const updateConfig = useCallback((partial: Partial<OllamaConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      localStorage.setItem("ollama-config", JSON.stringify(next));
      return next;
    });
  }, []);

  const checkConnection = useCallback(async () => {
    // Previne múltiplas chamadas simultâneas
    if (isCheckingRef.current) {
      return isConnected;
    }
    
    isCheckingRef.current = true;
    setIsChecking(true);
    
    try {
      const t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      // Aumenta timeout para 8 segundos para redes lentas
      const res = await fetch(`${config.baseUrl}/api/tags`, { 
        signal: AbortSignal.timeout(15000),
        // Adiciona cache busting para evitar respostas em cache
        cache: 'no-cache'
      });
      
      if (res.ok) {
        const data = await res.json();
        const modelList = ((data.models as Array<{ name: string; size: number; modified_at: string }>) || []).map((m) => ({
          name: m.name,
          size: (m.size / 1e9).toFixed(1) + " GB",
          modified_at: m.modified_at,
        }));
        setModels(modelList);
        setIsConnected(true);
        setConnectionAttempts(0);
        setLastConnectionError(null);
        const t1 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
        setLatencyMs(Math.max(0, Math.round(t1 - t0)));
        if (!config.selectedModel && modelList.length > 0) {
          updateConfig({ selectedModel: modelList[0].name });
        }
        return true;
      }
      
      // HTTP error - desconecta imediatamente
      setIsConnected(false);
      setLatencyMs(null);
      setConnectionAttempts(prev => prev + 1);
      return false;
    } catch (error) {
      // Log do erro para debugging mas não muda o status imediatamente
      // para evitar oscilações rápidas
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('Ollama connection check failed:', errorMessage);
      setLastConnectionError(errorMessage);
      setConnectionAttempts(prev => prev + 1);
      
      // Só desconecta se já estivermos conectados e o erro persistir
      if (isConnected) {
        setIsConnected(false);
        setModels([]);
        setLatencyMs(null);
      }
      return false;
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }, [config.baseUrl, config.selectedModel, updateConfig, isConnected]);

  // Notifica mudanças de conexão
  useEffect(() => {
    if (connectionAttempts === 1 && !isConnected) {
      toast({
        title: "Conectando ao Ollama",
        description: "Estabelecendo conexão...",
        duration: 3000,
      });
    } else if (connectionAttempts > 3 && !isConnected) {
      toast({
        title: "Ollama não disponível",
        description: `Tentando reconectar... (${connectionAttempts} tentativas)`,
        variant: "destructive",
        duration: 5000,
      });
    } else if (isConnected && connectionAttempts > 0) {
      toast({
        title: "Ollama conectado",
        description: "Conexão estabelecida com sucesso!",
        duration: 3000,
      });
    }
  }, [isConnected, connectionAttempts]);

  // Poll connection com backoff inteligente
  useEffect(() => {
    let consecutiveFailures = 0;
    let intervalId: NodeJS.Timeout;
    
    const smartCheckConnection = async () => {
      const connected = await checkConnection();
      
      if (connected) {
        consecutiveFailures = 0;
        // Se conectado, mantém intervalo de 15 segundos
        clearInterval(intervalId);
        intervalId = setInterval(smartCheckConnection, 15000);
      } else {
        consecutiveFailures++;
        // Backoff exponencial: 5s, 10s, 20s, 30s, depois mantém 30s
        const backoffDelay = Math.min(5000 * Math.pow(2, Math.min(consecutiveFailures - 1, 3)), 30000);
        clearInterval(intervalId);
        intervalId = setInterval(smartCheckConnection, backoffDelay);
      }
    };
    
    // Primeira verificação imediata
    smartCheckConnection();
    
    return () => {
      clearInterval(intervalId);
      if (checkConnectionTimeoutRef.current) {
        clearTimeout(checkConnectionTimeoutRef.current);
      }
    };
  }, [checkConnection]);

  const pushPreviewCode = useCallback((code: string) => {
    setPreviewCode(code);
    setPreviewHistory((prev) => {
      const next = previewIndex >= 0 ? prev.slice(0, previewIndex + 1) : prev;
      const updated = [...next, code];
      localStorage.setItem("preview-history", JSON.stringify(updated));
      return updated;
    });
    setPreviewIndex((prev) => prev + 1);
  }, [previewIndex]);

  useEffect(() => {
    const raw = localStorage.getItem("preview-history");
    if (raw) {
      try {
        const arr = JSON.parse(raw) as string[];
        setPreviewHistory(arr);
        setPreviewIndex(arr.length - 1);
        setPreviewCode(arr.length > 0 ? arr[arr.length - 1] : null);
      } catch (e) {
        void e;
      }
    }
  }, []);

  // virtual-files nao e mais persistido em localStorage.
  // Os arquivos sao carregados da pasta Projetos/ via loadRemoteProject ou loadFilesFromHandle.
  useEffect(() => {
    // Limpar cache antigo de virtual-files no localStorage
    try { localStorage.removeItem("virtual-files"); } catch { /* noop */ }
  }, []);

  const addVirtualFile = useCallback((path: string, code: string, ai: boolean = true) => {
    setVirtualFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === path);
      const next = [...prev];
      if (idx >= 0) {
        next[idx] = { ...next[idx], code, ai };
      } else {
        next.push({ path, code, ai });
      }
      return next;
    });
    
    // Sync to disk (local + Projetos/)
    syncFileToDisk(path, code);

    try {
      setCurrentFileState(path);
    } catch (e) { void e; }
  }, [dirHandle, derivedProjectName]);

  const updateVirtualFile = useCallback((path: string, code: string) => {
    setVirtualFiles((prev) => {
      const next = prev.map((f) => (f.path === path ? { ...f, code } : f));
      return next;
    });
    
    // Sync to disk (local + Projetos/)
    syncFileToDisk(path, code);
  }, [dirHandle, derivedProjectName]);

  const renameVirtualFile = useCallback(async (oldPath: string, newPath: string) => {
    // For rename, we delete the old one and create the new one on disk
    // In a real FS API we could move it, but this is simpler for now
    const file = virtualFiles.find(f => f.path === oldPath);
    if (file) {
      await deleteFileFromDisk(oldPath);
      await syncFileToDisk(newPath, file.code);
    }

    setVirtualFiles((prev) => {
      const next = prev.map((f) => (f.path === oldPath ? { ...f, path: newPath } : f));
      return next;
    });
    setCurrentFileState((prev) => {
      return prev === oldPath ? newPath : prev;
    });
  }, [dirHandle, derivedProjectName, virtualFiles]);

  const deleteVirtualFile = useCallback((path: string) => {
    setVirtualFiles((prev) => {
      const next = prev.filter((f) => f.path !== path);
      return next;
    });
    
    // Delete from disk (local + Projetos/)
    deleteFileFromDisk(path);

    setCurrentFileState((prev) => {
      return prev === path ? null : prev;
    });
  }, [dirHandle, derivedProjectName]);

  const moveVirtualFile = useCallback(async (oldPath: string, newPath: string) => {
    // Move no servidor remoto (Projetos/)
    const pName = dirHandle?.name || derivedProjectName;
    if (pName) {
      try {
        await fetch("http://localhost:3001/move-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectName: pName, oldPath, newPath })
        });
      } catch (err) {
        console.error("Erro ao mover arquivo no servidor:", err);
      }
    }

    // Move no FileSystemHandle local (se disponivel)
    if (dirHandle) {
      try {
        const file = virtualFiles.find(f => f.path === oldPath);
        if (file) {
          await deleteFileFromDisk(oldPath);
          await syncFileToDisk(newPath, file.code);
        }
      } catch (e) {
        console.error("Erro ao mover localmente:", e);
      }
    }

    // Atualiza estado
    setVirtualFiles(prev => prev.map(f => f.path === oldPath ? { ...f, path: newPath } : f));
    setCurrentFileState(prev => prev === oldPath ? newPath : prev);
  }, [dirHandle, derivedProjectName, virtualFiles]);

  // Excluir uma pasta inteira (e todos seus filhos) via servidor
  const deleteFolderRemote = useCallback(async (folderPath: string) => {
    const pName = dirHandle?.name || derivedProjectName;
    if (pName) {
      try {
        await fetch("http://localhost:3001/delete-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectName: pName, filePath: folderPath })
        });
      } catch (err) {
        console.error("Erro ao excluir pasta no servidor:", err);
      }
    }

    // Tambem remove do FileSystemHandle local
    if (dirHandle) {
      try {
        const parts = folderPath.split(/[\\\/]/);
        let currentDir = dirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          currentDir = await currentDir.getDirectoryHandle(parts[i]);
        }
        await currentDir.removeEntry(parts[parts.length - 1], { recursive: true });
      } catch (e: any) {
        if (e.name !== "NotFoundError") {
          console.error("Erro ao excluir pasta local:", e);
        }
      }
    }

    // Remove todos os arquivos filhos do estado
    setVirtualFiles(prev => prev.filter(f => !f.path.startsWith(folderPath + "/") && f.path !== folderPath));
    setCurrentFileState(prev => {
      if (prev && (prev.startsWith(folderPath + "/") || prev === folderPath)) return null;
      return prev;
    });
  }, [dirHandle, derivedProjectName]);

  // Criar arquivo via servidor
  const createFileRemote = useCallback(async (filePath: string, content = "") => {
    const pName = dirHandle?.name || derivedProjectName;
    if (pName) {
      try {
        await fetch("http://localhost:3001/create-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectName: pName, filePath, content })
        });
      } catch (err) {
        console.error("Erro ao criar arquivo no servidor:", err);
      }
    }

    // Tambem cria no FileSystemHandle local
    if (dirHandle) {
      try {
        await syncFileToDisk(filePath, content);
      } catch (e) {
        console.error("Erro ao criar arquivo local:", e);
      }
    }

    // Adiciona ao estado
    setVirtualFiles(prev => {
      if (prev.some(f => f.path === filePath)) return prev;
      return [...prev, { path: filePath, code: content, ai: false }];
    });
    setCurrentFileState(filePath);
  }, [dirHandle, derivedProjectName]);

  const projectComponents = [
    ...virtualFiles
      .filter((f) => f.path.endsWith(".tsx") && (f.path.startsWith("src/components/") || f.path.startsWith("src/pages/")))
      .map((f) =>
        f.path.startsWith("src/components/")
          ? f.path.replace("src/components/", "")
          : f.path.replace("src/pages/", "")
      ),
  ];
  const projectFiles = [...virtualFiles.map((f) => f.path)];
  const projectTemplate = [
    "Stack: React + TypeScript + Tailwind CSS",
    "Estrutura:",
    "- Páginas: src/pages/*.tsx (Index.tsx, About.tsx, etc.)",
    "- Componentes: src/components/*.tsx",
    "- Módulos: src/modules/**/*.ts",
    "- Assets: public/* (svg, png, jpg, webp, ico)",
    "Regras:",
    "- Use apenas classes Tailwind e componentes funcionais (export function).",
    "- Sem dependências externas além de Tailwind.",
    "- Retorne blocos ```tsx completos; um bloco por arquivo.",
    "- Inclua comentário com caminho relativo no topo do bloco, ex: // src/components/ProdutoCard.tsx",
    "Arquivos existentes: " + projectFiles.join(", "),
  ].join("\n");

  const undoPreview = useCallback(() => {
    setPreviewIndex((idx) => {
      const next = idx - 1;
      if (next >= 0) {
        setPreviewCode(previewHistory[next]);
      }
      return next >= 0 ? next : idx;
    });
  }, [previewHistory]);

  const redoPreview = useCallback(() => {
    setPreviewIndex((idx) => {
      const next = idx + 1;
      if (next < previewHistory.length) {
        setPreviewCode(previewHistory[next]);
      }
      return next < previewHistory.length ? next : idx;
    });
  }, [previewHistory]);

  const saveChatSession = useCallback(async (chatId: string, title: string, msgs: any[]) => {
    if (!derivedProjectName) return;
    localStorage.setItem("current-chat-id", chatId);
    setCurrentChatId(chatId);
    try {
      await fetch("http://localhost:3001/save-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: derivedProjectName,
          filePath: `.builderai/chats/${chatId}.json`,
          content: JSON.stringify({ id: chatId, title, messages: msgs, updatedAt: new Date().toISOString() }, null, 2)
        })
      });
    } catch (e) {
      console.error("Erro ao salvar chat:", e);
    }
  }, [derivedProjectName]);

  const loadChatSession = useCallback(async (chatId: string): Promise<any[] | null> => {
    if (!derivedProjectName) return null;
    try {
      const res = await fetch("http://localhost:3001/read-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: derivedProjectName, chatId })
      });
      if (!res.ok) return null;
      const data = await res.json();
      setCurrentChatId(chatId);
      localStorage.setItem("current-chat-id", chatId);
      return data.messages || null;
    } catch {
      return null;
    }
  }, [derivedProjectName]);

  const loadChatSessions = useCallback(async () => {
    if (!derivedProjectName) {
      setChatSessions([]);
      return;
    }
    try {
      const res = await fetch("http://localhost:3001/list-chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: derivedProjectName })
      });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(data.chats || []);
      }
    } catch {
      setChatSessions([]);
    }
  }, [derivedProjectName]);

  // Load chat sessions when project changes
  useEffect(() => {
    loadChatSessions();
  }, [derivedProjectName]);

  return (
    <OllamaContext.Provider value={{ isConnected, isChecking, latencyMs, connectionAttempts, lastConnectionError, config, models, updateConfig, checkConnection, previewCode, setPreviewCode, pushPreviewCode, undoPreview, redoPreview, previewHistory, previewIndex, virtualFiles, addVirtualFile, updateVirtualFile, renameVirtualFile, deleteVirtualFile, moveVirtualFile, deleteFolderRemote, createFileRemote, dirHandle, projectPath, devServerUrl, devServerPort, setManualPort, nodeModulesAvailable, openDirectory, openRecentDirectory, refreshFiles, recentProjects, removeRecentProject,
      runProjectCommands,
      commandProgress,
      consoleErrors, addConsoleError, clearConsoleErrors,
      buildErrors, addBuildError, clearBuildErrors, allErrors,
      runBuildCheck, nukeNodeModules, installDependency, isFixingErrors,
      autoFixLog, clearAutoFixLog,
      pendingErrorFix, setPendingErrorFix,
      projectComponents, projectTemplate, lastPrompt, setLastPrompt, lastError, setLastError, currentFile, setCurrentFile: (p) => { setCurrentFileState(p); localStorage.setItem("current-file", p ?? ""); },
      chatSessions, currentChatId, setCurrentChatId, saveChatSession, loadChatSession, loadChatSessions, projectName: derivedProjectName,
      terminalLines, terminalRunning, terminalHistory, runTerminalCommand, killProcess, clearTerminal, serverOnline }}>
      {children}
    </OllamaContext.Provider>
  );
}

export function useOllama() {
  const ctx = useContext(OllamaContext);
  if (!ctx) throw new Error("useOllama must be used within OllamaProvider");
  return ctx;
}
