import React, { useRef, useState, useMemo } from "react";
import type { SummaryBlock, LineRange } from "../types/messages";
import { splitBulletPoints } from "../utils/text";

interface Props {
  blocks: SummaryBlock[];
  activeBlockId: string | null;
  highlightedSentence: { blockId: string; sentenceIndex: number } | null;
  onSentenceDrag: (args: { blockId: string; sentenceIndex: number }) => void;
  onBlockClick: (filename: string, lineRange: LineRange) => void;
}

function topLevelBlocks(blocks: SummaryBlock[]): SummaryBlock[] {
  const topLevel = blocks.filter((b) => !b.depth || b.depth === 0);
  return topLevel.length > 0 ? topLevel : blocks;
}

export function StepByStepAnalysis({
  blocks,
  activeBlockId,
  highlightedSentence,
  onSentenceDrag,
  onBlockClick,
}: Props): React.JSX.Element {
  const [collapsedSnippets, setCollapsedSnippets] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleBlocks = useMemo(() => topLevelBlocks(blocks), [blocks]);

  function toggleSnippet(blockId: string) {
    setCollapsedSnippets((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }

  function handleBulletClick(block: SummaryBlock, sentenceIndex: number): void {
    onSentenceDrag({ blockId: block.id, sentenceIndex });
  }

  function handleTextMouseUp(block: SummaryBlock): void {
    const selection = window.getSelection()?.toString().trim();
    if (!selection || selection.length < 3) return;

    const bullets = splitBulletPoints(block.explanation);
    const sentenceIndex = Math.max(
      0,
      bullets.findIndex((s) => s.includes(selection) || selection.includes(s))
    );
    onSentenceDrag({ blockId: block.id, sentenceIndex });
  }

  function renderBlock(block: SummaryBlock, isChild = false) {
    const isActive = activeBlockId === block.id;
    const isSnippetHidden = collapsedSnippets.has(block.id);
    const bullets = splitBulletPoints(block.explanation);

    const refMap = new Map<number, { targetName: string; lineStart: number; lineEnd: number }>();
    if (block.codeReferences) {
      for (const ref of block.codeReferences) {
        refMap.set(ref.sentenceIndex, ref);
      }
    }

    return (
      <article
        key={block.id}
        className={`analysis-block ${isActive ? "analysis-active" : ""} ${isChild ? "analysis-child" : ""}`}
        id={`block-${block.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onBlockClick(block.filename, block.lineRange);
        }}
      >
        <header className="analysis-header">
          <div className="analysis-header-left">
            <span className={`block-type-badge badge-${block.blockType}`}>
              {block.blockType}
            </span>
            <strong className="block-title">{block.title}</strong>
          </div>
          <div className="analysis-header-actions">
            {block.codeSnippet && (
              <button
                type="button"
                className="snippet-toggle"
                onClick={(e) => { e.stopPropagation(); toggleSnippet(block.id); }}
              >
                <span className="snippet-toggle-icon">
                  {isSnippetHidden ? "▸" : "▾"}
                </span>
                <span className="snippet-toggle-label">
                  {isSnippetHidden ? "Show code" : "Hide code"}
                </span>
              </button>
            )}
            <span className="block-lines">
              Lines {block.lineRange.start}-{block.lineRange.end}
            </span>
          </div>
        </header>

        {block.codeSnippet && !isSnippetHidden && (
          <pre className="block-code">
            <code>{block.codeSnippet}</code>
          </pre>
        )}

        <ul
          className="bullet-list"
          data-block-id={block.id}
          onMouseUp={() => handleTextMouseUp(block)}
        >
          {bullets.map((bullet, sIdx) => {
            const isHighlighted =
              highlightedSentence?.blockId === block.id &&
              highlightedSentence?.sentenceIndex === sIdx;
            const ref = refMap.get(sIdx);
            return (
              <li
                key={sIdx}
                className={`bullet-item ${isHighlighted ? "bullet-highlight" : ""}`}
                onClick={(e) => { e.stopPropagation(); handleBulletClick(block, sIdx); }}
              >
                <span className="bullet-text">
                  {bullet}
                  {ref && (
                    <span className="bullet-ref" title={`${ref.targetName} (L${ref.lineStart}-${ref.lineEnd})`}>
                      {ref.targetName} L{ref.lineStart}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {block.keyChanges.length > 0 && (
          <div className="key-changes">
            {block.keyChanges.map((kc, i) => (
              <span key={i} className="key-change-tag">
                {kc}
              </span>
            ))}
          </div>
        )}

        <div className="drag-hint">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="12" height="12">
            <path d="M3 8h10M10 5l3 3-3 3" />
          </svg>
          항목을 클릭하거나 텍스트를 드래그하면 오른쪽 코드가 하이라이트됩니다
        </div>
      </article>
    );
  }

  return (
    <section className="card step-analysis-section" ref={containerRef} style={{ position: "relative" }}>
      <h2 className="section-label">Step-by-step analysis</h2>
      <div className="analysis-list">
        {visibleBlocks.map((block) => (
          <div key={block.id} className="analysis-group">
            {renderBlock(block)}
          </div>
        ))}
      </div>
    </section>
  );
}
