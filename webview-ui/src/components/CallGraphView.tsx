import React, { useMemo, useState } from "react";
import type {
  CallGraphFile,
  CallGraphNode,
  LineRange,
  PRFileInfo,
  SummaryBlock,
} from "../types/messages";
import { splitBulletPoints } from "../utils/text";

interface Props {
  callGraph: { root?: CallGraphNode; files?: CallGraphFile[] } | null;
  files: PRFileInfo[];
  blocks: SummaryBlock[];
  activeBlockId: string | null;
  highlightedSentence: { blockId: string; sentenceIndex: number } | null;
  onSentenceDrag: (args: { blockId: string; sentenceIndex: number }) => void;
  onBlockClick: (filename: string, lineRange: LineRange) => void;
}

interface FlowNode {
  node: CallGraphNode;
  depth: number;
}

interface NormalizedGraphFile {
  id: string;
  filename: string;
  title: string;
  root: CallGraphNode;
  relatedFiles: string[];
}

function countNodes(node: CallGraphNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function flattenByDepth(root: CallGraphNode): FlowNode[][] {
  const levels: FlowNode[][] = [];
  const visit = (node: CallGraphNode, depth: number) => {
    const level = levels[depth] ?? [];
    level.push({ node, depth });
    levels[depth] = level;
    node.children.forEach((child) => visit(child, depth + 1));
  };
  visit(root, 0);
  return levels;
}

function findNode(root: CallGraphNode, id: string): CallGraphNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function collectNodes(root: CallGraphNode, out: CallGraphNode[] = []): CallGraphNode[] {
  out.push(root);
  root.children.forEach((child) => collectNodes(child, out));
  return out;
}

function cloneNodeForFile(node: CallGraphNode, filename: string): CallGraphNode | null {
  const children = node.children
    .map((child) => cloneNodeForFile(child, filename))
    .filter((child): child is CallGraphNode => Boolean(child));

  if (node.filename === filename) {
    return { ...node, children };
  }

  if (children.length > 0) {
    return {
      ...node,
      id: `${filename}:${node.id}`,
      filename,
      children,
    };
  }

  return null;
}

function emptyModuleNode(filename: string): CallGraphNode {
  return {
    id: `module:${filename}`,
    name: filename.split("/").pop() ?? filename,
    type: "module",
    signature: "",
    summary: "이 파일에서 변경된 주요 흐름을 확인합니다.",
    bulletPoints: [],
    lineRange: { start: 1, end: 1 },
    filename,
    children: [],
  };
}

function normalizeGraphFiles(
  callGraph: Props["callGraph"],
  files: PRFileInfo[]
): NormalizedGraphFile[] {
  const changedOrder = files.map((file) => file.filename);

  if (callGraph?.files?.length) {
    return [...callGraph.files]
      .sort((a, b) => {
        const ai = changedOrder.indexOf(a.filename);
        const bi = changedOrder.indexOf(b.filename);
        return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      })
      .map((file, index) => ({
        id: file.id || `graph-file-${index}`,
        filename: file.filename,
        title: file.title || file.filename.split("/").pop() || file.filename,
        root: file.root,
        relatedFiles: file.relatedFiles ?? [],
      }));
  }

  if (!callGraph?.root) {
    return files.map((file) => ({
      id: `graph-file:${file.filename}`,
      filename: file.filename,
      title: file.filename.split("/").pop() || file.filename,
      root: emptyModuleNode(file.filename),
      relatedFiles: [],
    }));
  }

  const filenames = changedOrder.length > 0
    ? changedOrder
    : Array.from(new Set(collectNodes(callGraph.root).map((node) => node.filename)));

  return filenames.map((filename) => {
    const rootForFile = cloneNodeForFile(callGraph.root as CallGraphNode, filename) ?? emptyModuleNode(filename);
    return {
      id: `graph-file:${filename}`,
      filename,
      title: filename.split("/").pop() || filename,
      root: rootForFile,
      relatedFiles: [],
    };
  });
}

function nodeLabel(node: CallGraphNode): string {
  const signature = node.signature?.replace(/^[^(]*\(/, "").replace(/\)$/, "");
  return signature ? `${node.name}(${signature})` : node.name;
}

function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

function blockMatchesNode(block: SummaryBlock, node: CallGraphNode): boolean {
  if (block.filename !== node.filename) return false;
  if (rangesOverlap(block.lineRange, node.lineRange)) return true;
  const haystack = `${block.title} ${block.explanation}`.toLowerCase();
  return haystack.includes(node.name.toLowerCase());
}

export function CallGraphView({
  callGraph,
  files,
  blocks,
  activeBlockId,
  highlightedSentence,
  onSentenceDrag,
  onBlockClick,
}: Props): JSX.Element {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const [collapsedSnippets, setCollapsedSnippets] = useState<Set<string>>(new Set());

  const graphFiles = useMemo(() => normalizeGraphFiles(callGraph, files), [callGraph, files]);
  const selectedFile = graphFiles.find((file) => file.id === selectedFileId) ?? graphFiles[0];
  const levels = useMemo(
    () => (selectedFile ? flattenByDepth(selectedFile.root) : []),
    [selectedFile]
  );

  if (!selectedFile) {
    return (
      <section>
        <div className="section-label">Call graph</div>
        <div className="graph-area">
          <p className="muted">분석 결과를 기다리는 중입니다.</p>
        </div>
      </section>
    );
  }

  const selected = findNode(selectedFile.root, selectedNodeId ?? selectedFile.root.id) ?? selectedFile.root;
  const nodeCount = countNodes(selectedFile.root);
  const fileBlocks = blocks.filter((block) => block.filename === selectedFile.filename);
  const directBlocks = fileBlocks.filter((block) => !block.depth || block.depth === 0);
  const candidateBlocks = directBlocks.filter((block) => blockMatchesNode(block, selected));
  const visibleBlocks = candidateBlocks.length > 0 ? candidateBlocks : directBlocks;
  const childBlocksByParent = new Map<string, SummaryBlock[]>();
  fileBlocks
    .filter((block) => block.depth && block.depth > 0)
    .forEach((block) => {
      const parentId = block.parentId ?? "";
      const list = childBlocksByParent.get(parentId) ?? [];
      list.push(block);
      childBlocksByParent.set(parentId, list);
    });

  function selectFile(file: NormalizedGraphFile): void {
    setSelectedFileId(file.id);
    setSelectedNodeId(file.root.id);
  }

  function toggleDetails(blockId: string): void {
    setExpandedDetails((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }

  function toggleSnippet(blockId: string): void {
    setCollapsedSnippets((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }

  function renderSummaryBlock(block: SummaryBlock, isChild = false): JSX.Element {
    const bullets = splitBulletPoints(block.explanation);
    const refMap = new Map<number, { targetName: string; lineStart: number; lineEnd: number }>();
    block.codeReferences?.forEach((ref) => refMap.set(ref.sentenceIndex, ref));
    const childBlocks = childBlocksByParent.get(block.id) ?? [];
    const detailsOpen = expandedDetails.has(block.id);
    const snippetHidden = collapsedSnippets.has(block.id);
    const isActive = activeBlockId === block.id;

    return (
      <article
        key={block.id}
        className={`graph-analysis-block ${isActive ? "graph-analysis-active" : ""} ${isChild ? "graph-analysis-child" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onBlockClick(block.filename, block.lineRange);
        }}
      >
        <div className="graph-analysis-header">
          <span className={`block-type-badge badge-${block.blockType}`}>{block.blockType}</span>
          <strong>{block.title}</strong>
          <span className="block-lines">L{block.lineRange.start}-{block.lineRange.end}</span>
        </div>

        {block.codeSnippet && !snippetHidden && (
          <pre className="graph-block-code">
            <code>{block.codeSnippet}</code>
          </pre>
        )}

        <ul className="bullet-list graph-bullet-list">
          {bullets.map((bullet, index) => {
            const ref = refMap.get(index);
            const isHighlighted =
              highlightedSentence?.blockId === block.id &&
              highlightedSentence?.sentenceIndex === index;
            return (
              <li
                key={index}
                className={`bullet-item ${isHighlighted ? "bullet-highlight" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSentenceDrag({ blockId: block.id, sentenceIndex: index });
                }}
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

        <div className="graph-analysis-actions">
          {block.codeSnippet && (
            <button
              type="button"
              className="text-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                toggleSnippet(block.id);
              }}
            >
              {snippetHidden ? "Show code" : "Hide code"}
            </button>
          )}
          {childBlocks.length > 0 && (
            <button
              type="button"
              className="text-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                toggleDetails(block.id);
              }}
            >
              {detailsOpen ? "상세 닫기" : `상세 ${childBlocks.length}개`}
            </button>
          )}
        </div>

        {detailsOpen && childBlocks.length > 0 && (
          <div className="graph-analysis-children">
            {childBlocks.map((child) => renderSummaryBlock(child, true))}
          </div>
        )}
      </article>
    );
  }

  return (
    <section>
      <div className="section-label">Call graph</div>
      <div className="graph-area graph-flow-area">
        <div className="graph-header graph-file-header">
          <span className="graph-count">{nodeCount} nodes</span>
          {selectedFile.relatedFiles.length > 0 && (
            <span className="graph-related-files">
              includes {selectedFile.relatedFiles.length} files
            </span>
          )}
        </div>

        <div className="graph-file-tabs" role="tablist" aria-label="Call graph files">
          {graphFiles.map((file) => (
            <button
              key={file.id}
              type="button"
              className={`graph-file-tab ${file.id === selectedFile.id ? "graph-file-tab-active" : ""}`}
              onClick={() => selectFile(file)}
              title={file.filename}
            >
              <span>{file.title}</span>
            </button>
          ))}
        </div>

        <div className="flow-graph" role="tree" aria-label="Call graph flow">
          {levels.map((level, depth) => (
            <div key={depth} className="flow-level">
              {depth > 0 && <div className="flow-level-connector" aria-hidden="true" />}
              <div className="flow-node-row">
                {level.map(({ node }) => (
                  <button
                    key={node.id}
                    type="button"
                    className={`flow-node ${selected.id === node.id ? "flow-node-selected" : ""}`}
                    onClick={() => setSelectedNodeId(node.id)}
                    title={`${node.filename}: ${node.lineRange.start}-${node.lineRange.end}`}
                  >
                    <span className="flow-node-type">{node.type.slice(0, 1).toUpperCase()}</span>
                    <span className="flow-node-name">{nodeLabel(node)}</span>
                    {node.children.length > 0 && (
                      <span className="flow-node-count">{node.children.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <aside className="flow-detail">
          <div className="flow-detail-title">
            <strong>{nodeLabel(selected)}</strong>
            <span>{selected.filename} L{selected.lineRange.start}-{selected.lineRange.end}</span>
          </div>
          {selected.summary && <p>{selected.summary}</p>}
          {selected.bulletPoints.length > 0 && (
            <ul className="node-detail-bullets">
              {selected.bulletPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          )}

          {visibleBlocks.length > 0 && (
            <div className="graph-analysis-panel">
              <div className="graph-analysis-title">선택 노드 상세</div>
              {visibleBlocks.map((block) => renderSummaryBlock(block))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
