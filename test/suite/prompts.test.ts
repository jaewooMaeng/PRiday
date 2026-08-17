import { buildAnalysisPrompt, buildChatPrompt } from "../../src/llm/prompts";
import type { PRDiffResult } from "../../src/types/github";

const diff: PRDiffResult = {
  prTitle: "Improve parser",
  prBody: "Adds MLIR parsing",
  baseBranch: "main",
  headBranch: "feature/mlir",
  comments: [],
  files: [{
    filename: "src/parser.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -1 +1 @@\n-old\n+new",
    rawContent: "new",
  }],
};

describe("LLM prompts", () => {
  test("추가 분석 기준을 trim하여 분석 prompt에만 포함한다", () => {
    const criteria = "  MLIR 문법 오류를 우선 확인해줘.  ";
    const analysisPrompt = buildAnalysisPrompt(diff, "ko", criteria);
    const chatPrompt = buildChatPrompt("무엇이 바뀌었나요?", "context", "ko");

    expect(analysisPrompt).toContain("ADDITIONAL REVIEW CRITERIA:");
    expect(analysisPrompt).toContain("MLIR 문법 오류를 우선 확인해줘.");
    expect(analysisPrompt).not.toContain(criteria);
    expect(chatPrompt).not.toContain("MLIR 문법 오류");
  });

  test("빈 추가 분석 기준은 prompt에 별도 섹션을 만들지 않는다", () => {
    const prompt = buildAnalysisPrompt(diff, "en", "   ");
    expect(prompt).not.toContain("ADDITIONAL REVIEW CRITERIA:");
  });
});
