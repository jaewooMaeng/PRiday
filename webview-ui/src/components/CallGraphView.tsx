import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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

interface NormalizedGraphFile {
  id: string;
  filename: string;
  title: string;
  root: CallGraphNode;
  relatedFiles: string[];
}

interface GraphEdge {
  id: string;
  parentId: string;
  childId: string;
  path: string;
}

interface GraphCanvasSize {
  width: number;
  height: number;
}

function countNodes(node: CallGraphNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function collectEdges(node: CallGraphNode, out: Array<[CallGraphNode, CallGraphNode]> = []): Array<[CallGraphNode, CallGraphNode]> {
  node.children.forEach((child) => {
    out.push([node, child]);
    collectEdges(child, out);
  });
  return out;
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
  return node.name.replace(/\(.*\)$/, "");
}

function nodeArguments(node: CallGraphNode): string {
  const match = node.signature?.match(/\((.*)\)/s);
  return match?.[1]?.trim() ?? "";
}

function nodeTypeLabel(node: CallGraphNode): string {
  if (node.type === "module") return "Module";
  if (node.type === "class") return "Class";
  if (node.type === "method") return "Method";
  return "Function";
}

function nodeIcon(node: CallGraphNode): string {
  if (node.type === "module") return "M";
  if (node.type === "class") return "C";
  if (node.type === "method") return "m";
  return "f";
}

function nodeIconClass(node: CallGraphNode): string {
  if (node.type === "module") return "fn-icon-mod";
  if (node.type === "class") return "fn-icon-dec";
  return "fn-icon-fn";
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
}: Props): React.JSX.Element {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const [collapsedSnippets, setCollapsedSnippets] = useState<Set<string>>(new Set());
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphCanvasSize, setGraphCanvasSize] = useState<GraphCanvasSize>({ width: 0, height: 0 });
  const treeRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const graphFiles = useMemo(() => normalizeGraphFiles(callGraph, files), [callGraph, files]);
  const selectedFile = graphFiles.find((file) => file.id === selectedFileId) ?? graphFiles[0];
  const measureGraph = useCallback(() => {
    const tree = treeRef.current;
    if (!tree || !selectedFile) {
      setGraphEdges([]);
      return;
    }

    const treeRect = tree.getBoundingClientRect();
    const width = Math.max(tree.clientWidth, tree.scrollWidth);
    const height = Math.max(tree.clientHeight, tree.scrollHeight);
    const nextEdges = collectEdges(selectedFile.root).flatMap(([parent, child], index) => {
      const parentElement = nodeRefs.current.get(parent.id);
      const childElement = nodeRefs.current.get(child.id);
      if (!parentElement || !childElement) return [];

      const parentRect = parentElement.getBoundingClientRect();
      const childRect = childElement.getBoundingClientRect();
      const startX = parentRect.left - treeRect.left + parentRect.width / 2;
      const startY = parentRect.bottom - treeRect.top;
      const endX = childRect.left - treeRect.left + childRect.width / 2;
      const endY = childRect.top - treeRect.top - 5;
      const middleY = startY + Math.max(12, (endY - startY) / 2);

      return [{
        id: `${parent.id}:${child.id}:${index}`,
        parentId: parent.id,
        childId: child.id,
        path: `M ${startX} ${startY} L ${startX} ${middleY} L ${endX} ${middleY} L ${endX} ${endY}`,
      }];
    });

    setGraphCanvasSize({ width, height });
    setGraphEdges(nextEdges);
  }, [selectedFile]);

  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree || !selectedFile) return;

    const frame = window.requestAnimationFrame(measureGraph);
    const observer = new ResizeObserver(() => measureGraph());
    observer.observe(tree);
    nodeRefs.current.forEach((node) => observer.observe(node));
    window.addEventListener("resize", measureGraph);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measureGraph);
    };
  }, [measureGraph, selectedFile]);

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

  function renderSummaryBlock(block: SummaryBlock, isChild = false): React.JSX.Element {
    const bullets = splitBulletPoints(block.explanation);
    const hasBulletFormatting = /^\s*(?:[-*•]|\d+[.)])\s+/m.test(block.explanation);
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

        {hasBulletFormatting && bullets.length > 1 ? (
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
        ) : (
          <div className="graph-prose-list">
            {bullets.map((text, index) => {
              const ref = refMap.get(index);
              const isHighlighted =
                highlightedSentence?.blockId === block.id &&
                highlightedSentence?.sentenceIndex === index;
              return (
                <p
                  key={index}
                  className={isHighlighted ? "graph-prose-highlight" : ""}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSentenceDrag({ blockId: block.id, sentenceIndex: index });
                  }}
                >
                  {text}
                  {ref && (
                    <span className="bullet-ref" title={`${ref.targetName} (L${ref.lineStart}-${ref.lineEnd})`}>
                      {ref.targetName} L{ref.lineStart}
                    </span>
                  )}
                </p>
              );
            })}
          </div>
        )}

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

  function renderTreeNode(node: CallGraphNode): React.JSX.Element {
    const isSelected = selected.id === node.id;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id} className={`call-tree-item ${hasChildren ? "call-tree-branch" : ""}`}>
        <button
          type="button"
          className={`call-tree-node ${isSelected ? "call-tree-node-selected" : ""}`}
          ref={(element) => {
            if (element) nodeRefs.current.set(node.id, element);
            else nodeRefs.current.delete(node.id);
          }}
          onClick={() => setSelectedNodeId(node.id)}
          title={`${node.signature || nodeLabel(node)} · ${node.filename}: ${node.lineRange.start}-${node.lineRange.end}`}
        >
          <span className={`fn-icon ${nodeIconClass(node)}`}>{nodeIcon(node)}</span>
          <span className="call-tree-text">
            <span className="call-tree-name">{nodeLabel(node)}</span>
            {nodeArguments(node) && <span className="call-tree-args">args: {nodeArguments(node)}</span>}
            <span className="call-tree-meta">
              {nodeTypeLabel(node)} · L{node.lineRange.start}-{node.lineRange.end}
            </span>
          </span>
          {hasChildren && <span className="flow-node-count">{node.children.length}</span>}
        </button>
        {hasChildren && (
          <div className="call-tree-children">
            {node.children.map((child) => renderTreeNode(child))}
          </div>
        )}
      </div>
    );
  }

  return (
    <section>
      <div className="section-label">Call graph</div>
      <div className="graph-area graph-flow-area">
        <div className="graph-file-tabs graph-file-tabs-vscode" role="tablist" aria-label="Call graph files">
          {graphFiles.map((file) => (
            <button
              key={file.id}
              type="button"
              className={`graph-file-tab ${file.id === selectedFile.id ? "graph-file-tab-active" : ""}`}
              onClick={() => selectFile(file)}
              title={file.filename}
            >
              <span className="file-tab-icon">{file.filename.endsWith(".ts") || file.filename.endsWith(".tsx") ? "TS" : "F"}</span>
              <span className="file-tab-name">{file.filename.split("/").pop() ?? file.filename}</span>
            </button>
          ))}
        </div>

        <div className="graph-workspace">
          <div className="graph-diagram-pane">
            <div className="graph-header graph-file-header">
              <strong className="graph-file-analysis-title">{selectedFile.title}</strong>
              <div className="graph-file-meta">
                <span className="graph-count">{nodeCount} nodes</span>
                {selectedFile.relatedFiles.length > 0 && (
                  <span className="graph-related-files">
                    includes {selectedFile.relatedFiles.length} files
                  </span>
                )}
              </div>
            </div>
            <div className="call-tree" ref={treeRef} role="tree" aria-label="Call graph flow">
              {graphCanvasSize.width > 0 && (
                <svg
                  className="call-tree-edges"
                  width={graphCanvasSize.width}
                  height={graphCanvasSize.height}
                  viewBox={`0 0 ${graphCanvasSize.width} ${graphCanvasSize.height}`}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="call-tree-arrow"
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto"
                    >
                      <path d="M 0 0 L 8 4 L 0 8 z" />
                    </marker>
                    <marker
                      id="call-tree-arrow-active"
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto"
                    >
                      <path d="M 0 0 L 8 4 L 0 8 z" />
                    </marker>
                  </defs>
                  {graphEdges.map((edge) => {
                    const active = edge.parentId === selected.id || edge.childId === selected.id;
                    return (
                      <path
                        key={edge.id}
                        className={`call-tree-edge ${active ? "call-tree-edge-active" : ""}`}
                        d={edge.path}
                        markerEnd={`url(#${active ? "call-tree-arrow-active" : "call-tree-arrow"})`}
                      />
                    );
                  })}
                </svg>
              )}
              {renderTreeNode(selectedFile.root)}
            </div>
          </div>

          <aside className="flow-detail">
            <div className="flow-detail-eyebrow">선택 노드 상세</div>
            <div className="flow-detail-title">
              <strong>{nodeLabel(selected)}</strong>
              <span>{selected.filename} L{selected.lineRange.start}-{selected.lineRange.end}</span>
            </div>
            {nodeArguments(selected) && (
              <div className="flow-detail-signature">args: {nodeArguments(selected)}</div>
            )}
            {selected.summary && <p>{selected.summary}</p>}
            {selected.bulletPoints.length > 0 && (
              <ul className="node-detail-bullets">
                {selected.bulletPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            )}
          </aside>
        </div>

        {visibleBlocks.length > 0 && (
          <div className="graph-analysis-panel graph-analysis-panel-below">
            <div className="graph-analysis-title">In-depth snippet analysis</div>
            {visibleBlocks.map((block) => renderSummaryBlock(block))}
          </div>
        )}
      </div>
    </section>
  );
}
