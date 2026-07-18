import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASTParser } from "../../src/analysis/ASTParser";

describe("ASTParser", () => {
  test("파이썬 함수 이름/라인 범위를 추출한다", () => {
    const code = readFileSync(join(process.cwd(), "test/fixtures/sample-code.py"), "utf-8");
    const parser = new ASTParser();
    const nodes = parser.parse({ filename: "main.py", content: code });
    const names = nodes.map((node) => node.name);

    expect(names).toContain("validate_args");
    expect(names).toContain("greet");
    expect(names).toContain("main");
    const validate = nodes.find((node) => node.name === "validate_args");
    expect(validate?.lineRange.start).toBe(3);
    expect((validate?.lineRange.end ?? 0) >= 6).toBeTruthy();
  });
});
