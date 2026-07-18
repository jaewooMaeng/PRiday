import { useMemo, useState } from "react";
import type { MappingEntry } from "../types/messages";

export function useMapping(mappingTable: MappingEntry[]) {
  const [highlighted, setHighlighted] = useState<{ blockId: string; sentenceIndex: number } | null>(null);

  const mapByBlock = useMemo(() => {
    const map = new Map<string, MappingEntry[]>();
    for (const row of mappingTable) {
      const list = map.get(row.summaryBlockId) ?? [];
      list.push(row);
      map.set(row.summaryBlockId, list);
    }
    return map;
  }, [mappingTable]);

  function findBest(blockId: string, sentenceIndex: number): MappingEntry | undefined {
    return mapByBlock.get(blockId)?.find((item) => item.sentenceIndex === sentenceIndex);
  }

  return { highlighted, setHighlighted, findBest };
}
