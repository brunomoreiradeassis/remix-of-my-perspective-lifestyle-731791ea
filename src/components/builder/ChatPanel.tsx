import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type FormEvent,
} from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  Play,
  CheckCircle,
  CheckCircle2,
  XCircle,
  FileText,
  StopCircle,
  Trash2,
  MessageSquare,
  Plus,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  RotateCcw,
  AlertTriangle,
  ShieldCheck,
  GitBranch,
  Zap,
  Eye,
  Info,
  Terminal,
  ImagePlus,
  X,
  Sparkles,
  Search,
  Circle,
  FilePlus,
  FileEdit,
  FileX,
  PenLine,
} from "lucide-react";
import { useOllama } from "@/contexts/OllamaContext";
import {
  chatStream,
  extractAllCodeBlocks,
  extractFileOperations,
  extractPlanSteps,
} from "@/services/ollamaService";
import { toast } from "@/components/ui/use-toast";
import { PlanModal } from "./PlanModal";
import {
  scanProject,
  analyzeImpact,
  generateDiffSummary,
  searchFilesByKeyword,
  type ProjectMetadata,
} from "@/services/projectScanner";
import {
  buildPlanningPrompt,
  buildExecutionPrompt,
  buildConversationalPrompt,
  getSystemLimitations,
  getActiveSkills,
  isActionRequest,
} from "@/services/skillsRegistry";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  plan?: PlanData;
  validation?: ValidationResult;
  questionnaire?: QuestionnaireData;
  executionProgress?: ExecutionProgressData;
}

interface PlanData {
  raw: string;
  steps: Array<{ title: string; files: string[] }>;
  fileOps: { create: string[]; modify: string[]; delete: string[] };
  status?: "idle" | "approved" | "running" | "done" | "error" | "rejected";
  stepStatus?: Array<"pending" | "running" | "done" | "error">;
  impactAnalysis?: {
    cascadeFiles: string[];
    warnings: string[];
  };
  diffSummaries?: string[];
}

interface ValidationResult {
  passed: boolean;
  checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
  }>;
}

