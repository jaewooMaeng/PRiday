import type { CallGraphData } from "./callGraph";
import type { SummaryBlock } from "./summary";

export type LLMProvider = "ollama" | "gemini" | "claude" | "chatgpt";
export type UILanguage = "en" | "ko";

export interface LLMConfig {
  provider: LLMProvider;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  claudeApiKey?: string;
  claudeModel?: string;
  openaiApiKey?: string;
  chatgptModel?: string;
  language?: UILanguage;
  hasGeminiApiKey?: boolean;
  hasClaudeApiKey?: boolean;
  hasOpenAIApiKey?: boolean;
  hasGitHubToken?: boolean;
}

export interface LLMResponse {
  callGraph: CallGraphData;
  summaryBlocks: SummaryBlock[];
  prSummary: string;
}
