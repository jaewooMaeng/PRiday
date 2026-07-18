import { MappingBuilder } from "../../src/analysis/MappingBuilder";
import type { SummaryBlock } from "../../src/types/summary";

describe("MappingBuilder", () => {
  test("summary 문장을 코드 범위로 매핑한다", () => {
    const builder = new MappingBuilder();
    const blocks: SummaryBlock[] = [
      {
        id: "block_001",
        blockType: "function_def",
        title: "validate",
        codeSnippet: "def validate_args()",
        lineRange: { start: 3, end: 6 },
        filename: "main.py",
        explanation: "validate_args 함수는 인수 개수를 확인합니다. 오류면 종료합니다.",
        keyChanges: [],
      },
    ];
    const fileContentMap = new Map([
      ["main.py", "import sys\n\ndef validate_args():\n  if len(sys.argv) != 2:\n    sys.exit(1)\n"],
    ]);
    const astNodesByFile = new Map([
      [
        "main.py",
        [{ type: "function_definition", name: "validate_args", lineRange: { start: 3, end: 5 }, children: [] }],
      ],
    ]);

    const output = builder.build({ blocks, fileContentMap, astNodesByFile });
    expect(output.length).toBeGreaterThan(0);
    expect(output[0].summaryBlockId).toBe("block_001");
    expect(output[0].confidence).toBeGreaterThan(0);
  });
});
