import type { LLMConfig } from "../types/llm";

interface OllamaResponse {
  response: string;
}

export class OllamaProvider {
  public async analyze(prompt: string, config: LLMConfig): Promise<string> {
    const endpoint = config.ollamaEndpoint ?? "http://localhost:11434";
    const model = config.ollamaModel ?? "llama3";

    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
      }),
    });

    if (!response.ok) {
      throw new Error("Ollama가 실행 중인지 확인해주세요 (localhost:11434)");
    }

    const json = (await response.json()) as OllamaResponse;
    return json.response;
  }
}
