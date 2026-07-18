import type { ASTNode } from "./ASTParser";
import { bestLineMatch } from "./TextSimilarity";
import type { SummaryBlock, MappingEntry } from "../types/summary";

interface BuildInput {
  blocks: SummaryBlock[];
  fileContentMap: Map<string, string>;
  astNodesByFile: Map<string, ASTNode[]>;
}

function splitBulletPoints(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets: string[] = [];
  let sawMarker = false;
  for (const line of lines) {
    const markerMatch = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (markerMatch) {
      sawMarker = true;
      bullets.push(markerMatch[1].trim());
      continue;
    }
    if (sawMarker && bullets.length > 0) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line}`.trim();
      continue;
    }
    bullets.push(line);
  }
  if (sawMarker) return bullets.filter(Boolean);
  return text
    .split(/(?<=[.!?。])\s+/)
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

function findNodeByName(nodes: ASTNode[], text: string): ASTNode | undefined {
  const lower = text.toLowerCase();
  return nodes.find((node) => lower.includes(node.name.toLowerCase()));
}

export class MappingBuilder {
  public build({ blocks, fileContentMap, astNodesByFile }: BuildInput): MappingEntry[] {
    const mappings: MappingEntry[] = [];

    for (const block of blocks) {
      const fileContent = fileContentMap.get(block.filename) ?? "";
      const lines = fileContent.split("\n");
      const astNodes = astNodesByFile.get(block.filename) ?? [];
      const sentences = splitBulletPoints(block.explanation);

      const refMap = new Map<number, { lineStart: number; lineEnd: number; targetName: string }>();
      if (block.codeReferences) {
        for (const ref of block.codeReferences) {
          refMap.set(ref.sentenceIndex, ref);
        }
      }

      sentences.forEach((sentence, sentenceIndex) => {
        const llmRef = refMap.get(sentenceIndex);

        if (llmRef && llmRef.lineStart > 0 && llmRef.lineEnd >= llmRef.lineStart) {
          mappings.push({
            summaryBlockId: block.id,
            sentenceIndex,
            sentenceText: sentence,
            filename: block.filename,
            codeLineStart: llmRef.lineStart,
            codeLineEnd: llmRef.lineEnd,
            confidence: 0.85,
          });
          return;
        }

        let start = block.lineRange.start;
        let end = block.lineRange.end;
        let confidence = 0.2;

        const astMatch = findNodeByName(astNodes, sentence);
        if (astMatch) {
          start = astMatch.lineRange.start;
          end = astMatch.lineRange.end;
          confidence = 0.5;
        }

        if (lines.length > 0) {
          const best = bestLineMatch(sentence, lines);
          if (best.score >= 0.1) {
            start = best.index + 1;
            end = Math.min(lines.length, best.index + 3);
            confidence = Math.max(confidence, Math.min(best.score, 1));
          }
        }

        if (confidence >= 0.1) {
          mappings.push({
            summaryBlockId: block.id,
            sentenceIndex,
            sentenceText: sentence,
            filename: block.filename,
            codeLineStart: start,
            codeLineEnd: end,
            confidence,
          });
        }
      });
    }

    return mappings;
  }
}
