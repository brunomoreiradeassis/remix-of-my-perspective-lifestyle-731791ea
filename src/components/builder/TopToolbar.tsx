import { useState } from "react";
import {
  Sparkles,
  Settings,
  Play,
  Code,
  Eye,
  Layers,
  Server,
  FolderOpen,
  History,
  Terminal as TerminalIcon,
  Zap,
  PanelLeftOpen,
  Bug,
  Circle,
} from "lucide-react";
import { useOllama } from "@/contexts/OllamaContext";
import { OllamaSettings } from "./OllamaSettings";
import { RecentProjectsModal } from "./RecentProjectsModal";
import { ErrorDiagnosticModal } from "./ErrorDiagnosticModal";
import { TerminalPanel } from "./TerminalPanel";
import { FileSidebar } from "./FileSidebar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface TopToolbarProps {
  view: "preview" | "code";
  onViewChange: (view: "preview" | "code") => void;
}

export function TopToolbar({ view, onViewChange }: TopToolbarProps) {
  const {
    isConnected,
    isChecking,
    config,
    latencyMs,
    openDirectory,
    dirHandle,
    projectPath,
    devServerPort,
    setManualPort,
    allErrors,
    runBuildCheck,
    terminalRunning,
    serverOnline,
  } = useOllama();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [errorsModalOpen, setErrorsModalOpen] = useState(false);

  return (
    <>
      <header className="h-12 flex items-center justify-between px-4 bg-toolbar-bg border-b border-border shrink-0">
        {/* Logo & Project Name */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-sm font-bold tracking-tight text-foreground">
              BuilderAI
            </span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span
            className="text-xs text-muted-foreground font-mono truncate max-w-[180px]"
            title={projectPath || dirHandle?.name || "meu-projeto"}
          >
            {(() => {
              if (projectPath) {
                const parts = projectPath.replace(/\\+/g, "/").split("/");
                return parts[parts.length - 1] || parts[parts.length - 2] || projectPath;
              }
              return dirHandle ? dirHandle.name : "meu-projeto";
            })()}
          </span>
          {config.selectedModel && (
            <Badge variant="secondary" className="ml-2 hidden sm:flex">
              {config.selectedModel}
            </Badge>
          )}
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-0.5">
          <button
            onClick={() => onViewChange("preview")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              view === "preview"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Preview</span>
          </button>
          <button
            onClick={() => onViewChange("code")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              view === "code"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Codigo</span>
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {devServerPort && (
            <button
              onClick={() => {
                onViewChange("preview");
                setManualPort(devServerPort);
              }}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
              title={`localhost:${devServerPort}`}
            >
              <Zap className="h-3.5 w-3.5" />
              localhost:{devServerPort}
            </button>
          )}

          {/* Open Folder Button */}
          <button
            onClick={openDirectory}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              dirHandle 
                ? "bg-primary/10 text-primary hover:bg-primary/20" 
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
            title={dirHandle ? `Pasta: ${dirHandle.name}` : "Abrir Pasta Local"}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{dirHandle ? "Pasta Aberta" : "Abrir Pasta"}</span>
          </button>

          {/* Recent Projects Button */}
          <button
            onClick={() => setShowRecent(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Projetos Recentes"
          >
            <History className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Recentes</span>
          </button>

          {/* Ollama Status */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={
              isConnected
                ? `Ollama: ${config.selectedModel || "conectado"} | ${typeof latencyMs === "number" ? `${latencyMs}ms` : "latencia n/d"}`
                : "Ollama desconectado"
            }
          >
            <div className="relative">
              <Server className="h-3.5 w-3.5" />
              <div
                className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-toolbar-bg ${
                  isChecking ? "bg-warning animate-pulse" : isConnected ? "bg-success" : "bg-destructive"
                }`}
              />
            </div>
            <span className="hidden xl:inline">Ollama</span>
          </button>


          {/* Explorer Sheet (left) */}
          <Sheet open={explorerOpen} onOpenChange={setExplorerOpen}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SheetTrigger asChild>
                    <button
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      title="Explorer"
                    >
                      <PanelLeftOpen className="h-4 w-4" />
                    </button>
                  </SheetTrigger>
                </TooltipTrigger>
                <TooltipContent>Explorer</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <SheetContent side="left" className="w-72 p-0">
              <FileSidebar />
            </SheetContent>
          </Sheet>

          {/* Error Diagnostic Button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    setErrorsModalOpen(true);
                    runBuildCheck();
                  }}
                  className={`relative p-1.5 rounded-lg transition-colors ${
                    allErrors.length > 0
                      ? "text-[#f38ba8] bg-[#f38ba815] hover:bg-[#f38ba830]"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                  title="Diagnostico de Erros"
                >
                  <Bug className="h-4 w-4" />
                  {allErrors.length > 0 && (
                    <>
                      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#f38ba8] px-1 text-[9px] font-bold text-[#1e1e2e]">
                        {allErrors.length > 99 ? "99+" : allErrors.length}
                      </span>
                      <span className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-[#f38ba8] animate-ping opacity-40" />
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {allErrors.length > 0
                  ? `${allErrors.length} erro(s) detectado(s) - Clique para diagnosticar`
                  : "Diagnostico de Erros - Verificar build e console"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Terminal Sheet (right) */}
          <Sheet>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SheetTrigger asChild>
                    <button
                      className={`relative p-1.5 rounded-lg transition-colors ${
                        terminalRunning
                          ? "text-[#a6e3a1] bg-[#a6e3a115] hover:bg-[#a6e3a130]"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      }`}
                      title="Terminal"
                    >
                      <TerminalIcon className="h-4 w-4" />
                      {/* Server status dot */}
                      <Circle
                        className="absolute -top-0.5 -right-0.5 h-2 w-2"
                        fill={serverOnline ? (terminalRunning ? "#a6e3a1" : "#89b4fa") : "#f38ba8"}
                        style={{ color: serverOnline ? (terminalRunning ? "#a6e3a1" : "#89b4fa") : "#f38ba8" }}
                      />
                    </button>
                  </SheetTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  {terminalRunning
                    ? "Terminal (processo rodando)"
                    : serverOnline
                      ? "Terminal"
                      : "Terminal (servidor offline)"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <SheetContent side="right" className="w-[90vw] sm:max-w-xl p-0 border-0" style={{ backgroundColor: "#181825" }}>
              <TerminalPanel />
            </SheetContent>
          </Sheet>
          
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Settings className="h-4 w-4" />
          </button>
          
          <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity glow-primary">
            <Play className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Publicar</span>
          </button>
        </div>
      </header>

      <OllamaSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <RecentProjectsModal open={showRecent} onClose={() => setShowRecent(false)} />
      <ErrorDiagnosticModal open={errorsModalOpen} onClose={() => setErrorsModalOpen(false)} />
    </>
  );
}
