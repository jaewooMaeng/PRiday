import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ResponseParser } from "../../src/analysis/ResponseParser";

describe("ResponseParser", () => {
  test("정상 JSON 응답을 파싱한다", () => {
    const raw = readFileSync(join(process.cwd(), "test/fixtures/sample-llm-response.json"), "utf-8");
    const parser = new ResponseParser();
    const parsed = parser.parse(raw);
    expect(parsed.callGraph.root.name).toContain("main");
    expect(parsed.summaryBlocks.length).toBeGreaterThan(0);
  });

  test("깨진 JSON은 에러를 던진다", () => {
    const parser = new ResponseParser();
    expect(() => parser.parse("{bad-json}")).toThrow("분석 결과를 파싱하지 못했습니다");
  });

  test("파일별 call graph 응답을 파싱한다", () => {
    const parser = new ResponseParser();
    const parsed = parser.parse(JSON.stringify({
      callGraph: {
        files: [
          {
            id: "graph-a",
            filename: "src/a.ts",
            title: "a.ts",
            relatedFiles: [],
            root: {
              id: "a-main",
              name: "main",
              type: "function",
              signature: "main()",
              summary: "entry",
              bulletPoints: [],
              lineRange: { start: 1, end: 4 },
              filename: "src/a.ts",
              children: [],
            },
          },
        ],
      },
      summaryBlocks: [],
      prSummary: "summary",
    }));

    expect(parsed.callGraph.files?.[0].filename).toBe("src/a.ts");
  });
});
