import { bestLineMatch } from "../../src/analysis/TextSimilarity";

describe("TextSimilarity", () => {
  test("문장과 가장 유사한 코드 라인을 찾는다", () => {
    const lines = [
      "import sys, os",
      "def validate_args():",
      "if len(sys.argv) != 2:",
      "def greet(name):",
    ];
    const match = bestLineMatch("validate 함수는 인수 개수를 확인합니다", lines);
    expect(match.index).toBe(1);
    expect(match.score).toBeGreaterThan(0.3);
  });
});
