import { Loader2 } from "lucide-react";
import { useOllama } from "@/contexts/OllamaContext";

export function LoadingCard() {
  const { commandProgress } = useOllama();

  if (commandProgress.status === "idle" || commandProgress.status === "running") return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-card border border-border rounded-xl shadow-2xl px-5 py-4 min-w-[280px] max-w-[360px]">
        <div className="flex items-center gap-3 mb-2">
          <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
          <span className="text-sm font-semibold text-foreground">Carregando projeto</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{commandProgress.message}</p>
        <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${commandProgress.progress}%` }}
          />
        </div>
        {commandProgress.status === "error" && (
          <p className="text-xs text-destructive mt-2">{commandProgress.message}</p>
        )}
      </div>
    </div>
  );
}
