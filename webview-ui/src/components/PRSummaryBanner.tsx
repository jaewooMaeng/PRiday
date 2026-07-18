import React from "react";
import type { PRMetadata, PRFileInfo } from "../types/messages";

interface Props {
  text: string;
  prMeta?: PRMetadata;
  files?: PRFileInfo[];
}

export function PRSummaryBanner({ text, prMeta, files }: Props): JSX.Element {
  const totalAdd = files?.reduce((s, f) => s + f.additions, 0) ?? 0;
  const totalDel = files?.reduce((s, f) => s + f.deletions, 0) ?? 0;

  return (
    <section className="pr-banner">
      {prMeta && (
        <>
          <div className="pr-title-row">
            <span className="pr-title-text">{prMeta.title}</span>
            {prMeta.prNumber != null && (
              <span className="pr-badge">PR #{prMeta.prNumber}</span>
            )}
          </div>
          <div className="pr-branch-row">
            <code className="branch-tag">{prMeta.baseBranch}</code>
            <span className="branch-arrow">←</span>
            <code className="branch-tag">{prMeta.headBranch}</code>
            {files && files.length > 0 && (
              <span className="pr-file-stats">
                <span className="stat-add">+{totalAdd}</span>
                <span className="stat-del">-{totalDel}</span>
                <span className="stat-files">{files.length} files</span>
              </span>
            )}
          </div>
        </>
      )}
      <p className="pr-summary-text">{text}</p>
    </section>
  );
}
