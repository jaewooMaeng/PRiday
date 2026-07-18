import type { LLMConfig } from "../types/llm";

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class OpenAIProvider {
  public async analyze(prompt: string, config: LLMConfig): Promise<string> {
    if (!config.openaiApiKey) {
      throw new Error("ChatGPT API 키를 설정해주세요");
    }

    const model = config.chatgptModel ?? "gpt-5.5";
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt }],
    };

    if (!model.startsWith("gpt-5")) {
      body.temperature = 0.2;
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = (await response.json()) as OpenAIChatResponse;
    if (!response.ok) {
      throw new Error(json.error?.message ?? "ChatGPT 요청에 실패했습니다");
    }

    const text = json.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("ChatGPT 응답이 비어 있습니다");
    }
    return text;
  }
}