/* ------------------------------------------------------------------ */
/* Questionnaire types                                                 */
/* ------------------------------------------------------------------ */
interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionPage {
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface QuestionnaireData {
  pages: QuestionPage[];
  answers: Record<number, number[]>; // pageIndex -> selected option indices
  currentPage: number;
  completed: boolean;
  summary?: string;
}

/* ------------------------------------------------------------------ */
/* Execution progress types                                            */
/* ------------------------------------------------------------------ */
interface FileProgressItem {
  path: string;
  action: "create" | "modify" | "delete";
  status: "pending" | "running" | "done" | "error";
  description?: string;
}

interface ExecutionProgressData {
  title: string;
  subtitle?: string;
  files: FileProgressItem[];
  status: "running" | "done" | "error";
  summary?: string;
}

/* ------------------------------------------------------------------ */
/* Helper: resolve filename from a code block to the correct plan path */
/* ------------------------------------------------------------------ */
function resolveBlockFileName(
  block: { filename?: string; code: string; lang: string },
  stepFiles: string[],
  planCreateFiles: string[],
  planModifyFiles: string[],
  resolvedSoFar: Set<string>,
  routeFileFn: (fname: string) => string,
): string {
  if (block.filename && (block.filename.includes("/") || block.filename.includes("\\"))) {
    return block.filename.replace(/^[\\/]+/, "");
  }

  if (block.filename) {
    const baseName = block.filename.split("/").pop() || block.filename;
    const allPlanFiles = [...planCreateFiles, ...planModifyFiles, ...stepFiles];
    const match = allPlanFiles.find((f) => f.endsWith("/" + baseName) || f === baseName);
    if (match) return match;
    return routeFileFn(baseName);
  }

  const allCandidates = stepFiles.length > 0
    ? [...stepFiles]
    : [...planCreateFiles, ...planModifyFiles];

  const exportMatch = block.code.match(/export\s+default\s+function\s+(\w+)/);
  const exportName = exportMatch?.[1];
  if (exportName) {
    const found = allCandidates.find((f) => {
      const fBase = f.split("/").pop()?.replace(/\.\w+$/, "") || "";
      return fBase.toLowerCase() === exportName.toLowerCase();
    });
    if (found && !resolvedSoFar.has(found)) return found;
  }

  const namedExport = block.code.match(/export\s+(?:const|function)\s+(\w+)/);
  const namedName = namedExport?.[1];
  if (namedName) {
    const found = allCandidates.find((f) => {
      const fBase = f.split("/").pop()?.replace(/\.\w+$/, "") || "";
      return fBase.toLowerCase() === namedName.toLowerCase();
    });
    if (found && !resolvedSoFar.has(found)) return found;
  }

  for (const f of allCandidates) {
    if (!resolvedSoFar.has(f)) return f;
  }

  return routeFileFn("GeneratedComponent.tsx");
}

/* ------------------------------------------------------------------ */
/* Route file to the proper directory based on extension/type          */
/* ------------------------------------------------------------------ */
function routeFile(filename: string): string {
  if (filename.includes("/") || filename.includes("\\")) {
    return filename.replace(/^[\\/]+/, "");
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith(".css")) return `src/${filename}`;
  if (lower === "index.html") return filename;
  if (lower.endsWith(".html")) return filename;
  if (lower.endsWith(".json")) return filename;
  if (lower.endsWith(".md")) return filename;
  if (/\.(tsx|jsx|ts)$/.test(lower)) return `src/components/${filename}`;
  return `src/${filename}`;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

const PROTECTED_PATTERNS: RegExp[] = [
  /^src\/components\/ui\//i,
  /^src\/contexts\//i,
  /^src\/lib\//i,
  /^src\/types\//i,
  /^src\/main\.(t|j)sx$/i,
  /^src\/App\.(t|j)sx$/i,
  /^index\.html$/i,
];

const IGNORED_PATH_SUBSTRINGS: string[] = [
  "Projetos/formulario-branco-teste",
  "Projetos\\formulario-branco-teste",
];

function isProtectedPath(_: string): boolean {
  return false;
}

function isIgnoredPath(p: string): boolean {
  const l = p.toLowerCase();
  return IGNORED_PATH_SUBSTRINGS.some((s) => l.includes(s.toLowerCase()));
}

/* ------------------------------------------------------------------ */
/* Post-processing: validate generated code blocks                    */
/* ------------------------------------------------------------------ */
function validateCodeBlocks(
  blocks: Array<{ filename?: string; code: string; lang: string }>,
  plan: PlanData,
): ValidationResult {
  const checks: ValidationResult["checks"] = [];

  const allPlanFiles = [...plan.fileOps.create, ...plan.fileOps.modify];
  const blockFileNames = blocks
    .map((b) => b.filename)
    .filter(Boolean) as string[];
  const missingFiles = allPlanFiles.filter(
    (pf) =>
      !blockFileNames.some(
        (bf) => bf === pf || bf.endsWith("/" + pf.split("/").pop()),
      ),
  );
  if (missingFiles.length > 0) {
    checks.push({
      name: "Arquivos do plano",
      status: "warn",
      message: `Arquivos planejados nao gerados: ${missingFiles.join(", ")}`,
    });
  } else {
    checks.push({
      name: "Arquivos do plano",
      status: "ok",
      message: `Todos os ${allPlanFiles.length} arquivos planejados foram gerados`,
    });
  }

  // Ignorar validação de proteção; apenas sinalizar se for pasta ignorada
  for (const b of blocks) {
    const fn = b.filename || "";
    if (fn && isIgnoredPath(fn)) {
      checks.push({
        name: "Arquivo ignorado",
        status: "warn",
        message: `Bloco aponta para caminho ignorado: ${fn}`,
      });
    }
  }

  for (const block of blocks) {
    const hasEllipsis =
      block.code.includes("// ... resto") ||
      block.code.includes("// ...rest") ||
      block.code.includes("/* ... */") ||
      block.code.includes("// ... existing");
    if (hasEllipsis) {
      checks.push({
        name: "Codigo truncado",
        status: "error",
        message: `${block.filename || "Bloco"} contem codigo abreviado/truncado`,
      });
    }
  }

  for (const block of blocks) {
    if (!block.filename) {
      const firstLine = block.code.split("\n")[0] || "";
      const hasComment =
        firstLine.startsWith("//") || firstLine.startsWith("<!--");
      if (!hasComment) {
        checks.push({
          name: "Caminho de arquivo",
          status: "warn",
          message: "Um bloco nao possui comentario com caminho do arquivo",
        });
      }
    }
  }

  for (const block of blocks) {
    if (!block.code.includes("import") && /\.(tsx|jsx)$/.test(block.filename || "")) {
      const hasJSX = /<\w/.test(block.code);
      if (hasJSX) {
        checks.push({
          name: "Imports",
          status: "warn",
          message: `${block.filename || "Bloco"} parece usar JSX mas nao importa React`,
        });
      }
    }
  }

  if (checks.filter((c) => c.status === "error").length === 0 &&
      checks.filter((c) => c.status === "warn").length === 0) {
    checks.push({
      name: "Validacao geral",
      status: "ok",
      message: "Todos os blocos passaram na validacao",
    });
  }

  return {
    passed: checks.every((c) => c.status !== "error"),
    checks,
  };
}

/* ------------------------------------------------------------------ */
/* Helper: extract diagnostic/analysis text from plan response         */
/* ------------------------------------------------------------------ */
function extractDiagnosticText(content: string): string {
  let cleaned = content.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/`(?:pnpm|npm|yarn|npx|node|vite)\s[^`]+`/g, "");
  cleaned = cleaned.replace(/###?\s*(?:Passos|Steps|Passo a passo)[\s\S]*?(?=###|\n\n\n|$)/gi, "");
  cleaned = cleaned.replace(/###?\s*(?:Arquivos a criar|Arquivos a modificar|Arquivos a excluir|Arquivos novos|Arquivos existentes|Files to create|Files to modify|Files to delete)[\s\S]*?(?=###|\n\n\n|$)/gi, "");
  cleaned = cleaned.replace(/###?\s*(?:Validacao|Validation)[\s\S]*?(?=###|\n\n\n|$)/gi, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

/* ------------------------------------------------------------------ */
/* Helper: format markdown-like text for display                       */
/* ------------------------------------------------------------------ */
function formatMessageContent(content: string): React.ReactNode {
  let cleaned = content.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/`(?:pnpm|npm|yarn|npx|node|vite)\s[^`]+`/g, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  
  if (!cleaned) return null;
  
  const lines = cleaned.split("\n");
  const elements: React.ReactNode[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith("### ")) {
      elements.push(<div key={i} className="font-semibold text-foreground mt-2 mb-1">{line.replace(/^###\s*/, "")}</div>);
    } else if (line.startsWith("## ")) {
      elements.push(<div key={i} className="font-bold text-foreground mt-2 mb-1">{line.replace(/^##\s*/, "")}</div>);
    } else if (line.startsWith("# ")) {
      elements.push(<div key={i} className="font-bold text-foreground text-sm mt-2 mb-1">{line.replace(/^#\s*/, "")}</div>);
    }
    else if (/^\s*[-*]\s/.test(line)) {
      const text = line.replace(/^\s*[-*]\s/, "");
      elements.push(
        <div key={i} className="flex gap-1.5 pl-2">
          <span className="text-muted-foreground shrink-0">-</span>
          <span>{renderInlineFormatting(text)}</span>
        </div>
      );
    }
    else if (/^\s*\d+\.\s/.test(line)) {
      const match = line.match(/^\s*(\d+)\.\s(.+)/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-1.5 pl-2">
            <span className="text-muted-foreground shrink-0">{match[1]}.</span>
            <span>{renderInlineFormatting(match[2])}</span>
          </div>
        );
      }
    }
    else if (!line.trim()) {
      elements.push(<div key={i} className="h-1.5" />);
    }
    else {
      elements.push(<div key={i}>{renderInlineFormatting(line)}</div>);
    }
  }
  
  return <>{elements}</>;
}

function renderInlineFormatting(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("__") && part.endsWith("__")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith("`") && cp.endsWith("`")) {
        return <code key={`${i}-${j}`} className="bg-secondary/80 px-1 py-0.5 rounded text-[10px] font-mono">{cp.slice(1, -1)}</code>;
      }
      return <span key={`${i}-${j}`}>{cp}</span>;
    });
  });
}

/* ------------------------------------------------------------------ */
/* Helper: parse questionnaire from AI response                        */
/* ------------------------------------------------------------------ */
function parseQuestionsFromResponse(text: string): QuestionPage[] | null {
  // Look for QUESTIONNAIRE: blocks in the response
  const questionnaireMatch = text.match(/QUESTIONNAIRE_START([\s\S]*?)QUESTIONNAIRE_END/);
  if (!questionnaireMatch) return null;

  const raw = questionnaireMatch[1].trim();
  const pages: QuestionPage[] = [];

  // Parse each QUESTION block
  const questionBlocks = raw.split(/QUESTION\s*\d*/gi).filter(Boolean);
  
  for (const block of questionBlocks) {
    const lines = block.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) continue;
    
    const question = lines[0].replace(/^[:\s]+/, "").trim();
    const options: QuestionOption[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const optMatch = lines[i].match(/^[-*\d.)]\s*(.*)/);
      if (optMatch) {
        const parts = optMatch[1].split("|");
        options.push({
          label: parts[0].trim(),
          description: parts[1]?.trim() || undefined,
        });
      }
    }
    
    if (question && options.length >= 2) {
      pages.push({ question, options, multiSelect: false });
    }
  }

  return pages.length > 0 ? pages : null;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export function ChatPanel() {
  const {
    config,
    isConnected,
    virtualFiles,
    addVirtualFile,
    deleteVirtualFile,
    projectTemplate,
    saveChatSession,
    loadChatSession,
    loadChatSessions,
    chatSessions,
    currentChatId,
    setCurrentChatId,
    pendingErrorFix,
    setPendingErrorFix,
    projectName,
    runTerminalCommand,
    terminalRunning,
  } = useOllama();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [executingPlan, setExecutingPlan] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [expandedPlan, setExpandedPlan] = useState<number | null>(null);
  const [showImpact, setShowImpact] = useState<number | null>(null);
  const [attachedImages, setAttachedImages] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [thinkingStatus, setThinkingStatus] = useState<string>("");
  const [planModalOpen, setPlanModalOpen] = useState<number | null>(null);
  
  // Questionnaire state
  const [activeQuestionnaire, setActiveQuestionnaire] = useState<QuestionnaireData | null>(null);
  const [questionnaireCallback, setQuestionnaireCallback] = useState<((summary: string) => void) | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Camada 2 & 4: Cached project metadata
  const projectMeta = useMemo<ProjectMetadata>(() => {
    return scanProject(virtualFiles);
  }, [virtualFiles]);

  const activeSkills = useMemo(() => {
    return getActiveSkills(projectMeta);
  }, [projectMeta]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamText, activeQuestionnaire]);

  useEffect(() => {
    loadChatSessions();
  }, [loadChatSessions]);

  useEffect(() => {
    if (currentChatId && messages.length === 0) {
      loadChatSession(currentChatId).then((msgs) => {
        if (msgs) setMessages(msgs);
      });
    }
  }, [currentChatId]);

  useEffect(() => {
    if (pendingErrorFix && !isLoading && !executingPlan) {
      const msg = pendingErrorFix;
      setPendingErrorFix(null);
      const fixInput = `Corrija os seguintes erros do console do projeto:\n\n${msg}`;
      setInput(fixInput);
      // Auto-submit after a brief delay to allow state to update
      setTimeout(() => {
        const form = inputRef.current?.closest("form");
        if (form) {
          form.requestSubmit();
        }
      }, 200);
    }
  }, [pendingErrorFix, isLoading, executingPlan]);

  const autoSave = useCallback(
    async (msgs: ChatMessage[]) => {
      if (msgs.length === 0) return;
      const chatId = currentChatId || `chat-${Date.now()}`;
      if (!currentChatId) setCurrentChatId(chatId);
      const firstUserMsg = msgs.find((m) => m.role === "user");
      const title = firstUserMsg
        ? firstUserMsg.content.slice(0, 50)
        : "Nova conversa";
      await saveChatSession(chatId, title, msgs);
    },
    [currentChatId, saveChatSession, setCurrentChatId],
  );

  const tokenUsage = useMemo(() => {
    const maxTokens = config.maxTokens || 8192;
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const usedTokens = Math.round(totalChars / 4);
    const percentage = Math.min(100, Math.round((usedTokens / maxTokens) * 100));
    return { used: usedTokens, max: maxTokens, percentage };
  }, [messages, config.maxTokens]);

  const suggestions = useMemo(() => {
    const items: string[] = [];
    if (!virtualFiles || virtualFiles.length === 0) {
      items.push("Abra um projeto para comecar");
      return items;
    }
    // Removido: projectMeta não possui propriedade 'errors'
    if (projectMeta?.components?.length > 0) {
      items.push(`Melhorar ${projectMeta.components[0]}`);
    }
    if (projectMeta?.patterns?.hasTailwind) {
      items.push("Melhorar estilizacao");
    }
    if (projectMeta?.routes?.length > 0) {
      items.push("Adicionar nova pagina");
    }
    items.push("Verificar funcionamento");
    return items.slice(0, 3);
  }, [virtualFiles, projectMeta]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) {
          setAttachedImages((prev) => [...prev, { name: file.name, dataUrl }]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Questionnaire Helpers                                             */
  /* ---------------------------------------------------------------- */
  const handleQuestionnaireSelect = (pageIndex: number, optionIndex: number) => {
    if (!activeQuestionnaire) return;
    setActiveQuestionnaire(prev => {
      if (!prev) return prev;
      const newAnswers = { ...prev.answers };
      if (prev.pages[pageIndex]?.multiSelect) {
        const current = newAnswers[pageIndex] || [];
        if (current.includes(optionIndex)) {
          newAnswers[pageIndex] = current.filter(i => i !== optionIndex);
        } else {
          newAnswers[pageIndex] = [...current, optionIndex];
        }
      } else {
        newAnswers[pageIndex] = [optionIndex];
      }
      return { ...prev, answers: newAnswers };
    });
  };

  const handleQuestionnaireNext = () => {
    if (!activeQuestionnaire) return;
    const { currentPage, pages } = activeQuestionnaire;
    if (currentPage < pages.length - 1) {
      setActiveQuestionnaire(prev => prev ? { ...prev, currentPage: prev.currentPage + 1 } : prev);
    }
  };

  const handleQuestionnairePrev = () => {
    if (!activeQuestionnaire) return;
    if (activeQuestionnaire.currentPage > 0) {
      setActiveQuestionnaire(prev => prev ? { ...prev, currentPage: prev.currentPage - 1 } : prev);
    }
  };

  const handleQuestionnaireSkip = () => {
    if (!activeQuestionnaire) return;
    finishQuestionnaire();
  };

  const handleQuestionnaireFinish = () => {
    if (!activeQuestionnaire) return;
    finishQuestionnaire();
  };

  const finishQuestionnaire = () => {
    if (!activeQuestionnaire) return;
    const { pages, answers } = activeQuestionnaire;
    
    // Build summary from answers
    const summaryParts: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const selected = answers[i] || [];
      if (selected.length > 0) {
        const selectedLabels = selected.map(idx => page.options[idx]?.label).filter(Boolean);
        const shortQuestion = page.question.replace(/^(Quais?|Como|Qual|O que|Que tipo)\s+/i, "").replace(/\?$/, "").trim();
        summaryParts.push(`${shortQuestion}: ${selectedLabels.join(", ")}`);
      }
    }
    
    const summary = summaryParts.join("\n");
    
    // Add summary as a message in the chat
    if (summary) {
      const summaryMsg: ChatMessage = {
        role: "user",
        content: summary,
        questionnaire: {
          ...activeQuestionnaire,
          completed: true,
          summary,
        },
      };
      const next = [...messages, summaryMsg];
      setMessages(next);
      autoSave(next);
      
      // Trigger callback if available
      if (questionnaireCallback) {
        questionnaireCallback(summary);
      }
    }
    
    setActiveQuestionnaire(null);
    setQuestionnaireCallback(null);
  };

  /* ---------------------------------------------------------------- */
  /* Build enriched context string from project metadata               */
  /* ---------------------------------------------------------------- */
  const projectContext = useMemo(() => {
    const relevantFiles = virtualFiles.filter(
      (f) =>
        /\.(tsx|ts|jsx|js|css|html|json)$/i.test(f.path) &&
        !f.path.includes("node_modules") &&
        !f.path.includes(".builderai/"),
    );
    if (relevantFiles.length === 0) return "";

    const MAX_CONTEXT_CHARS = 20000;
    const MAX_FILE_SNIPPET_CHARS = 2000;

    const parts: string[] = [];
    let total = 0;

    for (const f of relevantFiles) {
      const snippet =
        f.code.length > MAX_FILE_SNIPPET_CHARS
          ? f.code.slice(0, MAX_FILE_SNIPPET_CHARS)
          : f.code;
      const block = `### ${f.path}\n\`\`\`\n${snippet}\n\`\`\``;
      if (total + block.length > MAX_CONTEXT_CHARS && parts.length > 0) {
        break;
      }
      total += block.length;
      parts.push(block);
    }

    return (
      "\n\n--- ARQUIVOS DO PROJETO ---\n" +
      parts.join("\n\n") +
      "\n--- FIM DOS ARQUIVOS ---\n"
    );
  }, [virtualFiles]);

  /* ---------------------------------------------------------------- */
  /* Handle send message                                               */
  /* ---------------------------------------------------------------- */
  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    if (!isConnected) {
      toast({
        title: "Ollama desconectado",
        description: "Conecte ao Ollama antes de enviar mensagens.",
        variant: "destructive",
      });
      return;
    }

    let userContent = text;
    if (attachedImages.length > 0) {
      const imgDescriptions = attachedImages.map((img) => `[Imagem anexada: ${img.name}]`).join("\n");
      userContent = `${text}\n\n${imgDescriptions}`;
    }

    const userMsg: ChatMessage = { role: "user", content: userContent };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setAttachedImages([]);
    setIsLoading(true);
    setStreamText("");
    setThinkingStatus("Pensando...");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const lower = text.toLowerCase();
      const isFix =
        /\b(corrija|corrigir|corrige|conserte|consertar|conserta|ajuste|ajustar|ajusta|fix|fixe|resolver|resolva)\b/i.test(lower) ||
        /\b(erro|erros|bug|falha|falhas|build|compilar|compilacao|ts\d{3,})\b/i.test(lower);
      const isImprove =
        /\b(melhoria|melhorar|melhore|otimizar|otimize|refatorar|refatore|performance|seo|acessibilidade|usabilidade)\b/i.test(lower);
      const isChange =
        /\b(modifique|modificar|modifica|altere|alterar|altera|mude|mudanca|adicionar|adicione|adiciona|inclua|incluir|inclui|remova|remover|remove|exclua|excluir|exclui|crie|criar|implemente|implementar|implementa|instale|instalar|instala|configure|configurar|configura|atualize|atualizar|atualiza|substitua|substituir|troque|trocar)\b/i.test(lower);
      if (isFix) {
        await processActionRequest(text, "", next, abort);
        return;
      }
      if (isImprove || isChange || isActionRequest(text)) {
        // Vai direto para o plano, sem questionário
        await processActionRequest(text, "", next, abort);
        return;
      }
      await processNonActionRequest(text, next, abort);
      
    } catch (err: any) {
      if (err.name === "AbortError") {
        const abortMsg: ChatMessage = {
          role: "assistant",
          content: streamText + "\n\n*(Geracao cancelada)*",
        };
        const updated = [...next, abortMsg];
        setMessages(updated);
      } else {
        toast({
          title: "Erro",
          description: err.message,
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
      setStreamText("");
      setThinkingStatus("");
      abortRef.current = null;
    }
  };

  /* ---------------------------------------------------------------- */
  /* Generate questionnaire via AI                                     */
  /* ---------------------------------------------------------------- */
  const generateQuestionnaire = async (
    userText: string,
    currentMessages: ChatMessage[],
    abort: AbortController,
  ) => {
    setThinkingStatus("Gerando questionario...");
    
    const questionPrompt = [
      `Voce e um assistente de planejamento. O usuario fez uma solicitacao de implementacao.`,
      `Antes de implementar, preciso entender melhor o escopo.`,
      ``,
      `Gere um questionario com 3 a 5 perguntas de implementacao baseadas no pedido do usuario.`,
      `Cada pergunta deve ter 3-4 opcoes e uma opcao "Other".`,
      ``,
      `FORMATO OBRIGATORIO (siga EXATAMENTE):`,
      `QUESTIONNAIRE_START`,
      `QUESTION 1`,
      `Qual pergunta aqui?`,
      `- Opcao 1 label | Descricao opcional da opcao`,
      `- Opcao 2 label | Descricao opcional`,
      `- Opcao 3 label | Descricao opcional`,
      `QUESTION 2`,
      `Outra pergunta?`,
      `- Opcao A | Descricao`,
      `- Opcao B | Descricao`,
      `- Opcao C | Descricao`,
      `QUESTIONNAIRE_END`,
      ``,
      `Pedido do usuario: "${userText}"`,
      ``,
      `Contexto do projeto: ${projectMeta.summary}`,
      `Componentes existentes: ${projectMeta.components.slice(0, 10).join(", ") || "Nenhum"}`,
      ``,
      `Gere perguntas relevantes para o pedido. Foque em:`,
      `1. Modulos/secoes do sistema`,
      `2. Estilo visual e tema`,
      `3. Conteudo e funcionalidades especificas`,
      `4. Estrutura de navegacao`,
      `5. Integracao com APIs/dados`,
    ].join("\n");

    let full = "";
    try {
      await chatStream({
        config,
        messages: [
          { role: "system", content: "Voce gera questionarios de planejamento no formato especificado. Responda APENAS com o questionario no formato QUESTIONNAIRE_START...QUESTIONNAIRE_END." },
          { role: "user", content: questionPrompt },
        ],
        signal: abort.signal,
        onToken: (token) => {
          full += token;
        },
      });
    } catch (err: any) {
      if (err.name === "AbortError") throw err;
      // If questionnaire generation fails, proceed directly to planning
      await processActionRequest(userText, "", currentMessages, abort);
      return;
    }

    const pages = parseQuestionsFromResponse(full);
    
    if (pages && pages.length > 0) {
      // Show the questionnaire
      const questionnaire: QuestionnaireData = {
        pages,
        answers: {},
        currentPage: 0,
        completed: false,
      };
      
      // Add assistant message indicating questions
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: "Antes de implementar, preciso entender melhor o escopo do seu pedido.",
      };
      const updated = [...currentMessages, assistantMsg];
      setMessages(updated);
      
      setActiveQuestionnaire(questionnaire);
      setIsLoading(false);
      setStreamText("");
      setThinkingStatus("");
      
      // Set up callback to continue after questionnaire
      setQuestionnaireCallback(() => (summary: string) => {
        // Continue with the action request using questionnaire answers
        const enrichedText = `${userText}\n\nEspecificacoes do usuario:\n${summary}`;
        setIsLoading(true);
        setThinkingStatus("Gerando plano de implementacao...");
        const newAbort = new AbortController();
        abortRef.current = newAbort;
        
        // Need to get the latest messages at callback time
        setMessages((prevMsgs) => {
          processActionRequest(enrichedText, summary, prevMsgs, newAbort)
            .catch((err) => {
              if (err.name !== "AbortError") {
                toast({ title: "Erro", description: err.message, variant: "destructive" });
              }
            })
            .finally(() => {
              setIsLoading(false);
              setStreamText("");
              setThinkingStatus("");
              abortRef.current = null;
            });
          return prevMsgs;
        });
      });
    } else {
      // No questionnaire parsed, proceed directly
      await processActionRequest(userText, "", currentMessages, abort);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Process a non-action request                                      */
  /* ---------------------------------------------------------------- */
  const processNonActionRequest = async (
    text: string,
    currentMessages: ChatMessage[],
    abort: AbortController,
  ) => {
    const conversationalPrompt = buildConversationalPrompt(projectMeta);
    const systemPrompt = conversationalPrompt;

    const MAX_SYSTEM_PROMPT_CHARS = 60000;
    const safeSystemPrompt =
      systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS
        ? systemPrompt.slice(systemPrompt.length - MAX_SYSTEM_PROMPT_CHARS)
        : systemPrompt;

    const MAX_HISTORY_MESSAGE_CHARS = 4000;
    const MAX_HISTORY_TOTAL_CHARS = 16000;

    const historyMessages = currentMessages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content:
        m.content.length > MAX_HISTORY_MESSAGE_CHARS
          ? m.content.slice(m.content.length - MAX_HISTORY_MESSAGE_CHARS)
          : m.content,
    }));

    let historyTotal = 0;
    const limitedHistory: typeof historyMessages = [];
    for (let i = historyMessages.length - 1; i >= 0; i--) {
      const msg = historyMessages[i];
      const len = msg.content.length;
      if (historyTotal + len > MAX_HISTORY_TOTAL_CHARS && limitedHistory.length > 0) {
        break;
      }
      historyTotal += len;
      limitedHistory.push(msg);
    }
    limitedHistory.reverse();

    const apiMessages = [
      { role: "system" as const, content: safeSystemPrompt },
      ...limitedHistory,
    ];

    setThinkingStatus("Gerando resposta...");
    let full = "";
    await chatStream({
      config,
      messages: apiMessages,
      signal: abort.signal,
      onToken: (token) => {
        if (thinkingStatus) setThinkingStatus("");
        full += token;
        setStreamText(full);
      },
    });

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: full,
    };

    const updated = [...currentMessages, assistantMsg];
    setMessages(updated);
    setStreamText("");
    await autoSave(updated);
  };

  /* ---------------------------------------------------------------- */
  /* Process action request (with plan)                                */
  /* ---------------------------------------------------------------- */
  const processActionRequest = async (
    text: string,
    questionnaireSummary: string,
    currentMessages: ChatMessage[],
    abort: AbortController,
  ) => {
    setThinkingStatus("Gerando plano...");
    
    const limitations = getSystemLimitations();
    const skillsSummary = activeSkills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
    const planningInstructions = buildPlanningPrompt(projectMeta);
    
    const keywords = text
      .replace(/[^\w\sàáâãéèêíïóôõöúçñ]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3)
      .map(w => w.toLowerCase());
    
    const relevantFiles = searchFilesByKeyword(virtualFiles, keywords, 10);
    
    const relevantFileSnippets: string[] = [];
    for (const rf of relevantFiles) {
      const snippet = rf.code.length > 2000 ? rf.code.slice(0, 2000) + "\n// ... (truncado)" : rf.code;
      relevantFileSnippets.push(`### ${rf.path} (relevancia: ${rf.score}, keywords: ${rf.matchedKeywords.join(", ")})\n\`\`\`\n${snippet}\n\`\`\``);
    }
    
    const relevantContext = relevantFileSnippets.length > 0 
      ? "\n\n--- ARQUIVOS RELEVANTES PARA O PEDIDO ---\n" + relevantFileSnippets.join("\n\n") + "\n--- FIM ARQUIVOS RELEVANTES ---\n"
      : "";

    const systemPrompt = [
      `Voce e um arquiteto de software inteligente. Analise TUDO antes de planejar.`,
      `IMPORTANTE: NAO inclua blocos de codigo bash/shell/terminal. O sistema tem terminal integrado.`,
      `NAO sugira comandos como pnpm, npm, yarn, npx. Foque apenas em modificacoes de ARQUIVOS.`,
      "",
      "=== DIAGNOSTICO DO PROJETO ===",
      projectMeta.summary,
      "",
      "=== SKILLS ATIVAS ===",
      skillsSummary,
      "",
      "=== INSTRUCOES DE PLANEJAMENTO ===",
      planningInstructions,
      "",
      "=== LIMITACOES ===",
      limitations,
      "",
      "=== TEMPLATE DO PROJETO ===",
      projectTemplate,
      "",
      relevantContext,
      projectContext,
    ].join("\n");

    const MAX_SYSTEM_PROMPT_CHARS = 60000;
    const safeSystemPrompt =
      systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS
        ? systemPrompt.slice(systemPrompt.length - MAX_SYSTEM_PROMPT_CHARS)
        : systemPrompt;

    const MAX_HISTORY_MESSAGE_CHARS = 4000;
    const MAX_HISTORY_TOTAL_CHARS = 16000;

    const historyMessages = currentMessages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content:
        m.content.length > MAX_HISTORY_MESSAGE_CHARS
          ? m.content.slice(m.content.length - MAX_HISTORY_MESSAGE_CHARS)
          : m.content,
    }));

    let historyTotal = 0;
    const limitedHistory: typeof historyMessages = [];
    for (let i = historyMessages.length - 1; i >= 0; i--) {
      const msg = historyMessages[i];
      const len = msg.content.length;
      if (historyTotal + len > MAX_HISTORY_TOTAL_CHARS && limitedHistory.length > 0) {
        break;
      }
      historyTotal += len;
      limitedHistory.push(msg);
    }
    limitedHistory.reverse();

    const apiMessages = [
      { role: "system" as const, content: safeSystemPrompt },
      ...limitedHistory,
    ];

    let full = "";
    await chatStream({
      config,
      messages: apiMessages,
      signal: abort.signal,
      onToken: (token) => {
        if (thinkingStatus) setThinkingStatus("");
        full += token;
        // Filter code blocks from streaming display - show only narrative text
        const filtered = full.replace(/```[\s\S]*?```/g, "").replace(/```[\s\S]*$/g, "").trim();
        setStreamText(filtered || "Gerando plano...");
      },
    });

    // Parse plan
    const fileOps = extractFileOperations(full);
    const steps = extractPlanSteps(full);
    const hasPlan = (
      steps.length > 0 ||
      fileOps.create.length > 0 ||
      fileOps.modify.length > 0 ||
      fileOps.delete.length > 0
    );

    let impactAnalysis: PlanData["impactAnalysis"] = undefined;
    if (hasPlan) {
      const impact = analyzeImpact(
        projectMeta,
        [...fileOps.create, ...fileOps.modify],
        fileOps.delete,
      );
      if (impact.cascadeFiles.length > 0 || impact.warnings.length > 0) {
        impactAnalysis = impact;
      }
    }

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: full,
      plan: hasPlan
        ? {
            raw: full,
            steps,
            fileOps,
            status: "idle",
            stepStatus: steps.map(() => "pending" as const),
            impactAnalysis,
          }
        : undefined,
    };

    const updated = [...currentMessages, assistantMsg];
    setMessages(updated);
    setStreamText("");
    await autoSave(updated);
    
    setIsLoading(false);
    setThinkingStatus("");
    
    if (hasPlan) {
      // Auto-open plan modal
      setPlanModalOpen(updated.length - 1);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Stop generation                                                  */
  /* ---------------------------------------------------------------- */
  const handleStop = () => {
    abortRef.current?.abort();
  };

  /* ---------------------------------------------------------------- */
  /* Approve plan                                                      */
  /* ---------------------------------------------------------------- */
  const handleApprovePlan = (msgIndex: number) => {
    setMessages((prev) => {
      const copy = [...prev];
      const m = { ...copy[msgIndex] };
      m.plan = { ...m.plan!, status: "approved" };
      copy[msgIndex] = m;
      return copy;
    });
    setTimeout(() => handleExecutePlan(msgIndex), 100);
  };

  /* ---------------------------------------------------------------- */
  /* Reject plan                                                       */
  /* ---------------------------------------------------------------- */
  const handleRejectPlan = (msgIndex: number) => {
    setMessages((prev) => {
      const copy = [...prev];
      const m = { ...copy[msgIndex] };
      m.plan = { ...m.plan!, status: "rejected" };
      copy[msgIndex] = m;
      return copy;
    });
    toast({
      title: "Plano rejeitado",
      description: "Descreva as alteracoes que deseja no plano.",
    });
  };

  /* ---------------------------------------------------------------- */
  /* Execute plan with progress tracking                               */
  /* ---------------------------------------------------------------- */
  const handleExecutePlan = async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg?.plan || executingPlan) return;

    const plan = msg.plan;
    setExecutingPlan(true);

    const updatePlan = (patch: Partial<PlanData>) => {
      setMessages((prev) => {
        const copy = [...prev];
        const m = { ...copy[msgIndex] };
        m.plan = { ...m.plan!, ...patch };
        copy[msgIndex] = m;
        return copy;
      });
    };

    updatePlan({ status: "running" });

    // Build execution progress items
    const fileProgressItems: FileProgressItem[] = [
      ...plan.fileOps.create.map((f): FileProgressItem => ({
        path: f,
        action: "create",
        status: "pending",
        description: "Criando arquivo",
      })),
      ...plan.fileOps.modify.map((f): FileProgressItem => ({
        path: f,
        action: "modify",
        status: "pending",
        description: "Editando arquivo",
      })),
      ...plan.fileOps.delete.map((f): FileProgressItem => ({
        path: f,
        action: "delete",
        status: "pending",
        description: "Excluindo arquivo",
      })),
    ];

    // Add execution progress message
    const progressMsg: ChatMessage = {
      role: "assistant",
      content: "",
      executionProgress: {
        title: `Implementando ${plan.steps.length > 0 ? plan.steps[0].title : "plano"}`,
        subtitle: `${plan.steps.length} passos, ${fileProgressItems.length} arquivos`,
        files: fileProgressItems,
        status: "running",
      },
    };
    
    const progressMsgIndex = messages.length;
    setMessages(prev => [...prev, progressMsg]);

    const updateProgress = (patch: Partial<ExecutionProgressData>) => {
      setMessages((prev) => {
        const copy = [...prev];
        const idx = progressMsgIndex;
        if (copy[idx]) {
          const m = { ...copy[idx] };
          m.executionProgress = { ...m.executionProgress!, ...patch };
          copy[idx] = m;
        }
        return copy;
      });
    };

    const updateFileProgress = (filePath: string, status: FileProgressItem["status"]) => {
      setMessages((prev) => {
        const copy = [...prev];
        const idx = progressMsgIndex;
        if (copy[idx]?.executionProgress) {
          const m = { ...copy[idx] };
          const ep = { ...m.executionProgress! };
          ep.files = ep.files.map(f => 
            f.path === filePath ? { ...f, status } : f
          );
          m.executionProgress = ep;
          copy[idx] = m;
        }
        return copy;
      });
    };

    const allCreated: string[] = [];
    const allModified: string[] = [];
    const allDeleted: string[] = [];
    const allErrors: string[] = [];
    const allDiffs: string[] = [];

    try {
      const executionInstructions = buildExecutionPrompt(projectMeta);

      for (let si = 0; si < plan.steps.length; si++) {
        const step = plan.steps[si];

        updatePlan({
          stepStatus: plan.steps.map((_, i) =>
            i < si ? "done" : i === si ? "running" : "pending",
          ),
        });

        // Update progress title
        updateProgress({
          title: `Passo ${si + 1}/${plan.steps.length}: ${step.title}`,
        });

        const isDeletionStep =
          step.title.toLowerCase().includes("excluir") ||
          step.title.toLowerCase().includes("remover") ||
          step.title.toLowerCase().includes("delete");
        if (isDeletionStep && plan.fileOps.delete.length > 0) {
          continue;
        }

        // Mark step files as running
        for (const fp of step.files) {
          updateFileProgress(fp, "running");
        }

        const stepFilesContent: string[] = [];
        const filesToInclude =
          step.files.length > 0
            ? step.files
            : [...plan.fileOps.create, ...plan.fileOps.modify];

        for (const fp of filesToInclude) {
          if (isIgnoredPath(fp)) {
            updateFileProgress(fp, "error");
            allErrors.push(`Ignorado: ${fp}`);
            continue;
          }
          const existing = virtualFiles.find((f) => f.path === fp);
          if (existing) {
            stepFilesContent.push(
              `--- CONTEUDO ATUAL DE ${fp} ---\n\`\`\`\n${existing.code}\n\`\`\``,
            );
          }
        }

        const cascadeFiles = plan.impactAnalysis?.cascadeFiles || [];
        for (const cf of cascadeFiles) {
          const existing = virtualFiles.find((f) => f.path === cf);
          if (existing && !stepFilesContent.some((s) => s.includes(cf))) {
            stepFilesContent.push(
              `--- ARQUIVO DEPENDENTE (pode precisar de atualizacao) ${cf} ---\n\`\`\`\n${existing.code}\n\`\`\``,
            );
          }
        }

        const fileListContext = [
          plan.fileOps.create.length > 0
            ? `Arquivos a CRIAR: ${plan.fileOps.create.join(", ")}`
            : "",
          plan.fileOps.modify.length > 0
            ? `Arquivos a MODIFICAR: ${plan.fileOps.modify.join(", ")}`
            : "",
          plan.fileOps.delete.length > 0
            ? `Arquivos a EXCLUIR: ${plan.fileOps.delete.join(", ")}`
            : "",
          cascadeFiles.length > 0
            ? `Arquivos em CASCATA (verificar imports): ${cascadeFiles.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        const execPrompt = [
          `Execute o passo ${si + 1}: ${step.title}`,
          "",
          `Arquivos envolvidos neste passo: ${step.files.join(", ") || "ver lista abaixo"}`,
          "",
          fileListContext,
          "",
          stepFilesContent.length > 0
            ? "Conteudo atual dos arquivos relevantes:\n" +
              stepFilesContent.join("\n\n")
            : "",
          "",
          `IMPORTANTE: Cada bloco de codigo DEVE ter na PRIMEIRA LINHA um comentario com o caminho EXATO do arquivo.`,
          `Exemplo: // src/components/MeuComponente.tsx`,
          `Use EXATAMENTE os caminhos listados acima. NAO invente nomes.`,
          "",
          `ASSETS DO PROJETO (imagens, fontes, etc): ${projectMeta.assets.length > 0 ? projectMeta.assets.join(", ") : "Nenhum detectado"}`,
          `Se precisar importar imagens/assets, use os caminhos EXATOS da lista acima.`,
          `Para imports de imagens use: import nomeVar from '@/assets/nome-arquivo.ext' ou caminhos relativos corretos.`,
          "",
          `NAO inclua blocos bash/shell/terminal. Gere APENAS codigo de aplicacao.`,
          "",
          `Gere o codigo completo de TODOS os arquivos necessarios para este passo.`,
        ].join("\n");

        const execSystemPrompt = `${executionInstructions}\n\n${projectTemplate}\n${projectContext}`;

        let stepResponse = "";
        try {
          const stepAbort = new AbortController();
          abortRef.current = stepAbort;

          await chatStream({
            config,
            messages: [
              { role: "system", content: execSystemPrompt },
              { role: "user", content: execPrompt },
            ],
            signal: stepAbort.signal,
            onToken: (token) => {
              stepResponse += token;
              // Don't show raw code in chat - just show progress status
              const fileMatches = stepResponse.match(/\/\/\s*(src\/[^\n]+|[a-zA-Z][\w\-./]+\.\w{2,4})/g);
              const currentFile = fileMatches ? fileMatches[fileMatches.length - 1]?.replace(/^\/\/\s*/, "") : "";
              setStreamText(
                `Executando passo ${si + 1}/${plan.steps.length}: ${step.title}${currentFile ? `\n📄 Editando: ${currentFile}` : ""}`,
              );
            },
          });
        } catch (err: any) {
          if (err.name === "AbortError") {
            allErrors.push(`Passo ${si + 1} cancelado`);
            updatePlan({
              stepStatus: plan.steps.map((_, i) =>
                i < si ? "done" : i === si ? "error" : "pending",
              ),
            });
            for (const fp of step.files) {
              updateFileProgress(fp, "error");
            }
            break;
          }
          throw err;
        }

        const blocks = extractAllCodeBlocks(stepResponse);
        const resolvedInThisStep = new Set<string>();

        const validation = validateCodeBlocks(blocks, plan);
        if (!validation.passed) {
          const errorChecks = validation.checks
            .filter((c) => c.status === "error")
            .map((c) => c.message);
          allErrors.push(
            `Passo ${si + 1} validacao: ${errorChecks.join("; ")}`,
          );
        }

        for (const block of blocks) {
          const resolvedPath = resolveBlockFileName(
            block,
            step.files,
            plan.fileOps.create,
            plan.fileOps.modify,
            resolvedInThisStep,
            routeFile,
          );

          resolvedInThisStep.add(resolvedPath);

          if (isIgnoredPath(resolvedPath)) {
            updateFileProgress(resolvedPath, "error");
            allErrors.push(`Ignorado: ${resolvedPath}`);
            continue;
          }

          const existingFile = virtualFiles.find(
            (f) => f.path === resolvedPath,
          );
          if (existingFile) {
            const diff = generateDiffSummary(
              existingFile.code,
              block.code,
              resolvedPath,
            );
            allDiffs.push(diff);
          }

          const exists = virtualFiles.some((f) => f.path === resolvedPath);
          addVirtualFile(resolvedPath, block.code, true);

          if (exists) {
            if (!allModified.includes(resolvedPath))
              allModified.push(resolvedPath);
          } else {
            if (!allCreated.includes(resolvedPath))
              allCreated.push(resolvedPath);
          }
          
          // Mark file as done in progress
          updateFileProgress(resolvedPath, "done");
        }

        // Mark remaining step files as done
        for (const fp of step.files) {
          updateFileProgress(fp, "done");
        }
      }

      // Handle deletions
      if (plan.fileOps.delete.length > 0) {
        for (const filePath of plan.fileOps.delete) {
          updateFileProgress(filePath, "running");
          if (isIgnoredPath(filePath)) {
            updateFileProgress(filePath, "error");
            allErrors.push(`Ignorado: ${filePath}`);
            continue;
          }
          const exists = virtualFiles.some((f) => f.path === filePath);
          if (exists) {
            deleteVirtualFile(filePath);
            allDeleted.push(filePath);
          }
          try {
            const pName = projectName || "";
            if (pName) {
              await fetch("http://localhost:3001/delete-file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectName: pName, filePath }),
              }).catch(() => {});
            }
          } catch {
            // Ignore remote delete errors
          }
          updateFileProgress(filePath, "done");
        }
      }

      // Update final status
      updatePlan({
        status: allErrors.length > 0 ? "error" : "done",
        diffSummaries: allDiffs,
        stepStatus: plan.steps.map((_, i) => {
          const isDel =
            plan.steps[i].title.toLowerCase().includes("excluir") ||
            plan.steps[i].title.toLowerCase().includes("remover");
          if (isDel && plan.fileOps.delete.length > 0) return "done";
          return allErrors.length > 0 && i === plan.steps.length - 1
            ? "error"
            : "done";
        }),
      });

      // Update execution progress to done
      const summaryItems: string[] = [];
      if (allCreated.length > 0) {
        summaryItems.push(`**Arquivos criados:** ${allCreated.map(f => `\`${f}\``).join(", ")}`);
      }
      if (allModified.length > 0) {
        summaryItems.push(`**Arquivos modificados:** ${allModified.map(f => `\`${f}\``).join(", ")}`);
      }
      if (allDeleted.length > 0) {
        summaryItems.push(`**Arquivos excluidos:** ${allDeleted.map(f => `\`${f}\``).join(", ")}`);
      }

      updateProgress({
        status: allErrors.length > 0 ? "error" : "done",
        files: fileProgressItems.map(f => ({
          ...f,
          status: allErrors.some(e => e.includes(f.path)) ? "error" as const : "done" as const,
        })),
        summary: summaryItems.join("\n"),
      });

      // Build structured summary message
      const summaryLines: string[] = [];
      const planTitle = plan.steps.length > 0 ? plan.steps.map(s => s.title).join(", ") : "Plano";
      summaryLines.push(`**${planTitle} implementado com:**\n`);
      
      if (allCreated.length > 0) {
        for (const f of allCreated) {
          const fileName = f.split("/").pop() || f;
          summaryLines.push(`- **${fileName}** criado em \`${f}\``);
        }
      }
      
      if (allModified.length > 0) {
        for (const f of allModified) {
          const fileName = f.split("/").pop() || f;
          const diff = allDiffs.find(d => d.startsWith(f));
          const diffInfo = diff ? ` - ${diff.split(": ").slice(1).join(": ")}` : "";
          summaryLines.push(`- **${fileName}** modificado${diffInfo}`);
        }
      }
      
      if (allDeleted.length > 0) {
        for (const f of allDeleted) {
          const fileName = f.split("/").pop() || f;
          summaryLines.push(`- **${fileName}** excluido`);
        }
      }
      
      if (allErrors.length > 0) {
        summaryLines.push(`\n**Erros encontrados:**`);
        for (const err of allErrors) {
          summaryLines.push(`- ${err}`);
        }
      }

      const summaryMsg: ChatMessage = {
        role: "assistant",
        content: summaryLines.join("\n"),
      };
      setMessages(prev => [...prev, summaryMsg]);
      await autoSave([...messages, progressMsg, summaryMsg]);

      toast({
        title:
          allErrors.length > 0
            ? "Plano executado com erros"
            : "Plano executado com sucesso",
        description: `${allCreated.length} criados, ${allModified.length} modificados, ${allDeleted.length} excluidos`,
        variant: allErrors.length > 0 ? "destructive" : "default",
      });

      const hasPackageJson = [...allCreated, ...allModified].some(f => f.endsWith("package.json"));
      if (hasPackageJson && allErrors.length === 0) {
        toast({
          title: "Dependencias atualizadas",
          description: "package.json alterado. Se necessario, instale dependencias pelo Terminal ou reabra a pasta.",
        });
      } else if (allErrors.length === 0 && allCreated.length > 0) {
        toast({
          title: "Arquivos aplicados",
          description: "Novos arquivos criados. O servidor dev existente deve recarregar via HMR.",
        });
      }
    } catch (err: any) {
      updatePlan({ status: "error" });
      updateProgress({ status: "error" });
      toast({
        title: "Erro na execucao",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setExecutingPlan(false);
      setStreamText("");
      abortRef.current = null;
    }
  };

  /* ---------------------------------------------------------------- */
  /* Quick actions: single message (no plan)                           */
  /* ---------------------------------------------------------------- */
  const handleQuickGenerate = async (prompt: string) => {
    if (isLoading || executingPlan) return;

    const userMsg: ChatMessage = { role: "user", content: prompt };
    const next = [...messages, userMsg];
    setMessages(next);
    setIsLoading(true);
    setStreamText("");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const executionInstructions = buildExecutionPrompt(projectMeta);
      const systemPrompt = `${executionInstructions}\n\n${projectTemplate}\n${projectContext}`;

      let full = "";
      await chatStream({
        config,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        signal: abort.signal,
        onToken: (token) => {
          full += token;
          setStreamText(full);
        },
      });

      const blocks = extractAllCodeBlocks(full);
      const appliedFiles: string[] = [];

      for (const block of blocks) {
        const path = block.filename
          ? block.filename.includes("/")
            ? block.filename
            : routeFile(block.filename)
          : routeFile("GeneratedComponent.tsx");
        addVirtualFile(path, block.code, true);
        appliedFiles.push(path);
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content:
          full +
          (appliedFiles.length > 0
            ? `\n\n*Arquivos aplicados: ${appliedFiles.join(", ")}*`
            : ""),
      };
      const updated = [...next, assistantMsg];
      setMessages(updated);
      setStreamText("");
      await autoSave(updated);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast({
          title: "Erro",
          description: err.message,
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
      setStreamText("");
      abortRef.current = null;
    }
  };

  /* ---------------------------------------------------------------- */
  /* New chat                                                          */
  /* ---------------------------------------------------------------- */
  const handleNewChat = () => {
    setMessages([]);
    setCurrentChatId(null);
    setExpandedPlan(null);
    setShowImpact(null);
    setActiveQuestionnaire(null);
    localStorage.removeItem("current-chat-id");
  };

  /* ---------------------------------------------------------------- */
  /* Load a saved chat                                                */
  /* ---------------------------------------------------------------- */
  const handleLoadChat = async (chatId: string) => {
    const msgs = await loadChatSession(chatId);
    if (msgs) {
      setMessages(msgs);
      setShowSessions(false);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Extract terminal commands                                        */
  /* ---------------------------------------------------------------- */
  const extractTerminalCommands = (text: string): string[] => {
    const cmds: string[] = [];
    const bashBlockRegex = /```(?:bash|sh|shell|terminal|cmd|powershell)\n([\s\S]*?)```/g;
    let match;
    while ((match = bashBlockRegex.exec(text)) !== null) {
      const lines = match[1].trim().split("\n")
        .map(l => l.replace(/^\$\s*/, "").trim())
        .filter(l => l && !l.startsWith("#"));
      cmds.push(...lines);
    }
    const inlineRegex = /`((?:pnpm|npm|yarn|npx|node|vite)\s[^`]+)`/g;
    while ((match = inlineRegex.exec(text)) !== null) {
      if (!cmds.includes(match[1])) cmds.push(match[1]);
    }
    return cmds;
  };

  const renderTerminalActions = (content: string) => {
    const cmds = extractTerminalCommands(content);
    if (cmds.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {cmds.map((cmd, i) => (
          <button
            key={i}
            onClick={() => runTerminalCommand(cmd)}
            disabled={terminalRunning}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-medium transition-all bg-[#89b4fa15] text-[#89b4fa] hover:bg-[#89b4fa30] disabled:opacity-40"
            title={`Executar: ${cmd}`}
          >
            <Terminal className="h-3 w-3" />
            {cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd}
          </button>
        ))}
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Render plan UI with approval buttons                              */
  /* ---------------------------------------------------------------- */
  const renderPlan = (plan: PlanData, msgIdx: number) => {
    const isExpanded = expandedPlan === msgIdx;
    const isImpactExpanded = showImpact === msgIdx;
    const hasImpact = plan.impactAnalysis && (
      plan.impactAnalysis.cascadeFiles.length > 0 ||
      plan.impactAnalysis.warnings.length > 0
    );

    return (
      <div className="mt-3 rounded-lg border border-border bg-secondary/30 overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setExpandedPlan(isExpanded ? null : msgIdx)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-primary" />
            <span className="font-semibold">
              Plano: {plan.steps.length} passos,{" "}
              {plan.fileOps.create.length + plan.fileOps.modify.length} arquivos
            </span>
            {plan.fileOps.delete.length > 0 && (
              <span className="text-destructive">
                ({plan.fileOps.delete.length} a excluir)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {plan.status === "done" && (
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            )}
            {plan.status === "error" && (
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            )}
            {plan.status === "running" && (
              <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
            )}
            {plan.status === "approved" && (
              <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
            )}
            {plan.status === "rejected" && (
              <XCircle className="h-3.5 w-3.5 text-yellow-500" />
            )}
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </div>
        </button>

        {/* Approval buttons - ALWAYS visible when status is idle (not inside expanded) */}
        {plan.status === "idle" && (
          <div className="flex gap-2 px-3 pb-3">
            <button
              onClick={() => handleApprovePlan(msgIdx)}
              disabled={executingPlan || !isConnected}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-all shadow-sm"
            >
              <ShieldCheck className="h-4 w-4" />
              Aprovar e Executar
            </button>
            <button
              onClick={() => handleRejectPlan(msgIdx)}
              disabled={executingPlan}
              className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold bg-secondary text-muted-foreground hover:bg-secondary/80 transition-all"
            >
              <XCircle className="h-4 w-4" />
              Rejeitar
            </button>
          </div>
        )}

        {/* Running indicator */}
        {plan.status === "running" && (
          <div className="flex items-center gap-2 px-3 pb-3">
            <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
            <span className="text-xs text-muted-foreground animate-pulse">Executando plano...</span>
          </div>
        )}

        {/* Expanded content */}
        {isExpanded && (
          <div className="px-3 pb-3 space-y-2 border-t border-border/50 pt-2">
            {/* File operations summary */}
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              {plan.fileOps.create.length > 0 && (
                <div className="bg-green-500/10 text-green-600 rounded px-2 py-1">
                  <div className="font-semibold flex items-center gap-1">
                    <FilePlus className="h-3 w-3" />
                    Criar
                  </div>
                  {plan.fileOps.create.map((f) => (
                    <div key={f} className="truncate" title={f}>
                      {f}
                    </div>
                  ))}
                </div>
              )}
              {plan.fileOps.modify.length > 0 && (
                <div className="bg-yellow-500/10 text-yellow-600 rounded px-2 py-1">
                  <div className="font-semibold flex items-center gap-1">
                    <FileEdit className="h-3 w-3" />
                    Modificar
                  </div>
                  {plan.fileOps.modify.map((f) => (
                    <div key={f} className="truncate" title={f}>
                      {f}
                    </div>
                  ))}
                </div>
              )}
              {plan.fileOps.delete.length > 0 && (
                <div className="bg-red-500/10 text-red-600 rounded px-2 py-1">
                  <div className="font-semibold flex items-center gap-1">
                    <FileX className="h-3 w-3" />
                    Excluir
                  </div>
                  {plan.fileOps.delete.map((f) => (
                    <div key={f} className="truncate" title={f}>
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Impact analysis */}
            {hasImpact && (
              <div className="space-y-1">
                <button
                  onClick={() => setShowImpact(isImpactExpanded ? null : msgIdx)}
                  className="flex items-center gap-1.5 text-[10px] font-medium text-amber-600 hover:text-amber-500 transition-colors"
                >
                  <GitBranch className="h-3 w-3" />
                  <span>Analise de Impacto</span>
                  {isImpactExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
                {isImpactExpanded && (
                  <div className="bg-amber-500/10 rounded px-2 py-1.5 text-[10px] space-y-1">
                    {plan.impactAnalysis!.warnings.map((w, wi) => (
                      <div key={wi} className="flex items-start gap-1 text-amber-600">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </div>
                    ))}
                    {plan.impactAnalysis!.cascadeFiles.length > 0 && (
                      <div className="text-muted-foreground">
                        <span className="font-semibold">Arquivos em cascata:</span>{" "}
                        {plan.impactAnalysis!.cascadeFiles.join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Steps */}
            <div className="space-y-1">
              {plan.steps.map((step, si) => (
                <div
                  key={si}
                  className="flex items-start gap-2 text-xs py-1 px-2 rounded"
                >
                  <div className="mt-0.5 shrink-0">
                    {plan.stepStatus?.[si] === "done" && (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    )}
                    {plan.stepStatus?.[si] === "running" && (
                      <Loader2 className="h-3 w-3 text-primary animate-spin" />
                    )}
                    {plan.stepStatus?.[si] === "error" && (
                      <XCircle className="h-3 w-3 text-destructive" />
                    )}
                    {plan.stepStatus?.[si] === "pending" && (
                      <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground mr-1">
                      {si + 1}.
                    </span>
                    {step.title}
                    {step.files.length > 0 && (
                      <span className="text-muted-foreground ml-1">
                        ({step.files.join(", ")})
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Diff summaries (post-execution) */}
            {plan.diffSummaries && plan.diffSummaries.length > 0 && (
              <div className="bg-secondary/50 rounded px-2 py-1.5 text-[10px] space-y-0.5">
                <div className="font-semibold text-muted-foreground flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  Resumo de alteracoes:
                </div>
                {plan.diffSummaries.map((d, di) => (
                  <div key={di} className="text-muted-foreground font-mono">
                    {d}
                  </div>
                ))}
              </div>
            )}

            {/* Re-execute for error */}
            {plan.status === "error" && (
              <button
                onClick={() => handleApprovePlan(msgIdx)}
                disabled={executingPlan || !isConnected}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Re-executar Plano
              </button>
            )}

            {/* Rejected status */}
            {plan.status === "rejected" && (
              <div className="flex items-center gap-1.5 text-[10px] text-yellow-600 px-2">
                <Info className="h-3 w-3" />
                <span>Plano rejeitado. Descreva as alteracoes desejadas na proxima mensagem.</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Render Execution Progress                                        */
  /* ---------------------------------------------------------------- */
  const renderExecutionProgress = (progress: ExecutionProgressData) => {
    const actionLabels: Record<string, string> = {
      create: "Criando",
      modify: "Editando",
      delete: "Excluindo",
    };
    const actionIcons: Record<string, React.ReactNode> = {
      create: <FilePlus className="h-3 w-3" />,
      modify: <PenLine className="h-3 w-3" />,
      delete: <FileX className="h-3 w-3" />,
    };

    return (
      <div className="rounded-lg border border-border bg-secondary/20 overflow-hidden">
        {/* Progress header */}
        <div className="flex items-center gap-2 px-3 py-2.5 bg-secondary/40">
          {progress.status === "running" ? (
            <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
          ) : progress.status === "done" ? (
            <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
          )}
          <div>
            <div className="text-xs font-semibold">{progress.title}</div>
            {progress.subtitle && (
              <div className="text-[10px] text-muted-foreground">{progress.subtitle}</div>
            )}
          </div>
        </div>

        {/* File-by-file progress */}
        <div className="px-3 py-2 space-y-1.5">
          {progress.files.map((file, fi) => {
            const fileName = file.path.split("/").pop() || file.path;
            return (
              <div
                key={fi}
                className="flex items-center gap-2 text-[11px]"
              >
                {/* Status icon */}
                <div className="shrink-0">
                  {file.status === "done" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  )}
                  {file.status === "running" && (
                    <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                  )}
                  {file.status === "pending" && (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
                  )}
                  {file.status === "error" && (
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                  )}
                </div>
                
                {/* Action label */}
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  file.action === "create" ? "bg-green-500/10 text-green-600" :
                  file.action === "modify" ? "bg-yellow-500/10 text-yellow-600" :
                  "bg-red-500/10 text-red-600"
                }`}>
                  {actionLabels[file.action]}
                </span>
                
                {/* File name */}
                <code className="font-mono text-foreground/80 truncate">{fileName}</code>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        {progress.summary && progress.status === "done" && (
          <div className="px-3 pb-2.5 pt-1 border-t border-border/50">
            <div className="text-[10px] text-muted-foreground leading-relaxed">
              {formatMessageContent(progress.summary)}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Render Questionnaire                                              */
  /* ---------------------------------------------------------------- */
  const renderQuestionnaire = () => {
    if (!activeQuestionnaire) return null;
    const { pages, answers, currentPage } = activeQuestionnaire;
    const page = pages[currentPage];
    if (!page) return null;

    const selectedOptions = answers[currentPage] || [];
    const isLastPage = currentPage === pages.length - 1;
    const hasAnswer = selectedOptions.length > 0;

    return (
      <div className="mx-3 mb-3 rounded-lg border border-border bg-card overflow-hidden shadow-lg animate-in slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/40 border-b border-border/50">
          <span className="text-xs font-semibold text-foreground">Questions</span>
          <span className="text-[10px] text-muted-foreground">
            {page.multiSelect ? "Selecione as opcoes" : "Selecione uma opcao"}
          </span>
        </div>

        {/* Question */}
        <div className="px-4 pt-3 pb-2">
          <p className="text-sm font-semibold text-foreground leading-snug">{page.question}</p>
        </div>

        {/* Options */}
        <div className="px-4 pb-3 space-y-1.5">
          {page.options.map((opt, oi) => {
            const isSelected = selectedOptions.includes(oi);
            return (
              <button
                key={oi}
                onClick={() => handleQuestionnaireSelect(currentPage, oi)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                    : "border-border/60 bg-secondary/20 hover:bg-secondary/40 hover:border-border"
                }`}
              >
                {/* Radio/Checkbox indicator */}
                <div className={`shrink-0 mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                }`}>
                  {isSelected && (
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-medium text-foreground">{opt.label}</div>
                  {opt.description && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">{opt.description}</div>
                  )}
                </div>
              </button>
            );
          })}

          {/* Other option */}
          <button
            className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border/60 bg-secondary/20 hover:bg-secondary/40 hover:border-border text-left transition-all"
          >
            <div className="shrink-0 mt-0.5 h-4 w-4 rounded-full border-2 border-muted-foreground/40" />
            <div className="text-xs text-muted-foreground">Other</div>
          </button>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 bg-secondary/20">
          <div className="flex items-center gap-2">
            <button
              onClick={handleQuestionnairePrev}
              disabled={currentPage === 0}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={handleQuestionnaireNext}
              disabled={isLastPage}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 transition-all"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="text-[10px] text-muted-foreground ml-1">
              {currentPage + 1} / {pages.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleQuestionnaireSkip}
              className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 transition-colors"
            >
              Pular tudo
            </button>
            {isLastPage || hasAnswer ? (
              <button
                onClick={isLastPage ? handleQuestionnaireFinish : handleQuestionnaireNext}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {isLastPage ? "Finalizar" : "Proximo"}
              </button>
            ) : (
              <button
                onClick={handleQuestionnaireNext}
                disabled={!hasAnswer}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                Proximo
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Render questionnaire summary                                     */
  /* ---------------------------------------------------------------- */
  const renderQuestionnaireSummary = (q: QuestionnaireData) => {
    if (!q.completed || !q.summary) return null;
    return (
      <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-xs">
        <div className="leading-relaxed whitespace-pre-line text-foreground/80 italic">
          {q.summary}
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/50 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Chat IA</span>
          {executingPlan && (
            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full animate-pulse">
              Executando plano...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div
            className="p-1.5 rounded-md text-muted-foreground"
            title={`Skills ativas: ${activeSkills.map((s) => s.name).join(", ")}`}
          >
            <Zap className="h-3.5 w-3.5" />
          </div>
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Historico"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Nova conversa"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              setMessages([]);
              setStreamText("");
            }}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Limpar"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Sessions dropdown */}
      {showSessions && chatSessions.length > 0 && (
        <div className="border-b border-border bg-card/80 max-h-48 overflow-auto">
          {chatSessions.map((s) => (
            <button
              key={s.id}
              onClick={() => handleLoadChat(s.id)}
              className={`w-full text-left px-4 py-2 text-xs hover:bg-secondary/50 transition-colors ${
                s.id === currentChatId
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <div className="font-medium truncate">{s.title}</div>
              <div className="text-[10px] opacity-60">
                {new Date(s.updatedAt).toLocaleString("pt-BR")}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Project context indicator */}
      {virtualFiles.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/20 text-[10px] text-muted-foreground">
          <FileText className="h-3 w-3" />
          <span>
            {virtualFiles.length} arquivos | {projectMeta.components.length} componentes | {activeSkills.length} skills ativas
          </span>
          {projectMeta.patterns.hasTailwind && (
            <span className="bg-cyan-500/10 text-cyan-600 px-1.5 py-0.5 rounded">Tailwind</span>
          )}
          {projectMeta.patterns.hasTypeScript && (
            <span className="bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded">TS</span>
          )}
          {projectMeta.patterns.routerType && (
            <span className="bg-purple-500/10 text-purple-600 px-1.5 py-0.5 rounded">{projectMeta.patterns.routerType}</span>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !streamText && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Bot className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              Ola! Como posso ajudar voce hoje?
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Converse naturalmente ou peca para criar, modificar ou corrigir algo no seu projeto.
            </p>
            {activeSkills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3 justify-center">
                {activeSkills.slice(0, 5).map((s) => (
                  <span
                    key={s.id}
                    className="text-[10px] bg-secondary px-2 py-0.5 rounded-full text-muted-foreground"
                  >
                    {s.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}
          >
            {msg.role === "assistant" && (
              <div className="shrink-0 mt-1">
                <Bot className="h-5 w-5 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/50 text-foreground"
              }`}
            >
              {/* Questionnaire summary for user messages */}
              {msg.questionnaire?.completed && msg.questionnaire.summary && (
                <div className="whitespace-pre-line italic opacity-90">
                  {msg.questionnaire.summary}
                </div>
              )}

              {/* Regular message content */}
              {!msg.questionnaire?.completed && msg.plan ? (
                <>
                  {/* Compact plan card - replaces inline plan display */}
                  <div className="rounded-lg border border-border bg-secondary/30 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-primary" />
                        <span className="font-semibold">
                          Plano: {msg.plan.steps.length} passos, {msg.plan.fileOps.create.length + msg.plan.fileOps.modify.length} arquivos
                        </span>
                        {msg.plan.status === "done" && <CheckCircle className="h-3.5 w-3.5 text-green-500" />}
                        {msg.plan.status === "error" && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                        {msg.plan.status === "running" && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />}
                        {msg.plan.status === "rejected" && <XCircle className="h-3.5 w-3.5 text-yellow-500" />}
                      </div>
                      <button
                        onClick={() => setPlanModalOpen(i)}
                        className="text-[10px] font-medium px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      >
                        Abrir Plano
                      </button>
                    </div>
                    {/* Quick approval buttons when idle */}
                    {msg.plan.status === "idle" && (
                      <div className="flex gap-2 px-3 pb-3">
                        <button
                          onClick={() => handleApprovePlan(i)}
                          disabled={executingPlan || !isConnected}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-all shadow-sm"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Aprovar e Executar
                        </button>
                        <button
                          onClick={() => handleRejectPlan(i)}
                          disabled={executingPlan}
                          className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold bg-secondary text-muted-foreground hover:bg-secondary/80 transition-all"
                        >
                          <XCircle className="h-4 w-4" />
                          Rejeitar
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : !msg.questionnaire?.completed && msg.executionProgress ? (
                renderExecutionProgress(msg.executionProgress)
              ) : !msg.questionnaire?.completed ? (
                <div className="leading-relaxed">
                  {msg.role === "assistant" 
                    ? formatMessageContent(msg.content)
                    : <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  }
                </div>
              ) : null}
            </div>
            {msg.role === "user" && (
              <div className="shrink-0 mt-1">
                <User className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        {/* Streaming text */}
        {streamText && (
          <div className="flex gap-2">
            <Bot className="h-5 w-5 text-primary shrink-0 mt-1" />
            <div className="max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed bg-secondary/50 text-foreground">
              <div className="leading-relaxed">
                {formatMessageContent(streamText)}
              </div>
              <Loader2 className="h-3 w-3 text-primary animate-spin mt-1" />
            </div>
          </div>
        )}

        {/* Thinking indicator */}
        {isLoading && !streamText && thinkingStatus && (
          <div className="flex gap-2">
            <Bot className="h-5 w-5 text-primary shrink-0 mt-1" />
            <div className="rounded-2xl px-3.5 py-2 bg-secondary/50 flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-[11px] text-muted-foreground">{thinkingStatus}</span>
            </div>
          </div>
        )}

        {isLoading && !streamText && !thinkingStatus && (
          <div className="flex gap-2">
            <Bot className="h-5 w-5 text-primary shrink-0 mt-1" />
            <div className="rounded-2xl px-3 py-2 bg-secondary/50">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            </div>
          </div>
        )}
      </div>

      {/* Questionnaire overlay at bottom */}
      {activeQuestionnaire && renderQuestionnaire()}

      {/* Bottom input area */}
      <div className="shrink-0 border-t border-border bg-card/50">
        {/* Suggestions */}
        {messages.length === 0 && suggestions.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 overflow-x-auto">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setInput(s);
                  inputRef.current?.focus();
                }}
                className="shrink-0 text-[10px] font-medium px-2.5 py-1.5 rounded-lg border border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground hover:border-border hover:bg-secondary/80 transition-all"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Token counter */}
        <div className="flex items-center justify-between px-3 py-1">
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/60">
            <span>{tokenUsage.used.toLocaleString()} / {tokenUsage.max.toLocaleString()} tokens</span>
            <div className="w-14 h-1 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${tokenUsage.percentage}%`,
                  backgroundColor: tokenUsage.percentage > 80 ? "#f38ba8" : tokenUsage.percentage > 50 ? "#fab387" : "#a6e3a1",
                }}
              />
            </div>
            <span>{tokenUsage.percentage}%</span>
          </div>
          {!isConnected && (
            <div className="flex items-center gap-1 text-[9px] text-destructive">
              <AlertTriangle className="h-2.5 w-2.5" />
              <span>Desconectado</span>
            </div>
          )}
        </div>

        {/* Attached images preview */}
        {attachedImages.length > 0 && (
          <div className="flex items-center gap-2 px-3 pb-1.5 overflow-x-auto">
            {attachedImages.map((img, i) => (
              <div key={i} className="relative shrink-0 group">
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="h-12 w-12 rounded-lg object-cover border border-border/50"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="px-3 pb-3 pt-0.5">
          <form onSubmit={handleSend} className="flex items-end gap-2">
            <div className="flex-1 flex items-end gap-1.5 rounded-2xl bg-secondary/50 border border-border/60 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all px-3 py-1.5">
              {/* Image upload button */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={!isConnected || executingPlan}
                className="shrink-0 p-1 rounded-md text-muted-foreground/60 hover:text-muted-foreground transition-colors disabled:opacity-30 mb-0.5"
                title="Anexar imagem"
              >
                <ImagePlus className="h-4 w-4" />
              </button>

              {/* Text input */}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  isConnected
                    ? "Digite uma mensagem ou peca para modificar o projeto..."
                    : "Conecte ao Ollama para comecar"
                }
                disabled={!isConnected || executingPlan}
                rows={1}
                className="flex-1 resize-none bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground/40 disabled:opacity-50 min-h-[28px] max-h-[120px] py-1 leading-relaxed"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />

              {/* Bottom-right action buttons inside the input */}
              <div className="flex items-center gap-1 shrink-0 mb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (input.trim()) {
                      const planPrefix = "Crie um plano para: ";
                      if (!input.startsWith(planPrefix)) {
                        setInput(planPrefix + input);
                      }
                    }
                  }}
                  disabled={!input.trim() || !isConnected}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-md text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/80 disabled:opacity-30 transition-all"
                  title="Converter em plano"
                >
                  Plano
                </button>
              </div>
            </div>

            {/* Round send/stop button */}
            {isLoading || executingPlan ? (
              <button
                type="button"
                onClick={handleStop}
                className="shrink-0 h-10 w-10 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 flex items-center justify-center transition-colors shadow-sm"
                title="Parar"
              >
                <StopCircle className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || !isConnected}
                className="shrink-0 h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors shadow-sm"
                title="Enviar (Enter)"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Plan Modal */}
      <PlanModal
        open={planModalOpen !== null}
        onOpenChange={(open) => { if (!open) setPlanModalOpen(null); }}
        plan={planModalOpen !== null ? messages[planModalOpen]?.plan ?? null : null}
        msgIndex={planModalOpen ?? 0}
        onApprove={handleApprovePlan}
        onReject={handleRejectPlan}
        isExecuting={executingPlan}
        isConnected={isConnected}
        diagnosticText={planModalOpen !== null ? extractDiagnosticText(messages[planModalOpen]?.content || "") : undefined}
      />
    </div>
  );
}
