import { useMemo } from "react";
import { useOllama as useCtx } from "@/contexts/OllamaContext";
import { listModels as listModelsSvc, chatStream, generateStream, extractTsxBlocks, type OllamaConfig } from "@/services/ollamaService";
import { pickModel } from "@/services/ollamaService";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function useOllama() {
  const ctx = useCtx();

  const helpers = useMemo(() => {
    const checkConnection = () => ctx.checkConnection();
    const listModels = () => listModelsSvc(ctx.config.baseUrl);
    const chat = async (messages: ChatMessage[], task?: "chat" | "generate" | "explain" | "fix" | "refactor", signal?: AbortSignal) => {
      let full = "";
      const cfg: OllamaConfig = {
        ...ctx.config,
        selectedModel: task ? pickModel(task, ctx.models.map((m) => m.name), ctx.config.selectedModel) : ctx.config.selectedModel,
      };
      await chatStream({
        config: cfg,
        messages,
        onToken: (t) => {
          full += t;
        },
        signal,
      });
      return full;
    };
    const streamGenerate = async (prompt: string, onChunk: (t: string) => void, task?: "generate", signal?: AbortSignal) => {
      const cfg: OllamaConfig = {
        ...ctx.config,
        selectedModel: pickModel(task || "generate", ctx.models.map((m) => m.name), ctx.config.selectedModel),
      };
      return generateStream({
        config: cfg,
        prompt,
        onToken: onChunk,
        signal,
      });
    };
    const generateCode = async (prompt: string, signal?: AbortSignal) => {
      let full = "";
      const cfg: OllamaConfig = {
        ...ctx.config,
        selectedModel: pickModel("generate", ctx.models.map((m) => m.name), ctx.config.selectedModel),
      };
      await generateStream({
        config: cfg,
        prompt,
        onToken: (t) => {
          full += t;
        },
        signal,
      });
      const blocks = extractTsxBlocks(full);
      return { full, blocks };
    };
    return { checkConnection, listModels, chat, streamGenerate, generateCode };
  }, [ctx]);

  return { ...ctx, ...helpers };
}
