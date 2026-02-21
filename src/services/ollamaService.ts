export type OllamaConfig = {
  baseUrl: string;
  selectedModel: string;
  temperature: number;
  maxTokens: number;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function truncateMessagesForContext(
  messages: ChatMessage[],
  maxChars: number,
): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const systemMessages: ChatMessage[] = [];
  let total = 0;
  for (const m of messages) {
    if (m.role === "system") {
      systemMessages.push(m);
      total += m.content ? m.content.length : 0;
    }
  }
  const kept: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "system") continue;
    const len = m.content ? m.content.length : 0;
    if (total + len > maxChars && kept.length > 0) {
      break;
    }
    total += len;
    kept.push(m);
  }
  kept.reverse();
  return [...systemMessages, ...kept];
}

export async function listModels(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/tags`);
  if (!res.ok) throw new Error("Falha ao listar modelos");
  return res.json();
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 2000,
): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i < retries) {
        console.warn(
          `[Ollama] Tentativa ${i + 1} falhou, retentando em ${delayMs}ms...`,
          lastErr.message,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr!;
}

export async function chatStream(params: {
  config: OllamaConfig;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  onToken: (token: string) => void;
  signal?: AbortSignal;
}) {
  const ctxTokens = 16384;
  const maxPredict = typeof params.config.maxTokens === "number" ? params.config.maxTokens : 0;
  const availableForPrompt = Math.max(2048, ctxTokens - maxPredict);
  const approxCharsPerToken = 4;
  const maxPromptChars = availableForPrompt * approxCharsPerToken;
  const safeMessages = truncateMessagesForContext(
    params.messages as ChatMessage[],
    maxPromptChars,
  );

  const body = {
    model: params.config.selectedModel,
    messages: safeMessages,
    stream: true,
    keep_alive: "15m",
    options: {
      temperature: params.config.temperature,
      num_predict: params.config.maxTokens,
      num_ctx: 16384,
    },
  };

  const doFetch = async () => {
    const res = await fetch(`${params.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: params.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Falha ao conectar ao chat do Ollama (HTTP ${res.status}): ${errText || "sem detalhes"}`,
      );
    }
    if (!res.body) throw new Error("Resposta sem body stream");
    return res;
  };

  const res = await withRetry(doFetch, 2, 2000);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const json = JSON.parse(l);
        const token = json.message?.content ?? json.response ?? "";
        if (token) {
          params.onToken(token);
          full += token;
        }
      } catch (e) {
        const _ = e;
      }
    }
  }
  if (buffer.trim()) {
    try {
      const json = JSON.parse(buffer);
      const token = json.message?.content ?? json.response ?? "";
      if (token) {
        params.onToken(token);
        full += token;
      }
    } catch {
      /* ignore */
    }
  }
  return full;
}

export async function generateStream(params: {
  config: OllamaConfig;
  prompt: string;
  onToken: (token: string) => void;
  signal?: AbortSignal;
}) {
  const body = {
    model: params.config.selectedModel,
    prompt: params.prompt,
    stream: true,
    keep_alive: "15m",
    options: {
      temperature: params.config.temperature,
      num_predict: params.config.maxTokens,
      num_ctx: 16384,
    },
  };

  const doFetch = async () => {
    const res = await fetch(`${params.config.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: params.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Falha ao conectar a geracao do Ollama (HTTP ${res.status}): ${errText || "sem detalhes"}`,
      );
    }
    if (!res.body) throw new Error("Resposta sem body stream");
    return res;
  };

  const res = await withRetry(doFetch, 2, 2000);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const json = JSON.parse(l);
        const token = json.response ?? "";
        if (token) {
          params.onToken(token);
          full += token;
        }
      } catch (e) {
        const _ = e;
      }
    }
  }
  if (buffer.trim()) {
    try {
      const json = JSON.parse(buffer);
      const token = json.response ?? "";
      if (token) {
        params.onToken(token);
        full += token;
      }
    } catch {
      /* ignore */
    }
  }
  return full;
}

export function extractTsxBlocks(text: string) {
  const blocks: { filename?: string; code: string }[] = [];
  const fence = "```";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(fence, i);
    if (start === -1) break;
    const langEnd = text.indexOf("\n", start + fence.length);
    if (langEnd === -1) break;
    const lang = text.substring(start + fence.length, langEnd).trim();
    const end = text.indexOf(fence, langEnd + 1);
    if (end === -1) break;
    const code = text.substring(langEnd + 1, end);
    if (
      lang.startsWith("tsx") ||
      lang.startsWith("typescript") ||
      lang.startsWith("jsx")
    ) {
      const lines = code.split("\n");
      let filename: string | undefined;
      const first = lines[0] || "";
      const m = first.match(/\/\/\s*(.+\.(tsx|jsx))/i);
      if (m) {
        filename = m[1].trim();
      }
      blocks.push({ filename, code });
    }
    i = end + fence.length;
  }
  return blocks;
}

export function makeChatCacheKey(
  config: OllamaConfig,
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>,
) {
  const payload = {
    model: config.selectedModel,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    messages,
  };
  return "chat:" + JSON.stringify(payload);
}

export function makeGenerateCacheKey(config: OllamaConfig, prompt: string) {
  const payload = {
    model: config.selectedModel,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    prompt,
  };
  return "generate:" + JSON.stringify(payload);
}

export function getCacheItem(key: string) {
  try {
    const raw = localStorage.getItem("ollama-cache");
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[key] ?? null;
  } catch {
    return null;
  }
}

export function setCacheItem(key: string, value: string) {
  try {
    const raw = localStorage.getItem("ollama-cache");
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[key] = value;
    localStorage.setItem("ollama-cache", JSON.stringify(map));
  } catch (e) {
    void e;
  }
}

export function pickModel(
  task: "generate" | "chat" | "explain" | "fix" | "refactor",
  available: string[],
  fallback: string,
) {
  try {
    const raw = localStorage.getItem("ollama-task-models");
    if (raw) {
      const map = JSON.parse(raw) as Record<string, string>;
      const desired = map[task];
      if (desired && available.includes(desired)) {
        return desired;
      }
    }
  } catch (e) {
    void e;
  }
  if (available.includes(fallback)) return fallback;
  return available[0] ?? fallback;
}

// ---------------------------------------------------------------------------
// extractAllCodeBlocks
// Extrai blocos de codigo de qualquer linguagem.
// Tenta extrair o nome do arquivo de multiplas formas:
//  1. Comentario na 1a linha: // src/components/X.tsx
//  2. Comentario HTML: <!-- src/pages/index.html -->
//  3. Caminho solto na 1a linha: src/components/X.tsx
//  4. Anotacao na fence: ```tsx title="src/X.tsx"
//  5. Busca nas 3 primeiras linhas
// ---------------------------------------------------------------------------
export function extractAllCodeBlocks(text: string) {
  const blocks: { filename?: string; code: string; lang: string }[] = [];
  const regex = /```(\w*(?:\s+[^\n]*)?)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const fenceInfo = match[1] || "txt";
    const lang = fenceInfo.split(/\s/)[0] || "txt";
    const code = match[2];
    if (!code.trim()) continue;
    const lines = code.split("\n");
    let filename: string | undefined;

    // Tentar extrair da anotacao da fence (ex: ```tsx title="src/X.tsx")
    const fencePath = fenceInfo.match(
      /(?:title=["']?|file=["']?)((?:src|public|app)\/[^\s"']+\.\w+)/i,
    );
    if (fencePath) {
      filename = fencePath[1].trim();
    }

    // Tentar nas primeiras 3 linhas do codigo
    if (!filename) {
      for (let li = 0; li < Math.min(3, lines.length); li++) {
        const line = (lines[li] || "").trim();
        // // src/components/X.tsx  ou  // X.tsx
        const m1 =
          line.match(/^\/\/\s*((?:src|public|app)\/[^\s]+\.\w+)/i) ||
          line.match(/^\/\/\s*([^\s]+\.\w+)/i);
        // <!-- path -->
        const m2 =
          line.match(/^<!--\s*((?:src|public|app)\/[^\s]+\.\w+)/i) ||
          line.match(/^<!--\s*([^\s]+\.\w+)/i);
        // block comment with path
        const m3 =
          line.match(/^\/\*\s*((?:src|public|app)\/[^\s]+\.\w+)/i) ||
          line.match(/^\/\*\s*([^\s]+\.\w+)/i);
        // Caminho solto na linha: src/components/X.tsx
        const m4 =
          li === 0
            ? line.match(/^((?:src|public|app)\/[^\s]+\.\w+)\s*$/)
            : null;

        const found = m1?.[1] || m2?.[1] || m3?.[1] || m4?.[1];
        if (found) {
          filename = found.trim();
          break;
        }
      }
    }

    blocks.push({ filename, code, lang });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// extractFileOperations
// Parseia o plano e extrai operacoes (criar/modificar/excluir).
// Aceita caminhos com ou sem backticks.
// ---------------------------------------------------------------------------
export function extractFileOperations(planText: string): {
  create: string[];
  modify: string[];
  delete: string[];
} {
  const result = {
    create: [] as string[],
    modify: [] as string[],
    delete: [] as string[],
  };
  const lines = planText.split("\n");

  let currentSection: "create" | "modify" | "delete" | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase().trim();

    if (
      lower.includes("arquivos a criar") ||
      lower.includes("criar:") ||
      lower.includes("novos arquivos") ||
      lower.includes("files to create") ||
      lower.includes("arquivos novos") ||
      /^###?\s*cria/.test(lower)
    ) {
      currentSection = "create";
      continue;
    }
    if (
      lower.includes("arquivos a modificar") ||
      lower.includes("modificar:") ||
      lower.includes("arquivos modificados") ||
      lower.includes("files to modify") ||
      lower.includes("arquivos existentes") ||
      /^###?\s*modifica/.test(lower) ||
      /^###?\s*alter/.test(lower)
    ) {
      currentSection = "modify";
      continue;
    }
    if (
      lower.includes("arquivos a excluir") ||
      lower.includes("excluir:") ||
      lower.includes("arquivos removidos") ||
      lower.includes("files to delete") ||
      lower.includes("arquivos a remover") ||
      /^###?\s*exclu/.test(lower) ||
      /^###?\s*remov/.test(lower) ||
      /^###?\s*delet/.test(lower)
    ) {
      currentSection = "delete";
      continue;
    }

    if (/^###?\s/.test(lower) && currentSection) {
      currentSection = null;
      continue;
    }

    if (currentSection) {
      const fileMatchBt = line.match(/[-*]\s*`([^`]+\.\w+)`/);
      if (fileMatchBt) {
        result[currentSection].push(fileMatchBt[1].trim());
        continue;
      }
      const fileMatchPlain = line.match(
        /[-*]\s*((?:src|public|app)\/[\w./-]+\.\w+)/,
      );
      if (fileMatchPlain) {
        result[currentSection].push(fileMatchPlain[1].trim());
        continue;
      }
      const fileMatchSimple = line.match(/[-*]\s*([A-Za-z][\w.-]*\.\w+)/);
      if (fileMatchSimple) {
        result[currentSection].push(fileMatchSimple[1].trim());
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// extractPlanSteps
// Extrai os passos do plano para gerar tasks.
// Enriquece cada passo com caminhos de arquivo (com e sem backticks).
// Se nenhum passo explicito, gera tasks a partir das operacoes de arquivo.
// ---------------------------------------------------------------------------
export function extractPlanSteps(
  planText: string,
): Array<{ title: string; files: string[] }> {
  const steps: Array<{ title: string; files: string[] }> = [];
  const lines = planText.split("\n");

  // Primeiro verifica se o texto realmente contem um plano estruturado
  // Precisa ter pelo menos uma secao de "Passos" ou "Arquivos a criar/modificar"
  const hasPlanStructure = lines.some(line => {
    const lower = line.toLowerCase().trim();
    return /^###?\s*(passos|steps|passo a passo|arquivos a criar|arquivos a modificar|arquivos a excluir)/i.test(lower)
      || lower === "passos:" || lower === "steps:";
  });

  if (!hasPlanStructure) {
    // Sem estrutura de plano, tenta apenas gerar steps a partir de operacoes de arquivo
    const ops = extractFileOperations(planText);
    if (ops.create.length > 0) {
      steps.push({ title: "Criar novos arquivos", files: ops.create });
    }
    if (ops.modify.length > 0) {
      steps.push({ title: "Modificar arquivos existentes", files: ops.modify });
    }
    if (ops.delete.length > 0) {
      steps.push({ title: "Excluir arquivos", files: ops.delete });
    }
    return steps;
  }

  let inSteps = false;

  for (const line of lines) {
    const lower = line.toLowerCase().trim();
    if (
      lower.includes("passos:") ||
      lower.includes("steps:") ||
      lower.includes("passo a passo") ||
      /^###?\s*passos/.test(lower)
    ) {
      inSteps = true;
      continue;
    }

    if (inSteps) {
      const stepMatch = line.match(/^\s*\d+\.\s+(.+)/);
      if (stepMatch) {
        const title = stepMatch[1].trim();
        const fileRefs: string[] = [];
        const fileMatchesBt = title.matchAll(/`([^`]+\.\w+)`/g);
        for (const m of fileMatchesBt) {
          fileRefs.push(m[1]);
        }
        const fileMatchesPlain = title.matchAll(
          /((?:src|public|app)\/[\w./-]+\.\w+)/g,
        );
        for (const m of fileMatchesPlain) {
          if (!fileRefs.includes(m[1])) {
            fileRefs.push(m[1]);
          }
        }
        const cleanTitle = title.replace(/`[^`]+`/g, "").trim() || title;
        steps.push({ title: cleanTitle, files: fileRefs });
      } else if (line.match(/^###?\s/) && steps.length > 0) {
        break;
      }
    }
  }

  // Enriquecer passos sem arquivos usando operacoes de arquivo do plano
  const ops = extractFileOperations(planText);
  const allPlanFiles = [...ops.create, ...ops.modify];

  if (steps.length > 0 && allPlanFiles.length > 0) {
    for (const step of steps) {
      if (step.files.length === 0) {
        for (const filePath of allPlanFiles) {
          const baseName =
            filePath.split("/").pop()?.replace(/\.\w+$/, "") || "";
          if (
            baseName &&
            step.title.toLowerCase().includes(baseName.toLowerCase())
          ) {
            step.files.push(filePath);
          }
        }
        if (step.files.length === 0) {
          step.files = [...allPlanFiles];
        }
      }
    }
  }

  if (steps.length === 0) {
    if (ops.create.length > 0) {
      steps.push({ title: "Criar novos arquivos", files: ops.create });
    }
    if (ops.modify.length > 0) {
      steps.push({
        title: "Modificar arquivos existentes",
        files: ops.modify,
      });
    }
    if (ops.delete.length > 0) {
      steps.push({ title: "Excluir arquivos", files: ops.delete });
    }
  }

  return steps;
}
