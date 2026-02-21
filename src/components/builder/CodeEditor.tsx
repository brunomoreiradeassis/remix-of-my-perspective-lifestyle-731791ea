import { useEffect, useRef, useState } from "react";
import { useOllama } from "@/contexts/OllamaContext";
import { chatStream, extractTsxBlocks, makeChatCacheKey, getCacheItem, setCacheItem, pickModel } from "@/services/ollamaService";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, Wrench, Loader2, Columns, Save, Undo2, X } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

export function CodeEditor() {
  const { config, pushPreviewCode, lastError, projectComponents, addVirtualFile, models, virtualFiles, currentFile, updateVirtualFile } = useOllama();
  const [code, setCode] = useState("");
  const [originalCode, setOriginalCode] = useState("");
  const [aiOutput, setAiOutput] = useState<string | null>(null);
  const [loading, setLoading] = useState<"explain" | "generate" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [diffOld, setDiffOld] = useState<string | null>(null);
  const [diffNew, setDiffNew] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);
  const [explainModal, setExplainModal] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);

  const lines = code.split("\n");
  const hasChanges = code !== originalCode;

  // Load file content when currentFile changes
  useEffect(() => {
    if (!currentFile) return;
    const norm = (s: string) => s.replace(/\\+/g, "/");
    const vf = virtualFiles.find((f) => norm(f.path) === norm(currentFile));
    if (vf) {
      setCode(vf.code);
      setOriginalCode(vf.code);
    }
  }, [currentFile, virtualFiles]);

  const handleSave = () => {
    if (!currentFile) return;
    updateVirtualFile(currentFile, code);
    pushPreviewCode(code);
    setOriginalCode(code);
    toast({ title: "Arquivo salvo", description: currentFile, duration: 2000 });
  };

  const handleDiscard = () => {
    setCode(originalCode);
    toast({ title: "Alterações descartadas", duration: 2000 });
  };

  const handleExplain = async () => {
    if (loading) return;
    setLoading("explain");
    setExplanation("");
    setExplainModal(true);
    setTokenCount(0);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: `Explique o seguinte código de forma clara e profissional. Organize a explicação em tópicos, cobrindo:
- **Propósito**: O que o arquivo faz
- **Estrutura**: Como está organizado
- **Componentes/Funções**: Cada função ou componente principal
- **Dependências**: O que importa e por quê
- **Fluxo de dados**: Como os dados fluem
- **Pontos importantes**: Detalhes relevantes para manutenção` },
      { role: "user", content: `Arquivo: ${currentFile || "desconhecido"}\nContexto: ${projectComponents.join(", ")}\n\n${code}` },
    ];
    let full = "";
    const cfgExplain = { ...config, selectedModel: pickModel("explain", models.map((m) => m.name), config.selectedModel) };
    const cacheKey = makeChatCacheKey(cfgExplain, messages);
    const cached = getCacheItem(cacheKey);
    if (cached) {
      setExplanation(cached);
      setLoading(null);
      abortRef.current = null;
      return;
    }
    try {
      await chatStream({
        config: cfgExplain,
        messages,
        onToken: (t) => {
          full += t;
          setExplanation((prev) => (prev ?? "") + t);
          setTokenCount((c) => c + (t.split(/\s+/).length));
        },
        signal: abortRef.current.signal,
      });
      setCacheItem(cacheKey, full);
    } finally {
      setLoading(null);
      abortRef.current = null;
    }
  };

  const handleFixErrors = async () => {
    if (loading) return;
    setLoading("generate");
    setAiOutput("");
    setDiffOld(null);
    setDiffNew(null);
    setShowDiff(false);
    setTokenCount(0);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    let full = "";
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: "Corrija o seguinte código React/TypeScript com base no erro informado. Retorne APENAS um bloco ```tsx." },
      { role: "user", content: `Erro:\n${lastError || ""}\n\nContexto: ${projectComponents.join(", ")}\n\nCódigo atual:\n${code}` },
    ];
    try {
      const cfgFix = { ...config, selectedModel: pickModel("fix", models.map((m) => m.name), config.selectedModel) };
      await chatStream({
        config: cfgFix,
        messages,
        onToken: (t) => {
          full += t;
          setAiOutput((prev) => (prev ?? "") + t);
          setTokenCount((c) => c + (t.split(/\s+/).length));
        },
        signal: abortRef.current.signal,
      });
      const blocks = extractTsxBlocks(full);
      if (blocks.length > 0) {
        pushPreviewCode(blocks[0].code);
        toast({ title: "Erros corrigidos", description: "Preview atualizado", duration: 2000 });
        setDiffOld(code);
        setDiffNew(blocks[0].code);
        setShowDiff(true);
      }
    } finally {
      setLoading(null);
      abortRef.current = null;
    }
  };

  // Render explanation content with basic markdown
  const renderExplanation = (text: string) => {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("## ")) return <h2 key={i} className="text-base font-bold mt-3 mb-1 text-primary">{line.replace("## ", "")}</h2>;
      if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-semibold mt-2 mb-1 text-primary/80">{line.replace("### ", "")}</h3>;
      if (line.startsWith("- **")) {
        const parts = line.replace("- ", "").split(/\*\*([^*]+)\*\*/);
        return (
          <div key={i} className="flex items-start gap-1.5 ml-2 text-xs mb-1">
            <span className="text-primary mt-0.5">•</span>
            <span>{parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : <span key={j}>{p}</span>)}</span>
          </div>
        );
      }
      if (line.startsWith("- ")) return (
        <div key={i} className="flex items-start gap-1.5 ml-2 text-xs mb-1">
          <span className="text-primary mt-0.5">•</span>
          <span>{line.replace("- ", "")}</span>
        </div>
      );
      if (line.includes("**")) {
        const parts = line.split(/\*\*([^*]+)\*\*/);
        return <div key={i} className="text-xs">{parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : <span key={j}>{p}</span>)}</div>;
      }
      return <div key={i} className="text-xs">{line}</div>;
    });
  };

  return (
    <div className="h-full bg-background overflow-auto font-mono text-xs">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-foreground text-[11px]">
          {(currentFile?.split(/[\\\/]/).pop()) || "Nenhum arquivo"}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            title="Salvar alterações"
          >
            <Save className="h-3 w-3" />
            Salvar
          </button>
          {/* Discard */}
          <button
            onClick={handleDiscard}
            disabled={!hasChanges}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            title="Descartar alterações"
          >
            <Undo2 className="h-3 w-3" />
            Descartar
          </button>
          {/* Explain */}
          <button
            onClick={handleExplain}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground"
            disabled={loading === "explain"}
            title="Explicar código"
          >
            {loading === "explain" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Info className="h-3 w-3" />}
            Explicar
          </button>
          {/* Fix Errors */}
          <button
            onClick={handleFixErrors}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-warning text-warning-foreground"
            disabled={loading === "generate"}
            title="Corrigir erros"
          >
            {loading === "generate" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
            Corrigir
          </button>
          {/* Diff */}
          {diffOld && diffNew && (
            <button
              onClick={() => setShowDiff((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground"
              title="Mostrar diff"
            >
              <Columns className="h-3 w-3" />
              Diff
            </button>
          )}
          {loading && (
            <div className="text-[11px] text-muted-foreground">
              ~{tokenCount} tokens
            </div>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div className="p-4">
        {!currentFile ? (
          <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
            Selecione um arquivo no Explorer para editar.
          </div>
        ) : (
          <>
            <div className="relative">
              {/* Line numbers */}
              <div className="absolute left-0 top-0 w-8 select-none pointer-events-none z-10">
                {lines.map((_, i) => (
                  <div key={i} className="leading-6 text-right pr-2 text-muted-foreground/50">{i + 1}</div>
                ))}
              </div>
              {/* Editable textarea */}
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                className="w-full min-h-[400px] bg-transparent text-foreground leading-6 pl-10 pr-2 resize-none outline-none font-mono text-xs"
                style={{ height: `${Math.max(400, lines.length * 24 + 48)}px` }}
              />
            </div>
            {aiOutput && (
              <div className="mt-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Sugestão da IA (aplicada ao Preview)
                </div>
                <pre className="bg-secondary rounded-lg p-3 whitespace-pre-wrap text-xs">{aiOutput}</pre>
              </div>
            )}
            {showDiff && diffOld && diffNew && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Antes</div>
                  <pre className="bg-secondary rounded-lg p-3 whitespace-pre-wrap text-xs">{diffOld}</pre>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Depois</div>
                  <pre className="bg-secondary rounded-lg p-3 whitespace-pre-wrap text-xs">{diffNew}</pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Explain Modal */}
      {explainModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setExplainModal(false)}>
          <div className="bg-background border border-border rounded-xl shadow-2xl w-[90vw] max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Explicação — {currentFile?.split(/[\\\/]/).pop()}</span>
              </div>
              <button onClick={() => setExplainModal(false)} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {loading === "explain" && !explanation ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
              ) : (
                <div className="space-y-1">{renderExplanation(explanation || "")}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SyntaxLine({ content }: { content: string }) {
  const highlighted = content
    .replace(
      /(import|from|export|function|return|const|className)/g,
      '<span class="text-primary">$1</span>'
    )
    .replace(
      /(".*?"|'.*?'|`.*?`)/g,
      '<span style="color: hsl(142, 60%, 45%)">$1</span>'
    )
    .replace(
      /(\{|\}|\(|\))/g,
      '<span class="text-warning">$1</span>'
    )
    .replace(
      /(\/\/.*)/g,
      '<span class="text-muted-foreground">$1</span>'
    );

  return (
    <pre
      className="flex-1 whitespace-pre"
      dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }}
    />
  );
}
