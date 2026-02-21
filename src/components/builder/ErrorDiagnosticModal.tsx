import { useState } from "react";
import {
  X,
  AlertTriangle,
  Wrench,
  Trash2,
  PackagePlus,
  RefreshCw,
  Bug,
  Terminal,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useOllama } from "@/contexts/OllamaContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ErrorDiagnosticModalProps {
  open: boolean;
  onClose: () => void;
}

export function ErrorDiagnosticModal({ open, onClose }: ErrorDiagnosticModalProps) {
  const {
    allErrors,
    buildErrors,
    consoleErrors,
    clearBuildErrors,
    clearConsoleErrors,
    runBuildCheck,
    nukeNodeModules,
    installDependency,
    setPendingErrorFix,
    isFixingErrors,
  } = useOllama();

  const [activeTab, setActiveTab] = useState<"all" | "build" | "console">("all");
  const [pkgInput, setPkgInput] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isNuking, setIsNuking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [expandedActions, setExpandedActions] = useState(false);

  if (!open) return null;

  const filteredErrors = activeTab === "all"
    ? allErrors
    : activeTab === "build"
    ? allErrors.filter((e) => e.type === "build")
    : allErrors.filter((e) => e.type === "console");

  const handleFixAll = () => {
    const errorText = filteredErrors
      .map((e, i) => `${i + 1}. [${e.type.toUpperCase()}] ${e.message}`)
      .join("\n");
    const fixPrompt = `Corrija os seguintes erros detectados no projeto:\n\n${errorText}\n\nAnalise cada erro, identifique os arquivos afetados e gere as correcoes necessarias diretamente nos arquivos.`;
    setPendingErrorFix(fixPrompt);
    onClose();
  };

  const handleFixSingle = (err: { type: "build" | "console"; message: string }) => {
    const fixPrompt = `Corrija o seguinte erro [${err.type.toUpperCase()}] detectado no projeto:\n\n${err.message}\n\nAnalise o erro, identifique o arquivo afetado e gere a correcao necessaria diretamente no arquivo.`;
    setPendingErrorFix(fixPrompt);
    onClose();
  };

  const handleRunBuildCheck = async () => {
    setIsChecking(true);
    await runBuildCheck();
    setIsChecking(false);
  };

  const handleNukeNodeModules = async () => {
    setIsNuking(true);
    await nukeNodeModules();
    setIsNuking(false);
  };

  const handleInstallPkg = async () => {
    if (!pkgInput.trim()) return;
    setIsInstalling(true);
    await installDependency(pkgInput.trim());
    setPkgInput("");
    setIsInstalling(false);
  };

  // Detect missing packages from errors
  const missingPackages = allErrors
    .map((e) => {
      const m = e.message.match(/Cannot find module ['"]([^'"]+)['"]/i)
        || e.message.match(/Module not found.*['"]([^'"]+)['"]/i)
        || e.message.match(/Could not resolve ['"]([^'"]+)['"]/i);
      return m?.[1];
    })
    .filter((pkg): pkg is string => !!pkg && !pkg.startsWith(".") && !pkg.startsWith("/"))
    .filter((pkg, i, arr) => arr.indexOf(pkg) === i);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onPointerDown={onClose}
    >
      <div
        className="flex flex-col border rounded-xl shadow-2xl w-[92vw] max-w-2xl max-h-[80vh]"
        style={{ backgroundColor: "#1e1e2e", borderColor: "#2a2b3d" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3.5 border-b"
          style={{ borderColor: "#2a2b3d" }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg" style={{ backgroundColor: "#f38ba820" }}>
              <Bug className="h-4 w-4 text-[#f38ba8]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#cdd6f4]">
                Diagnostico de Erros
              </h2>
              <span className="text-[11px] text-[#6c7086]">
                {allErrors.length} erro(s) detectado(s)
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#2a2b3d] transition-colors text-[#6c7086] hover:text-[#cdd6f4]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Fixing indicator */}
        {isFixingErrors && (
          <div className="flex items-center gap-2 px-5 py-2 border-b" style={{ borderColor: "#2a2b3d", backgroundColor: "#89b4fa08" }}>
            <RefreshCw className="h-3.5 w-3.5 text-[#89b4fa] animate-spin" />
            <span className="text-[11px] text-[#89b4fa] font-medium">A IA esta analisando e corrigindo os erros...</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 pb-2">
          {(["all", "build", "console"] as const).map((tab) => {
            const count =
              tab === "all"
                ? allErrors.length
                : tab === "build"
                ? buildErrors.length
                : consoleErrors.length;
            const label = tab === "all" ? "Todos" : tab === "build" ? "Build" : "Console";
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-[#89b4fa20] text-[#89b4fa]"
                    : "text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#2a2b3d]"
                }`}
              >
                {tab === "build" && <Terminal className="h-3 w-3" />}
                {tab === "console" && <AlertTriangle className="h-3 w-3" />}
                {label}
                {count > 0 && (
                  <Badge
                    className={`h-4 min-w-4 px-1 text-[10px] leading-none ${
                      tab === "build"
                        ? "bg-[#fab38720] text-[#fab387] border-0"
                        : tab === "console"
                        ? "bg-[#f38ba820] text-[#f38ba8] border-0"
                        : "bg-[#6c708620] text-[#cdd6f4] border-0"
                    }`}
                  >
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Error List */}
        <div className="flex-1 overflow-auto px-5 py-2 space-y-1.5 min-h-0">
          {filteredErrors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="h-10 w-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "#a6e3a120" }}>
                <RefreshCw className="h-5 w-5 text-[#a6e3a1]" />
              </div>
              <span className="text-sm text-[#6c7086]">Nenhum erro detectado</span>
              <Button
                size="sm"
                variant="outline"
                className="text-[11px] border-[#2a2b3d] text-[#cdd6f4] bg-transparent hover:bg-[#2a2b3d]"
                onClick={handleRunBuildCheck}
                disabled={isChecking}
              >
                {isChecking ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Verificar build
              </Button>
            </div>
          ) : (
            filteredErrors.map((err, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-xs group"
                style={{
                  borderColor: err.type === "build" ? "#fab38730" : "#f38ba830",
                  backgroundColor: err.type === "build" ? "#fab38708" : "#f38ba808",
                }}
              >
                <Badge
                  className={`shrink-0 mt-0.5 h-4 px-1.5 text-[9px] uppercase font-bold tracking-wider border-0 ${
                    err.type === "build"
                      ? "bg-[#fab38720] text-[#fab387]"
                      : "bg-[#f38ba820] text-[#f38ba8]"
                  }`}
                >
                  {err.type}
                </Badge>
                <span className="flex-1 text-[#cdd6f4] font-mono break-all leading-relaxed">
                  {err.message}
                </span>
                <button
                  onClick={() => handleFixSingle(err)}
                  disabled={isFixingErrors}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 bg-[#89b4fa20] text-[#89b4fa] hover:bg-[#89b4fa40] disabled:opacity-50"
                  title="Fixar este erro com IA"
                >
                  <Wrench className="h-3 w-3" />
                  Fixar
                </button>
              </div>
            ))
          )}
        </div>

        {/* Missing packages suggestion */}
        {missingPackages.length > 0 && (
          <div className="mx-5 mb-2 px-3 py-2.5 rounded-lg border" style={{ borderColor: "#89b4fa30", backgroundColor: "#89b4fa08" }}>
            <div className="flex items-center gap-2 mb-2">
              <PackagePlus className="h-3.5 w-3.5 text-[#89b4fa]" />
              <span className="text-[11px] font-medium text-[#89b4fa]">Pacotes possivelmente faltando:</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {missingPackages.map((pkg) => (
                <button
                  key={pkg}
                  onClick={() => installDependency(pkg)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors bg-[#89b4fa15] text-[#89b4fa] hover:bg-[#89b4fa30]"
                >
                  <PackagePlus className="h-3 w-3" />
                  {pkg}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions panel */}
        <div className="px-5 py-3 border-t" style={{ borderColor: "#2a2b3d" }}>
          {/* Expandable actions */}
          <button
            onClick={() => setExpandedActions(!expandedActions)}
            className="flex items-center gap-1.5 text-[11px] text-[#6c7086] hover:text-[#cdd6f4] mb-2 transition-colors"
          >
            {expandedActions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Acoes avancadas
          </button>

          {expandedActions && (
            <div className="flex flex-col gap-2 mb-3 p-3 rounded-lg" style={{ backgroundColor: "#18182580" }}>
              {/* Build check */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#6c7086]">Verificar erros de build (tsc --noEmit)</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-[#2a2b3d] text-[#cdd6f4] bg-transparent hover:bg-[#2a2b3d]"
                  onClick={handleRunBuildCheck}
                  disabled={isChecking}
                >
                  {isChecking ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Terminal className="h-3 w-3 mr-1" />}
                  Verificar
                </Button>
              </div>

              {/* Nuke node_modules */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#6c7086]">Apagar node_modules e reinstalar</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-[#f38ba830] text-[#f38ba8] bg-transparent hover:bg-[#f38ba815]"
                  onClick={handleNukeNodeModules}
                  disabled={isNuking}
                >
                  {isNuking ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                  Reinstalar
                </Button>
              </div>

              {/* Install specific package */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#6c7086] shrink-0">Instalar pacote:</span>
                <input
                  value={pkgInput}
                  onChange={(e) => setPkgInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleInstallPkg();
                  }}
                  placeholder="ex: lodash @types/node"
                  className="flex-1 h-7 rounded border px-2 text-[11px] font-mono outline-none focus:ring-1 focus:ring-[#89b4fa] text-[#cdd6f4] placeholder:text-[#45475a]"
                  style={{ backgroundColor: "#1e1e2e", borderColor: "#2a2b3d" }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-[#2a2b3d] text-[#a6e3a1] bg-transparent hover:bg-[#a6e3a115]"
                  onClick={handleInstallPkg}
                  disabled={isInstalling || !pkgInput.trim()}
                >
                  {isInstalling ? <RefreshCw className="h-3 w-3 animate-spin" /> : <PackagePlus className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          )}

          {/* Main action buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-[#2a2b3d] text-[#6c7086] bg-transparent hover:bg-[#2a2b3d] hover:text-[#cdd6f4]"
                onClick={() => {
                  clearBuildErrors();
                  clearConsoleErrors();
                }}
              >
                Limpar tudo
              </Button>
            </div>
            <Button
              size="sm"
              className="h-8 gap-2 text-xs font-semibold"
              style={{
                backgroundColor: allErrors.length > 0 ? "#89b4fa" : "#2a2b3d",
                color: allErrors.length > 0 ? "#1e1e2e" : "#6c7086",
              }}
              onClick={handleFixAll}
              disabled={allErrors.length === 0 || isFixingErrors}
            >
              {isFixingErrors ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              {isFixingErrors ? "Corrigindo..." : "Fixar com IA"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
