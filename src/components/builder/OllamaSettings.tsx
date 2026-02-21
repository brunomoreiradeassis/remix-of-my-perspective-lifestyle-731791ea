import { useState } from "react";
import { X, RefreshCw, Server, Cpu, Thermometer, Hash, Loader2, Check, AlertCircle, Download } from "lucide-react";
import { useOllama } from "@/contexts/OllamaContext";

interface OllamaSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function OllamaSettings({ open, onClose }: OllamaSettingsProps) {
  const { isConnected, isChecking, config, models, updateConfig, checkConnection } = useOllama();
  const [localUrl, setLocalUrl] = useState(config.baseUrl);
  const [pullModel, setPullModel] = useState("");
  const [isPulling, setIsPulling] = useState(false);

  if (!open) return null;

  const handleTestConnection = async () => {
    updateConfig({ baseUrl: localUrl });
    await checkConnection();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Configurações do Ollama</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Status */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
            <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${isConnected ? "bg-success" : "bg-destructive"} ${isChecking ? "animate-pulse" : ""}`} />
            <span className="text-xs font-medium text-foreground">
              {isChecking ? "Verificando..." : isConnected ? "Conectado ao Ollama" : "Desconectado"}
            </span>
            {isConnected && models.length > 0 && (
              <span className="text-xs text-muted-foreground ml-auto">{models.length} modelo{models.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {/* URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Server className="h-3 w-3" /> URL Base
            </label>
            <div className="flex gap-2">
              <input
                value={localUrl}
                onChange={(e) => setLocalUrl(e.target.value)}
                className="flex-1 bg-secondary border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
                placeholder="http://localhost:11434"
              />
              <button
                onClick={handleTestConnection}
                disabled={isChecking}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1.5"
              >
                {isChecking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Testar
              </button>
            </div>
          </div>

          {/* Model Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Cpu className="h-3 w-3" /> Modelo
            </label>
            {models.length > 0 ? (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {models.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => updateConfig({ selectedModel: m.name })}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                      config.selectedModel === m.name
                        ? "bg-primary/10 border border-primary/30 text-foreground"
                        : "bg-secondary hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <span className="font-mono">{m.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">{m.size}</span>
                      {config.selectedModel === m.name && <Check className="h-3 w-3 text-primary" />}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary text-xs text-muted-foreground">
                <AlertCircle className="h-3.5 w-3.5" />
                {isConnected ? "Nenhum modelo encontrado" : "Conecte ao Ollama para ver modelos"}
              </div>
            )}
          </div>

          {/* Temperature */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Thermometer className="h-3 w-3" /> Temperatura: {config.temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={config.temperature}
              onChange={(e) => updateConfig({ temperature: parseFloat(e.target.value) })}
              className="w-full accent-primary h-1.5"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Preciso</span>
              <span>Criativo</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Hash className="h-3 w-3" /> Max Tokens
            </label>
            <input
              type="number"
              value={config.maxTokens}
              onChange={(e) => updateConfig({ maxTokens: parseInt(e.target.value) || 2048 })}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
              min={256}
              max={8192}
              step={256}
            />
          </div>

          {/* Pull Model */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Download className="h-3 w-3" /> Baixar modelo
            </label>
            <div className="flex gap-2">
              <input
                value={pullModel}
                onChange={(e) => setPullModel(e.target.value)}
                className="flex-1 bg-secondary border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
                placeholder="ex: codellama:13b"
              />
              <button
                onClick={async () => {
                  if (!pullModel.trim() || isPulling) return;
                  setIsPulling(true);
                  try {
                    const res = await fetch(`${config.baseUrl}/api/pull`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: pullModel.trim() }),
                    });
                    if (res.ok) {
                      await checkConnection();
                      setPullModel("");
                    }
                  } finally {
                    setIsPulling(false);
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1.5"
                disabled={!pullModel.trim() || isPulling}
              >
                {isPulling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                Baixar
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-secondary text-foreground hover:bg-muted transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
