import React from "react";

interface Props {
  visible: boolean;
  stage: string;
  progress: number;
  error: string | null;
  onDismiss: () => void;
}

const stageLabels: Record<string, string> = {
  fetching_pr: "PR 데이터 가져오는 중...",
  calling_llm: "LLM 분석 중...",
  parsing_ast: "AST 파싱 중...",
  building_map: "매핑 생성 중...",
};

export function ProgressOverlay({ visible, stage, progress, error, onDismiss }: Props): JSX.Element | null {
  if (!visible && !error) return null;

  return (
    <div className="overlay">
      <div className="overlay-card">
        <button className="overlay-close" onClick={onDismiss} title="Close">
          ×
        </button>
        {error ? (
          <p className="error-text">{error}</p>
        ) : (
          <>
            <p className="muted">{stageLabels[stage] ?? stage}</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="muted">{progress}%</p>
          </>
        )}
      </div>
    </div>
  );
}
