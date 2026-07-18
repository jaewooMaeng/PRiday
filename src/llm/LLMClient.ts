import type { PRDiffResult } from "../types/github";
import type { LLMConfig, LLMResponse, UILanguage } from "../types/llm";
import { getLogger } from "../utils/logger";
import { buildAnalysisPrompt, buildChatPrompt } from "./prompts";
import { OllamaProvider } from "./OllamaProvider";
import { GeminiProvider } from "./GeminiProvider";
import { ClaudeProvider } from "./ClaudeProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { ResponseParser } from "../analysis/ResponseParser";

export class LLMClient {
  private readonly ollama = new OllamaProvider();
  private readonly gemini = new GeminiProvider();
  private readonly claude = new ClaudeProvider();
  private readonly openai = new OpenAIProvider();
  private readonly parser = new ResponseParser();

  public async analyze(diff: PRDiffResult, config: LLMConfig): Promise<LLMResponse> {
    const log = getLogger();
    const prompt = buildAnalysisPrompt(diff, config.language);
    log.appendLine(`[LLM] Provider: ${config.provider}`);
    log.appendLine(`[LLM] Prompt length: ${prompt.length} chars`);

    let rawResponse = "";
    if (config.provider === "ollama") {
      rawResponse = await this.ollama.analyze(prompt, config);
    } else if (config.provider === "gemini") {
      rawResponse = await this.gemini.analyze(prompt, config);
    } else if (config.provider === "claude") {
      rawResponse = await this.claude.analyze(prompt, config);
    } else {
      rawResponse = await this.openai.analyze(prompt, config);
    }

    log.appendLine(`[LLM] Response (first 500): ${rawResponse.substring(0, 500)}`);

    try {
      return this.parser.parse(rawResponse);
    } catch (firstError) {
      log.appendLine("[LLM] Parse failed, retrying once");
      let retry = "";
      if (config.provider === "ollama") {
        retry = await this.ollama.analyze(prompt, config);
      } else if (config.provider === "gemini") {
        retry = await this.gemini.analyze(prompt, config);
      } else if (config.provider === "claude") {
        retry = await this.claude.analyze(prompt, config);
      } else {
        retry = await this.openai.analyze(prompt, config);
      }
      try {
        return this.parser.parse(retry);
      } catch {
        throw firstError;
      }
    }
  }

  public async chat(
    question: string,
    analysisContext: string,
    config: LLMConfig
  ): Promise<string> {
    const log = getLogger();
    const prompt = buildChatPrompt(question, analysisContext, config.language);
    log.appendLine(`[LLM Chat] Provider: ${config.provider}, Q: ${question.substring(0, 100)}`);

    const provider = this.getProvider(config.provider);
    return provider.analyze(prompt, config);
  }

  private getProvider(name: string) {
    if (name === "ollama") return this.ollama;
    if (name === "gemini") return this.gemini;
    if (name === "claude") return this.claude;
    return this.openai;
  }
}
