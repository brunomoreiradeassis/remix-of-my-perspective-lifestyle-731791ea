import React from "react";
import { useOllama } from "@/contexts/OllamaContext";
import { Folder, X, Clock, Trash2 } from "lucide-react";

interface RecentProjectsModalProps {
  open: boolean;
  onClose: () => void;
}

export function RecentProjectsModal({ open, onClose }: RecentProjectsModalProps) {
  const { recentProjects, openRecentDirectory, removeRecentProject, dirHandle } = useOllama();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md border border-border bg-card p-6 shadow-lg rounded-xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Projetos Recentes</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded-md transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
          {recentProjects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground italic">
              Nenhum projeto recente encontrado.
            </div>
          ) : (
            recentProjects.map((project) => (
              <div
                key={project.name}
                className={`flex items-center gap-2 p-3 rounded-lg border overflow-hidden transition-all ${
                  dirHandle?.name === project.name
                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                    : "border-border hover:border-primary/30 hover:bg-secondary/30"
                }`}
              >
                <button
                  onClick={async () => {
                    await openRecentDirectory(project.handle, project.path);
                    onClose();
                  }}
                  className="flex flex-1 items-center gap-3 text-left min-w-0"
                >
                  <div className={`p-2 rounded-md shrink-0 ${
                    dirHandle?.name === project.name ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                  }`}>
                    <Folder className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{project.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono break-all line-clamp-1">
                      {project.path || "Caminho não mapeado"}
                    </div>
                    {dirHandle?.name === project.name && (
                      <div className="text-[10px] text-primary font-medium uppercase tracking-wider mt-0.5">Aberto agora</div>
                    )}
                  </div>
                </button>
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRecentProject(project.name);
                  }}
                  className="p-1.5 shrink-0 hover:bg-destructive/10 hover:text-destructive rounded-md transition-all text-muted-foreground"
                  title="Remover do histórico"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
