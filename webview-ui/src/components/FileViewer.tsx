import React, { useEffect, useRef, useMemo, useState } from "react";
import type { PRFileInfo, LineRange } from "../types/messages";

interface Props {
  files: PRFileInfo[];
  selectedFile: string | null;
  onSelectFile: (filename: string) => void;
  highlightRange: LineRange | null;
  onRequestComment?: (args: {
    text: string;
    filename: string;
    line: number;
  }) => void;
}

interface DeletedGroup {
  id: string;
  beforeLine: number | null;
  afterLine: number;
  oldStart: number;
  lines: string[];
}

interface DiffMeta {
  addedLines: Set<number>;
  deletedGroups: DeletedGroup[];
}

function parseUnifiedDiff(patch: string): DiffMeta {
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
    if (line.startsWith("+++") || line.startsWith("---")) continue;

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

export function FileViewer({
  files,
  selectedFile,
  onSelectFile,
  highlightRange,
  onRequestComment,
}: Props): JSX.Element {
  const codeRef = useRef<HTMLDivElement>(null);
  const [commentPopup, setCommentPopup] = useState<{
    text: string;
    filename: string;
    line: number;
    x: number;
    y: number;
  } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [expandedDeletions, setExpandedDeletions] = useState<Set<string>>(new Set());

  const currentFile = useMemo(
    () => files.find((f) => f.filename === selectedFile) ?? null,
    [files, selectedFile]
  );

  const lines = useMemo(
    () => (currentFile?.rawContent ? currentFile.rawContent.split("\n") : []),
    [currentFile]
  );

  const diffMeta = useMemo(
    () => parseUnifiedDiff(currentFile?.patch ?? ""),
    [currentFile]
  );

  const deletionsByBeforeLine = useMemo(() => {
    const map = new Map<number | null, DeletedGroup[]>();
    for (const group of diffMeta.deletedGroups) {
      const list = map.get(group.beforeLine) ?? [];
      list.push(group);
      map.set(group.beforeLine, list);
    }
    return map;
  }, [diffMeta]);

  useEffect(() => {
    if (!highlightRange || !codeRef.current) return;
    const el = codeRef.current.querySelector(
      `[data-line="${highlightRange.start}"]`
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightRange]);

  function handleCodeMouseUp(e: React.MouseEvent): void {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (!selectedText || selectedText.length < 2 || !currentFile) return;

    const anchorNode = selection?.anchorNode;
    const lineEl = (anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement)
      ?.closest("[data-line]");
    const lineNum = lineEl ? parseInt(lineEl.getAttribute("data-line") ?? "1", 10) : 1;

    const rect = codeRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0);
    const y = e.clientY - (rect?.top ?? 0);

    setCommentPopup({
      text: selectedText,
      filename: currentFile.filename,
      line: lineNum,
      x: Math.min(x, (rect?.width ?? 300) - 290),
      y,
    });
  }

  function submitComment() {
    if (!commentPopup || !commentText.trim() || !onRequestComment) return;
    onRequestComment({
      text: commentText,
      filename: commentPopup.filename,
      line: commentPopup.line,
    });
    setCommentPopup(null);
    setCommentText("");
  }

  function dismissPopup() {
    setCommentPopup(null);
    setCommentText("");
  }

  function toggleDeletion(id: string): void {
    setExpandedDeletions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderDeletedGroup(group: DeletedGroup): JSX.Element {
    const isOpen = expandedDeletions.has(group.id);
    return (
      <div key={group.id} className="deleted-group">
        <button
          type="button"
          className="deleted-toggle"
          onClick={() => toggleDeletion(group.id)}
        >
          <span>{isOpen ? "⌄" : "›"}</span>
          <strong>{group.lines.length}줄 삭제됨</strong>
          <span>삭제 내용 표시</span>
        </button>
        {isOpen && group.lines.map((line, idx) => (
          <div
            key={`${group.id}-${idx}`}
            className="file-line file-line-del"
            data-old-line={group.oldStart + idx}
          >
            <span className="file-line-num">-</span>
            <span className="file-line-content file-line-content-diff">- {line || " "}</span>
          </div>
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="file-viewer-empty">
        <p className="muted">분석을 시작하면 PR 파일이 여기에 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className="file-viewer" style={{ position: "relative" }}>
      <div className="file-tabs-bar">
        <div className="file-tabs-scroll">
          {files.map((f) => (
            <button
              key={f.filename}
              className={`file-tab ${selectedFile === f.filename ? "file-tab-active" : ""}`}
              onClick={() => onSelectFile(f.filename)}
              title={f.filename}
            >
              <span className="file-tab-icon">
                {f.status === "added" ? "+" : f.status === "removed" ? "−" : "~"}
              </span>
              <span className="file-tab-name">
                {f.filename.split("/").pop()}
              </span>
              <span className="file-tab-stats">
                <span className="stat-add">+{f.additions}</span>
                <span className="stat-del">-{f.deletions}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {currentFile ? (
        <>
          <div className="file-path-bar">
            <span className="file-path-text">{currentFile.filename}</span>
            {onRequestComment && (
              <span className="file-comment-hint">코드를 드래그하여 PR 코멘트 작성</span>
            )}
          </div>
          <div className="file-code-container" ref={codeRef} onMouseUp={handleCodeMouseUp}>
            {(deletionsByBeforeLine.get(1) ?? []).map(renderDeletedGroup)}
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isHighlighted =
                highlightRange != null &&
                lineNum >= highlightRange.start &&
                lineNum <= highlightRange.end;
              const isAdded = diffMeta.addedLines.has(lineNum);
              return (
                <React.Fragment key={idx}>
                  {lineNum > 1 && (deletionsByBeforeLine.get(lineNum) ?? []).map(renderDeletedGroup)}
                  <div
                    className={`file-line ${isHighlighted ? "file-line-hl" : ""} ${isAdded ? "file-line-add" : ""}`}
                    data-line={lineNum}
                  >
                    <span className="file-line-num">{lineNum}</span>
                    <span className="file-line-content">{isAdded ? `+ ${line || " "}` : line || " "}</span>
                  </div>
                </React.Fragment>
              );
            })}
            {(deletionsByBeforeLine.get(null) ?? []).map(renderDeletedGroup)}
          </div>
        </>
      ) : (
        <div className="file-viewer-placeholder">
          <p className="muted">왼쪽에서 파일을 선택하거나 분석 블록을 클릭하세요.</p>
        </div>
      )}

      {commentPopup && (
        <div
          className="comment-popup"
          style={{ top: commentPopup.y, left: commentPopup.x }}
        >
          <div className="comment-popup-header">
            <span className="comment-popup-title">PR Comment</span>
            <button className="close-btn" onClick={dismissPopup}>×</button>
          </div>
          <div className="comment-popup-meta">
            {commentPopup.filename} : Line {commentPopup.line}
          </div>
          <div className="comment-popup-quote">"{commentPopup.text.slice(0, 120)}"</div>
          <textarea
            className="comment-input"
            placeholder="Write a comment..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="comment-popup-actions">
            <button className="btn btn-secondary" onClick={dismissPopup}>Cancel</button>
            <button className="btn btn-primary" onClick={submitComment}>Post Comment</button>
          </div>
        </div>
      )}
    </div>
  );
}
