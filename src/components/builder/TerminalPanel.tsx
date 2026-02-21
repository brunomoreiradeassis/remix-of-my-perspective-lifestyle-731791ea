import { useEffect, useRef, useState, useCallback } from "react";
import {
  Terminal as TerminalIcon,
  Play,
  Square,
  Trash2,
  ChevronUp,
  ChevronDown,
  Circle,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { useOllama } from "@/contexts/OllamaContext";

const QUICK_COMMANDS = [
  { label: "dev", cmd: "pnpm run dev", desc: "Iniciar servidor dev" },
  { label: "build", cmd: "pnpm run build", desc: "Build de producao" },
  { label: "install", cmd: "pnpm install", desc: "Instalar dependencias" },
  { label: "lint", cmd: "pnpm run lint", desc: "Verificar lint" },
];

export function TerminalPanel() {
  const {
    terminalLines,
    terminalRunning,
    terminalHistory,
    runTerminalCommand,
    killProcess,
    clearTerminal,
    serverOnline,
    projectPath,
    dirHandle,
  } = useOllama();

  const [command, setCommand] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showQuickCmds, setShowQuickCmds] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [terminalLines]);

  // Focus input when panel opens
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const derivedCwd = (() => {
    if (projectPath && projectPath.trim().length > 0) return projectPath;
    if (dirHandle?.name) return `Projetos/${dirHandle.name}`;
    return null;
  })();

  const handleExec = useCallback(() => {
    const cmd = command.trim();
    if (!cmd) return;
    setCommand("");
    setHistoryIndex(-1);
    runTerminalCommand(cmd);
  }, [command, runTerminalCommand]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleExec();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (terminalHistory.length > 0) {
        const next = Math.min(historyIndex + 1, terminalHistory.length - 1);
        setHistoryIndex(next);
        setCommand(terminalHistory[next]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setCommand(terminalHistory[next]);
      } else {
        setHistoryIndex(-1);
        setCommand("");
      }
    } else if (e.key === "c" && e.ctrlKey) {
      if (terminalRunning) {
        killProcess();
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      clearTerminal();
    }
  };

  const lineColor = (type: string) => {
    switch (type) {
      case "error": return "#f38ba8";
      case "stderr": return "#fab387";
      case "info": return "#89b4fa";
      case "system": return "#6c7086";
      default: return "#cdd6f4";
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#181825" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: "#2a2b3d", backgroundColor: "#1e1e2e" }}
      >
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-4 w-4" style={{ color: "#89b4fa" }} />
          <h2 className="text-sm font-semibold" style={{ color: "#cdd6f4" }}>Terminal</h2>
          <div className="h-3 w-px" style={{ backgroundColor: "#2a2b3d" }} />
          {/* Server status */}
          <div className="flex items-center gap-1.5">
            <Circle
              className="h-2 w-2"
              fill={serverOnline ? "#a6e3a1" : "#f38ba8"}
              style={{ color: serverOnline ? "#a6e3a1" : "#f38ba8" }}
            />
            <span className="text-[10px] font-mono" style={{ color: "#6c7086" }}>
              {serverOnline ? "online" : "offline"}
            </span>
          </div>
          {terminalRunning && (
            <span
              className="text-[10px] font-mono animate-pulse px-1.5 py-0.5 rounded"
              style={{ color: "#a6e3a1", backgroundColor: "#a6e3a110" }}
            >
              rodando
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {terminalRunning && (
            <button
              onClick={killProcess}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors shrink-0"
              style={{ color: "#f38ba8", backgroundColor: "#f38ba815" }}
              title="Parar processo (Ctrl+C)"
            >
              <Square className="h-3 w-3" />
              Parar
            </button>
          )}
          <div className="h-3 w-px shrink-0" style={{ backgroundColor: "#2a2b3d" }} />
          <button
            onClick={clearTerminal}
            className="p-1.5 rounded transition-colors shrink-0 hover:bg-[#2a2b3d]"
            style={{ color: "#6c7086" }}
            title="Limpar terminal (Ctrl+L)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* CWD bar */}
      <div
        className="flex items-center gap-2 px-4 py-1.5 border-b shrink-0"
        style={{ borderColor: "#2a2b3d", backgroundColor: "#181825" }}
      >
        <FolderOpen className="h-3 w-3 shrink-0" style={{ color: "#6c7086" }} />
        <span className="text-[10px] font-mono truncate" style={{ color: "#6c7086" }}>
          {derivedCwd ?? "Nenhum projeto aberto"}
        </span>
      </div>

      {/* Quick commands bar */}
      <div
        className="flex items-center gap-1.5 px-4 py-1.5 border-b shrink-0 overflow-x-auto"
        style={{ borderColor: "#2a2b3d", backgroundColor: "#1e1e2e08" }}
      >
        {QUICK_COMMANDS.map((qc) => (
          <button
            key={qc.cmd}
            onClick={() => runTerminalCommand(qc.cmd)}
            disabled={terminalRunning}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-medium transition-all disabled:opacity-40"
            style={{ color: "#89b4fa", backgroundColor: "#89b4fa10" }}
            title={qc.desc}
          >
            <Play className="h-2.5 w-2.5" />
            {qc.label}
          </button>
        ))}
        {terminalRunning && (
          <button
            onClick={killProcess}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-medium transition-all"
            style={{ color: "#f38ba8", backgroundColor: "#f38ba810" }}
            title="Encerrar processo"
          >
            <Square className="h-2.5 w-2.5" />
            stop
          </button>
        )}
        <button
          onClick={() => runTerminalCommand("pnpm run dev")}
          disabled={terminalRunning}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-medium transition-all ml-auto disabled:opacity-40"
          style={{ color: "#a6e3a1", backgroundColor: "#a6e3a110" }}
          title="Reinstalar e iniciar dev"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          restart
        </button>
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-4 py-2 font-mono text-[12px] leading-5"
        style={{ backgroundColor: "#181825" }}
      >
        {terminalLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <TerminalIcon className="h-8 w-8" style={{ color: "#2a2b3d" }} />
            <span className="text-[11px]" style={{ color: "#6c7086" }}>
              {derivedCwd
                ? "Terminal pronto. Digite um comando ou use os atalhos acima."
                : "Abra um projeto para comecar."
              }
            </span>
          </div>
        ) : (
          terminalLines.map((line, i) => (
            <div key={i} className="flex gap-0 whitespace-pre-wrap break-all">
              <span style={{ color: lineColor(line.type) }}>
                {line.type === "system" ? (
                  <span style={{ color: "#6c7086" }}>{line.text}</span>
                ) : line.type === "info" ? (
                  (() => {
                    const urlParts = line.text.split(/(https?:\/\/[^\s]+)/);
                    return urlParts.map((part, j) =>
                      /^https?:\/\//.test(part) ? (
                        <span key={j} style={{ color: "#89b4fa", textDecoration: "underline" }}>{part}</span>
                      ) : (
                        <span key={j}>{part}</span>
                      )
                    );
                  })()
                ) : (
                  line.text
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-t shrink-0"
        style={{ borderColor: "#2a2b3d", backgroundColor: "#1e1e2e" }}
      >
        <span className="text-[12px] font-mono font-bold shrink-0" style={{ color: "#89b4fa" }}>$</span>
        <input
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={terminalRunning ? "Processo rodando... Ctrl+C para parar" : "Digite um comando..."}
          disabled={!derivedCwd}
          className="flex-1 bg-transparent border-0 outline-none text-[12px] font-mono placeholder:opacity-40 disabled:opacity-30"
          style={{ color: "#cdd6f4" }}
        />
        {command.trim() && !terminalRunning && (
          <button
            onClick={handleExec}
            className="shrink-0 p-1 rounded transition-colors"
            style={{ color: "#a6e3a1" }}
            title="Executar (Enter)"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* History dropdown */}
      {terminalHistory.length > 0 && (
        <div
          className="border-t shrink-0"
          style={{ borderColor: "#2a2b3d", backgroundColor: "#181825" }}
        >
          <button
            onClick={() => setShowQuickCmds(!showQuickCmds)}
            className="flex items-center gap-1.5 px-4 py-1 text-[10px] font-mono w-full text-left transition-colors"
            style={{ color: "#6c7086" }}
          >
            {showQuickCmds ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            Historico ({terminalHistory.length})
          </button>
          {showQuickCmds && (
            <div className="max-h-28 overflow-auto px-2 pb-2">
              {terminalHistory.slice(0, 10).map((cmd, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setCommand(cmd);
                    setShowQuickCmds(false);
                    inputRef.current?.focus();
                  }}
                  className="w-full text-left px-2 py-1 rounded text-[10px] font-mono truncate transition-colors hover:bg-[#2a2b3d]"
                  style={{ color: "#cdd6f4" }}
                >
                  $ {cmd}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
