import Anthropic from "@anthropic-ai/sdk";
import type { LLMConfig } from "../types/llm";

export class ClaudeProvider {
  public async analyze(prompt: string, config: LLMConfig): Promise<string> {
    if (!config.claudeApiKey) {
      throw new Error("Claude API 키를 설정해주세요");
    }

    const client = new Anthropic({ apiKey: config.claudeApiKey });
    const response = await client.messages.create({
      model: config.claudeModel ?? "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const firstBlock = response.content.find((block) => block.type === "text");
    if (!firstBlock || firstBlock.type !== "text") {
      throw new Error("Claude 응답 파싱 실패");
    }
    return firstBlock.text;
  }
}
