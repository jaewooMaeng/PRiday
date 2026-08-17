export interface DeletedGroup {
  id: string;
  beforeLine: number | null;
  afterLine: number;
  oldStart: number;
  lines: string[];
}

export interface DiffMeta {
  addedLines: Set<number>;
  deletedGroups: DeletedGroup[];
}

export function parseUnifiedDiff(patch: string): DiffMeta {
  const addedLines = new Set<number>();
  const deletedGroups: DeletedGroup[] = [];
  const patchLines = patch.split("\n");
  let oldLine = 0;
  let newLine = 0;
  let pending: { oldStart: number; lines: string[] } | null = null;

  function flush(beforeLine: number | null): void {
    if (!pending || pending.lines.length === 0) return;
    deletedGroups.push({
      id: `${pending.oldStart}-${deletedGroups.length}`,
      beforeLine,
      afterLine: beforeLine == null ? newLine : Math.max(0, beforeLine - 1),
      oldStart: pending.oldStart,
      lines: pending.lines,
    });
    pending = null;
  }

  for (const line of patchLines) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      flush(newLine + 1);
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("\\")) continue;

    if (line.startsWith("-")) {
      if (!pending) pending = { oldStart: oldLine, lines: [] };
      pending.lines.push(line.slice(1));
      oldLine += 1;
      continue;
    }

    flush(newLine);
    if (line.startsWith("+")) {
      addedLines.add(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }

  flush(null);
  return { addedLines, deletedGroups };
}
