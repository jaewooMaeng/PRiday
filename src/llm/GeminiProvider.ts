import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMConfig } from "../types/llm";

export class GeminiProvider {
  public async analyze(prompt: string, config: LLMConfig): Promise<string> {
    if (!config.geminiApiKey) {
      throw new Error("Gemini API 키를 설정해주세요");
    }

    const client = new GoogleGenerativeAI(config.geminiApiKey);
    const model = client.getGenerativeModel({
      model: config.geminiModel ?? "gemini-2.5-flash",
    });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text) {
      throw new Error("Gemini 응답이 비어 있습니다");
    }
    return text;
  }
}
