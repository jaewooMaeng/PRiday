import type { LLMResponse } from "../types/llm";

function stripMarkdownFence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

export class ResponseParser {
  public parse(raw: string): LLMResponse {
    const normalized = stripMarkdownFence(raw);
    let parsed: unknown;

    try {
      parsed = JSON.parse(normalized);
    } catch {
      throw new Error("분석 결과를 파싱하지 못했습니다");
    }

    if (!this.isValid(parsed)) {
      throw new Error("LLM 응답 스키마가 올바르지 않습니다");
    }

    return parsed;
  }

  private isValid(data: unknown): data is LLMResponse {
    if (!data || typeof data !== "object") {
      return false;
    }
    const obj = data as Record<string, unknown>;
    if (!obj.callGraph || !obj.summaryBlocks || !obj.prSummary) {
      return false;
    }
    const callGraph = obj.callGraph as Record<string, unknown>;
    const root = callGraph.root as Record<string, unknown> | undefined;
    const files = callGraph.files as unknown[] | undefined;
    const hasLegacyRoot = Boolean(root?.id && root?.name);
    const hasFileGraphs = Array.isArray(files) && files.some((file) => {
      if (!file || typeof file !== "object") return false;
      const graphFile = file as Record<string, unknown>;
      const fileRoot = graphFile.root as Record<string, unknown> | undefined;
      return Boolean(graphFile.filename && fileRoot?.id && fileRoot?.name);
    });
    return Boolean(Array.isArray(obj.summaryBlocks) && (hasLegacyRoot || hasFileGraphs));
  }
}
