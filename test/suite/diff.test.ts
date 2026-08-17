import { parseUnifiedDiff } from "../../webview-ui/src/utils/diff";

describe("parseUnifiedDiff", () => {
  test("여러 hunk의 추가 라인과 삭제 그룹 위치를 계산한다", () => {
    const patch = [
      "@@ -2,4 +2,4 @@",
      " keep",
      "-removed one",
      "-removed two",
      "+added one",
      "+added two",
      " tail",
      "@@ -20,2 +20,3 @@",
      " context",
      "+later addition",
      " end",
    ].join("\n");

    const result = parseUnifiedDiff(patch);

    expect([...result.addedLines]).toEqual([3, 4, 21]);
    expect(result.deletedGroups).toHaveLength(1);
    expect(result.deletedGroups[0]).toMatchObject({
      beforeLine: 3,
      oldStart: 3,
      lines: ["removed one", "removed two"],
    });
  });

  test("파일 끝 삭제를 마지막 논리 위치에 유지한다", () => {
    const result = parseUnifiedDiff("@@ -8,2 +8,1 @@\n keep\n-removed at eof\n\\ No newline at end of file");

    expect(result.deletedGroups).toHaveLength(1);
    expect(result.deletedGroups[0].beforeLine).toBeNull();
    expect(result.deletedGroups[0].afterLine).toBe(9);
  });
});
