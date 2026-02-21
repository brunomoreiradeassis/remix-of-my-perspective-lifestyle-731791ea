import { useOllama } from "@/contexts/OllamaContext";
import { useEffect, useState, useRef, useCallback } from "react";
import { RefreshCw, Maximize2, Minimize2, AlertTriangle, Bug, X, Wrench, Settings2, Plug, Globe, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ErrorDiagnosticModal } from "./ErrorDiagnosticModal";

export function PreviewPanel() {
  const {
    devServerPort,
    devServerUrl,
    commandProgress,
    consoleErrors,
    clearConsoleErrors,
    setPendingErrorFix,
    addConsoleError,
    setManualPort,
  } = useOllama();

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Mode: "auto" = detect from terminal; "manual" = user-specified port
  const [mode, setMode] = useState<"auto" | "manual">(() => {
    return localStorage.getItem("preview-mode") === "manual" ? "manual" : "auto";
  });
  const [manualPortInput, setManualPortInput] = useState<string>(() => {
    return localStorage.getItem("preview-manual-port") || "8081";
  });
  const [showPortConfig, setShowPortConfig] = useState(false);

  // Derive effective preview URL
  const effectiveUrl = (() => {
    if (mode === "manual") {
      const p = parseInt(manualPortInput, 10);
      if (p > 0 && p < 65536) return `http://localhost:${p}/`;
      return null;
    }
    // Auto mode: use devServerUrl from context (detected from terminal)
    if (devServerUrl) return devServerUrl;
    try {
      const saved = localStorage.getItem("last-preview-url");
      if (saved && !/localhost:8080/i.test(saved)) return saved;
    } catch {}
    return null;
  })();

  const [expanded, setExpanded] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [errorsModalOpen, setErrorsModalOpen] = useState(false);

  // Persist mode and manual port
  useEffect(() => {
    localStorage.setItem("preview-mode", mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem("preview-manual-port", manualPortInput);
  }, [manualPortInput]);

  // When manual port is confirmed, push to context too
  const applyManualPort = useCallback(() => {
    const p = parseInt(manualPortInput, 10);
    if (p > 0 && p < 65536 && p !== 8080) {
      setManualPort(p);
      setReloadTick((t) => t + 1);
      setShowPortConfig(false);
    }
  }, [manualPortInput, setManualPort]);

  // Inject error capture script into iframe on load
  const handleIframeLoad = useCallback(() => {
    setFrameError(null);
    try {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc) {
          const script = iframeDoc.createElement("script");
          script.textContent = `
            window.addEventListener("error", function(e) {
              try {
                window.parent.postMessage({
                  type: "iframe-error",
                  message: e.message + " (" + (e.filename || "unknown") + ":" + (e.lineno || 0) + ":" + (e.colno || 0) + ")"
                }, "*");
              } catch(err) {}
            });
            window.addEventListener("unhandledrejection", function(e) {
              try {
                var reason = e.reason;
                var msg = reason instanceof Error ? reason.message : String(reason);
                window.parent.postMessage({
                  type: "iframe-error",
                  message: "Unhandled Promise: " + msg
                }, "*");
              } catch(err) {}
            });
            var origError = console.error;
            console.error = function() {
              try {
                var args = Array.prototype.slice.call(arguments);
                var msg = args.map(function(a) { return typeof a === "string" ? a : JSON.stringify(a); }).join(" ");
                window.parent.postMessage({ type: "iframe-error", message: "[console.error] " + msg }, "*");
              } catch(err) {}
              origError.apply(console, arguments);
            };
          `;
          iframeDoc.head.appendChild(script);
        }
      } catch {
        // Cross-origin
      }
    } catch {
      // Silently fail
    }
  }, []);

  const containerClasses = expanded
    ? "fixed inset-0 z-50 bg-[#1e1e2e] p-0"
    : "h-full w-full p-0 overflow-hidden";

  const statusLabel = (() => {
    switch (commandProgress.status) {
      case "checking": return "Verificando...";
      case "installing": return "Instalando dependencias...";
      case "installing-force": return "Install --force...";
      case "starting": return "Iniciando servidor...";
      case "running": return "Servidor rodando";
      case "error": return "Erro";
      default: return null;
    }
  })();

  const statusColor = (() => {
    switch (commandProgress.status) {
      case "checking":
      case "installing":
      case "installing-force":
      case "starting":
        return "bg-[#fab387]";
      case "running":
        return "bg-[#a6e3a1]";
      case "error":
        return "bg-[#f38ba8]";
      default:
        return "bg-[#585b70]";
    }
  })();

  const handleFixErrors = () => {
    if (consoleErrors.length === 0) return;
    const errorText = consoleErrors.map((e, i) => `${i + 1}. ${e}`).join("\n");
    const fixPrompt = `Corrija os seguintes erros do console do projeto:\n\n${errorText}\n\nAnalise cada erro, identifique os arquivos afetados e gere as correcoes necessarias.`;
    setPendingErrorFix(fixPrompt);
    setErrorsModalOpen(false);
  };

  const portLabel = (() => {
    if (mode === "manual") {
      const p = parseInt(manualPortInput, 10);
      return p > 0 ? `localhost:${p}` : "porta invalida";
    }
    if (devServerPort) return `localhost:${devServerPort}`;
    return null;
  })();

  return (
    <div className={containerClasses}>
      <div className="h-full flex flex-col rounded-xl border border-[#313244] shadow-sm overflow-hidden bg-[#1e1e2e]">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-[#181825] border-b border-[#313244]">
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-[#89b4fa]" />
            <h2 className="text-xs font-semibold text-[#cdd6f4]">Visualizador Web</h2>

            {/* Status indicator */}
            {statusLabel && commandProgress.status !== "idle" && (
              <div className="flex items-center gap-1.5">
                <div className={`h-2 w-2 rounded-full ${statusColor} ${commandProgress.status !== "running" && commandProgress.status !== "error" ? "animate-pulse" : ""}`} />
                <span className="text-[10px] text-[#a6adc8] font-medium">{statusLabel}</span>
                {commandProgress.progress > 0 && commandProgress.status !== "running" && (
                  <span className="text-[10px] text-[#6c7086]">({commandProgress.progress}%)</span>
                )}
              </div>
            )}

            {/* Mode badge */}
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${mode === "auto" ? "bg-[#89b4fa15] text-[#89b4fa]" : "bg-[#a6e3a115] text-[#a6e3a1]"}`}>
              {mode === "auto" ? "AUTO" : "MANUAL"}
            </span>
          </div>

          <TooltipProvider>
            <div className="flex items-center gap-1">
              {/* Port label */}
              {portLabel && (
                <span className="text-[10px] text-[#a6adc8] font-mono px-1.5 py-0.5 rounded bg-[#31324480]">
                  {portLabel}
                </span>
              )}

              {/* AutoFix button - always visible when errors exist */}
              {consoleErrors.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleFixErrors}
                      className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md bg-[#a6e3a115] text-[#a6e3a1] hover:bg-[#a6e3a125] transition-colors text-[10px] font-medium"
                    >
                      <Zap className="h-3 w-3" />
                      AutoFix ({consoleErrors.length})
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Enviar todos os erros para correção automática</TooltipContent>
                </Tooltip>
              )}

              {/* Error badge */}
              {consoleErrors.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setErrorsModalOpen(true)}
                      className="relative inline-flex items-center justify-center h-7 px-1.5 rounded-md bg-[#f38ba810] hover:bg-[#f38ba820] transition-colors"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-[#f38ba8]" />
                      <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] leading-none bg-[#f38ba8] text-[#1e1e2e] border-0">
                        {consoleErrors.length}
                      </Badge>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{consoleErrors.length} erro(s) detectado(s)</TooltipContent>
                </Tooltip>
              )}

              {/* Port config button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowPortConfig(!showPortConfig)}
                    className={`inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors ${showPortConfig ? "bg-[#89b4fa20] text-[#89b4fa]" : "bg-[#31324480] text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244]"}`}
                    aria-label="Configurar porta"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Configurar porta do preview</TooltipContent>
              </Tooltip>

              {/* Reload */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setReloadTick((t) => t + 1)}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-[#31324480] text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
                    aria-label="Recarregar"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Recarregar</TooltipContent>
              </Tooltip>

              {/* Expand/collapse */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setExpanded((s) => !s)}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-[#31324480] text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
                    aria-label={expanded ? "Recolher" : "Expandir"}
                  >
                    {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{expanded ? "Recolher" : "Expandir"}</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>

        {/* Port configuration panel */}
        {showPortConfig && (
          <div className="px-3 py-2.5 bg-[#11111b] border-b border-[#313244] space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-[#cdd6f4]">Modo:</span>
              <button
                onClick={() => setMode("auto")}
                className={`text-[10px] px-2 py-1 rounded font-medium transition-colors ${mode === "auto" ? "bg-[#89b4fa] text-[#1e1e2e]" : "bg-[#31324480] text-[#a6adc8] hover:bg-[#313244]"}`}
              >
                Automatico (Terminal)
              </button>
              <button
                onClick={() => setMode("manual")}
                className={`text-[10px] px-2 py-1 rounded font-medium transition-colors ${mode === "manual" ? "bg-[#a6e3a1] text-[#1e1e2e]" : "bg-[#31324480] text-[#a6adc8] hover:bg-[#313244]"}`}
              >
                Manual
              </button>
            </div>

            {mode === "manual" && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#a6adc8]">Porta:</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={manualPortInput}
                  onChange={(e) => setManualPortInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyManualPort(); }}
                  className="w-24 h-7 px-2 text-xs font-mono rounded border border-[#313244] bg-[#1e1e2e] text-[#cdd6f4] placeholder-[#585b70] focus:outline-none focus:border-[#89b4fa] focus:ring-1 focus:ring-[#89b4fa30]"
                  placeholder="8081"
                />
                <button
                  onClick={applyManualPort}
                  className="flex items-center gap-1 h-7 px-2.5 text-[10px] font-medium rounded bg-[#a6e3a1] text-[#1e1e2e] hover:bg-[#a6e3a1cc] transition-colors"
                >
                  <Plug className="h-3 w-3" />
                  Conectar
                </button>
              </div>
            )}

            {mode === "auto" && (
              <div className="text-[10px] text-[#6c7086] leading-relaxed">
                {devServerPort
                  ? <>Porta detectada automaticamente: <span className="text-[#a6e3a1] font-mono font-medium">localhost:{devServerPort}</span></>
                  : "Aguardando deteccao da porta pelo terminal... Inicie o servidor dev (pnpm run dev) na pasta do projeto."
                }
              </div>
            )}
          </div>
        )}

        {/* Progress bar */}
        {commandProgress.status !== "idle" && commandProgress.status !== "running" && commandProgress.status !== "error" && (
          <div className="h-1 bg-[#313244]">
            <div
              className="h-full bg-[#89b4fa] transition-all duration-500 ease-out"
              style={{ width: `${commandProgress.progress}%` }}
            />
          </div>
        )}

        {/* Preview area */}
        <div className="relative bg-[#1e1e2e] flex-1 min-h-0">
          {!effectiveUrl ? (
            <div className="absolute inset-0 flex items-center justify-center border-t border-[#313244]">
              {commandProgress.status !== "idle" ? (
                <div className="text-center space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <svg className="h-5 w-5 animate-spin text-[#89b4fa]" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-80" d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    <span className="text-sm text-[#a6adc8]">{commandProgress.message}</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 px-6 text-center">
                  <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-[#89b4fa10]">
                    <Globe className="h-6 w-6 text-[#89b4fa]" />
                  </div>
                  <p className="text-sm text-[#a6adc8] max-w-xs">
                    Nenhum servidor detectado. Configure a porta manualmente ou abra uma pasta de projeto para iniciar.
                  </p>
                  <button
                    onClick={() => setShowPortConfig(true)}
                    className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-[#89b4fa] text-[#1e1e2e] hover:bg-[#89b4facc] transition-colors"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Configurar porta
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {frameError && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1e1e2e]/80 backdrop-blur-sm">
                  <div className="mx-4 rounded-xl border border-[#313244] bg-[#181825] p-5 text-center max-w-sm">
                    <div className="flex items-center justify-center h-10 w-10 mx-auto rounded-lg bg-[#f38ba810] mb-3">
                      <AlertTriangle className="h-5 w-5 text-[#f38ba8]" />
                    </div>
                    <p className="text-sm text-[#cdd6f4] mb-1">Falha ao carregar o preview</p>
                    <p className="text-xs text-[#6c7086] mb-3 font-mono">{effectiveUrl}</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => {
                          setFrameError(null);
                          setReloadTick((t) => t + 1);
                        }}
                        className="h-8 px-3 rounded-lg bg-[#89b4fa] text-[#1e1e2e] text-xs font-medium hover:bg-[#89b4facc] transition-colors"
                      >
                        Tentar novamente
                      </button>
                      <button
                        onClick={() => setShowPortConfig(true)}
                        className="h-8 px-3 rounded-lg bg-[#31324480] text-[#a6adc8] text-xs font-medium hover:bg-[#313244] transition-colors"
                      >
                        Mudar porta
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <iframe
                ref={iframeRef}
                key={`${effectiveUrl}-${reloadTick}`}
                src={effectiveUrl}
                title="App Preview"
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                onLoad={handleIframeLoad}
                onError={() => setFrameError("load-error")}
              />
            </>
          )}
        </div>
      </div>

      {/* Errors Modal */}
      {errorsModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onPointerDown={() => setErrorsModalOpen(false)}>
          <div className="bg-[#181825] border border-[#313244] rounded-xl shadow-2xl w-[90vw] max-w-lg max-h-[70vh] flex flex-col" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#313244]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[#f38ba8]" />
                <span className="text-sm font-semibold text-[#cdd6f4]">
                  Erros do Console ({consoleErrors.length})
                </span>
              </div>
              <button onClick={() => setErrorsModalOpen(false)} className="p-1 rounded hover:bg-[#313244] transition-colors text-[#6c7086] hover:text-[#cdd6f4]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-1.5">
              {consoleErrors.map((error, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#f38ba808] border border-[#f38ba830] text-xs">
                  <span className="text-[#f38ba8] font-mono shrink-0 mt-0.5">{i + 1}.</span>
                  <span className="text-[#cdd6f4] font-mono break-all leading-relaxed">{error}</span>
                </div>
              ))}
              {consoleErrors.length === 0 && (
                <div className="text-center text-[#6c7086] text-sm py-8">Nenhum erro detectado.</div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-[#313244] flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => { clearConsoleErrors(); setErrorsModalOpen(false); }} className="border-[#313244] text-[#a6adc8] hover:bg-[#313244]">
                Limpar erros
              </Button>
              <Button size="sm" className="gap-2 bg-[#89b4fa] text-[#1e1e2e] hover:bg-[#89b4facc]" onClick={handleFixErrors} disabled={consoleErrors.length === 0}>
                <Wrench className="h-3.5 w-3.5" />
                Fixar erros
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
