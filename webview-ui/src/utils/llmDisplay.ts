import type { LLMConfigPayload } from "../types/messages";

export function selectedModelName(config: LLMConfigPayload): string {
  if (config.provider === "chatgpt") return config.chatgptModel ?? "gpt-5.5";
  if (config.provider === "claude") return config.claudeModel ?? "claude-sonnet-4-20250514";
  if (config.provider === "gemini") return config.geminiModel ?? "gemini-2.5-flash";
  return config.ollamaModel ?? "llama3";
}
