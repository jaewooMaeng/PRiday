import React from "react";

interface Props {
  visible: boolean;
  stage: string;
  progress: number;
  error: string | null;
  onDismiss: () => void;
}

const stageLabels: Record<string, string> = {
  preparing_reanalysis: "설정을 저장하고 재분석을 준비하는 중",
  fetching_pr: "PR 데이터 가져오는 중",
  calling_llm: "LLM 분석 중",
  parsing_ast: "AST 파싱 중",
  building_map: "매핑 생성 중",
};

export function ProgressOverlay({ visible, stage, progress, error, onDismiss }: Props): React.JSX.Element | null {
  if (!visible && !error) return null;
  const safeProgress = Math.min(100, Math.max(0, progress));
  const stageLabel = stageLabels[stage] ?? stage;

  return (
    <div className="overlay">
      <div className="overlay-card" role="status" aria-live="polite" aria-atomic="true">
        <button className="overlay-close" onClick={onDismiss} title="닫기" aria-label="로딩 창 닫기">
          ×
        </button>
        {error ? (
          <p className="error-text">{error}</p>
        ) : (
          <>
            <div className="loading-orbit" aria-hidden="true">
              <span className="loading-orbit-ring" />
              <span className="loading-orbit-core" />
            </div>
            <div className="loading-stage">
              <span>{stageLabel}</span>
              <span className="loading-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
            <div
              className="progress-bar"
              role="progressbar"
              aria-label={stageLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={safeProgress}
            >
              <div className="progress-fill" style={{ width: `${safeProgress}%` }} />
            </div>
            <p className="progress-value">{safeProgress}%</p>
          </>
        )}
      </div>
    </div>
  );
}
