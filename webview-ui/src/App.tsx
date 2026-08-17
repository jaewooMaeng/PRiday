import React, { useCallback, useEffect, useRef, useState } from "react";
import { CallGraphView } from "./components/CallGraphView";
import { ChatPanel } from "./components/ChatPanel";
import { FileViewer } from "./components/FileViewer";
import { LLMSettingsPanel } from "./components/LLMSettingsPanel";
import { PRSummaryBanner } from "./components/PRSummaryBanner";
import { ProgressOverlay } from "./components/ProgressOverlay";
import { useMapping } from "./hooks/useMapping";
import { useVSCodeAPI } from "./hooks/useVSCodeAPI";
import { selectedModelName } from "./utils/llmDisplay";
import type {
  AnalysisResultPayload,
  ChatMessage,
  LLMConfigPayload,
  LLMProvider,
  LineRange,
  UILanguage,
} from "./types/messages";
import "./styles/global.css";

const DEFAULT_LLM_CONFIG: LLMConfigPayload = {
  provider: "gemini",
  geminiModel: "gemini-2.5-flash",
  claudeModel: "claude-sonnet-4-20250514",
  chatgptModel: "gpt-5.5",
  ollamaEndpoint: "http://localhost:11434",
  ollamaModel: "llama3",
  language: "ko",
  additionalSystemPrompt: "",
};

export function App(): React.JSX.Element {
  const [analysis, setAnalysis] = useState<AnalysisResultPayload | null>(null);
  const [llmConfig, setLlmConfig] = useState<LLMConfigPayload>(DEFAULT_LLM_CONFIG);
  const [connectionOk, setConnectionOk] = useState(false);
  const [language, setLanguage] = useState<UILanguage>("ko");
  const [progress, setProgress] = useState(-1);
  const [stage, setStage] = useState("대기 중");
  const [error, setError] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [chatVisible, setChatVisible] = useState(true);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [chatHeight, setChatHeight] = useState(300);
  const [chatResizing, setChatResizing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileHighlight, setFileHighlight] = useState<LineRange | null>(null);
  const chatResizeStart = useRef({ pointerY: 0, height: 300 });

  const mappingTable = analysis?.mappingTable ?? [];
  const { highlighted, setHighlighted, findBest } = useMapping(mappingTable);

  const onMessage = useCallback(
    (event: { type: string; payload?: unknown }) => {
      switch (event.type) {
        case "llmConfig": {
          const payload = event.payload as Partial<LLMConfigPayload> & {
            provider?: LLMProvider;
            language?: UILanguage;
          };
          setLlmConfig((prev) => ({ ...prev, ...payload }));
          if (payload.language) setLanguage(payload.language);
          setConnectionOk(true);
          break;
        }
        case "analysisResult": {
          const result = event.payload as AnalysisResultPayload;
          setAnalysis(result);
          setError(null);
          setProgress(100);
          if (result.files?.length > 0) {
            setSelectedFile(result.files[0].filename);
          }
          break;
        }
        case "analysisProgress": {
          const payload = event.payload as { stage: string; progress: number };
          setStage(payload.stage);
          setProgress(payload.progress);
          if (payload.progress > 0) setError(null);
          break;
        }
        case "analysisError":
          setError((event.payload as { message: string }).message);
          setConnectionOk(false);
          break;
        case "highlightSummary": {
          const payload = event.payload as {
            summaryBlockId: string;
            sentenceIndex: number;
          };
          setHighlighted({
            blockId: payload.summaryBlockId,
            sentenceIndex: payload.sentenceIndex,
          });
          setActiveBlockId(payload.summaryBlockId);
          const el = document.getElementById(`block-${payload.summaryBlockId}`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          break;
        }
        case "chatResponse": {
          const payload = event.payload as { message: string; modelLabel?: string };
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: payload.message,
              timestamp: Date.now(),
              modelLabel: payload.modelLabel,
            },
          ]);
          setChatLoading(false);
          break;
        }
        case "commentResult": {
          const payload = event.payload as { success: boolean; error?: string };
          if (!payload.success && payload.error) {
            setError(`Comment failed: ${payload.error}`);
          }
          break;
        }
      }
    },
    [setHighlighted]
  );

  const { postMessage } = useVSCodeAPI(onMessage);

  useEffect(() => {
    if (!highlighted) return;
    const timer = window.setTimeout(() => setHighlighted(null), 4000);
    return () => window.clearTimeout(timer);
  }, [highlighted, setHighlighted]);

  function handleSentenceDrag(args: { blockId: string; sentenceIndex: number }): void {
    const entry = findBest(args.blockId, args.sentenceIndex);
    if (!entry) return;
    setActiveBlockId(args.blockId);
    setHighlighted({ blockId: args.blockId, sentenceIndex: args.sentenceIndex });
    setSelectedFile(entry.filename);
    setFileHighlight({ start: entry.codeLineStart, end: entry.codeLineEnd });
    postMessage({
      type: "highlightCode",
      payload: {
        filename: entry.filename,
        lineStart: entry.codeLineStart,
        lineEnd: entry.codeLineEnd,
        confidence: entry.confidence,
      },
    });
  }

  function handleBlockClick(filename: string, lineRange: LineRange): void {
    setSelectedFile(filename);
    setFileHighlight(lineRange);
  }

  function handleRequestComment(args: {
    text: string;
    filename: string;
    line: number;
  }): void {
    postMessage({
      type: "postComment",
      payload: {
        body: `AI PR Insight comment:\n> ${args.text}`,
        filename: args.filename,
        line: args.line,
      },
    });
  }

  function handleChatSend(message: string): void {
    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: message, timestamp: Date.now() },
    ]);
    setChatLoading(true);
    postMessage({ type: "chat", payload: { message } });
  }

  function handleSettingsSave(
    config: LLMConfigPayload,
    secrets: { llmApiKey?: string; githubToken?: string }
  ): void {
    setLlmConfig(config);
    setLanguage(config.language ?? "ko");
    postMessage({ type: "updateLLMConfig", payload: config });
    if (secrets.llmApiKey || secrets.githubToken) {
      postMessage({
        type: "updateSecrets",
        payload: {
          provider: config.provider,
          llmApiKey: secrets.llmApiKey,
          githubToken: secrets.githubToken,
        },
      });
    }
  }

  function handleReanalyze(
    config: LLMConfigPayload,
    secrets: { llmApiKey?: string; githubToken?: string }
  ): void {
    setLlmConfig(config);
    setLanguage(config.language ?? "ko");
    setError(null);
    setStage("preparing_reanalysis");
    setProgress(1);
    postMessage({
      type: "reanalyze",
      payload: { config, secrets },
    });
  }

  function dismissOverlay(): void {
    setError(null);
    if (progress < 100) setProgress(100);
  }

  function handleChatResizeStart(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    chatResizeStart.current = { pointerY: event.clientY, height: chatHeight };
    setChatResizing(true);
  }

  function maxChatHeight(): number {
    return Math.max(220, Math.floor(window.innerHeight * 0.75));
  }

  function clampChatHeight(height: number): number {
    return Math.min(maxChatHeight(), Math.max(180, height));
  }

  function handleChatResizeMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const delta = chatResizeStart.current.pointerY - event.clientY;
    setChatHeight(clampChatHeight(chatResizeStart.current.height + delta));
  }

  function handleChatResizeEnd(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setChatResizing(false);
  }

  const showOverlay = (progress >= 0 && progress < 100) || !!error;
  const modelLabel = selectedModelName(llmConfig);

  return (
    <div className="app-root">
      {/* Title bar */}
      <header className="mock-titlebar">
        <div className="mock-tab">
          <span className="mock-tab-icon">≡</span>
          AI PR Insight{analysis?.prMeta?.prNumber != null ? `: PR #${analysis.prMeta.prNumber}` : ""}
        </div>
        <div className="titlebar-actions">
          <div className="llm-status-badge" title="LLM connection status">
            <div className={`llm-dot ${error ? "llm-dot-off" : ""}`} />
          </div>
          <button
            className="icon-btn top-icon-btn"
            onClick={() => setSettingsOpen(true)}
            title="AI PR Insight 설정"
            aria-label="AI PR Insight 설정"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6.7 1.7h2.6l.4 1.6 1.4.6 1.5-.8 1.3 2.2-1.2 1.1.1 1.6 1.3 1-1.3 2.2-1.6-.5-1.3.8-.4 1.6H6.7l-.4-1.6-1.3-.8-1.6.5-1.3-2.2 1.3-1 .1-1.6-1.2-1.1 1.3-2.2 1.5.8 1.4-.6.4-1.6z" />
              <circle cx="8" cy="8" r="2.2" />
            </svg>
          </button>
          <button
            className={`icon-btn top-icon-btn ${chatVisible ? "top-btn-active" : ""}`}
            onClick={() => {
              setChatVisible((prev) => !prev);
              if (!chatVisible) setChatExpanded(false);
            }}
            title="Chat 패널 토글"
            aria-label="Chat 패널 토글"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5.5A1.5 1.5 0 0 1 13 12H7l-3.5 2v-2H3a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 3 3.5z" />
              <path d="M4.5 6.2h7M4.5 8.7h5" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main split */}
      <div className="split-container">
        {/* Left: Analysis */}
        <div className="panel-left">
          <div
            className="panel-scroll"
            onClick={() => {
              postMessage({ type: "clearHighlight" });
            }}
          >
            {/* Analysis content */}
            {analysis ? (
              <>
                <PRSummaryBanner
                  text={analysis.prSummary}
                  prMeta={analysis.prMeta}
                  files={analysis.files}
                />
                <CallGraphView
                  callGraph={analysis.callGraph}
                  files={analysis.files}
                  blocks={analysis.summaryBlocks}
                  activeBlockId={activeBlockId}
                  highlightedSentence={highlighted}
                  onSentenceDrag={handleSentenceDrag}
                  onBlockClick={handleBlockClick}
                />
              </>
            ) : (
              <section className="card empty-state">
                <div className="empty-icon">◈</div>
                <p className="muted">
                  {progress < 0
                    ? "분석을 시작하려면 Command Palette에서\n'AI PR Insight: Analyze Pull Request'를 실행하세요."
                    : "분석 중입니다..."}
                </p>
              </section>
            )}
          </div>
        </div>

        {/* Right: File Viewer */}
        <div className="panel-right">
          <FileViewer
            files={analysis?.files ?? []}
            selectedFile={selectedFile}
            onSelectFile={(f) => {
              setSelectedFile(f);
              setFileHighlight(null);
            }}
            highlightRange={fileHighlight}
            onRequestComment={handleRequestComment}
          />
        </div>
      </div>

      {/* Chat (bottom, always-on bar or expandable) */}
      {chatVisible && (
        <div
          className={`chat-drawer ${chatExpanded ? "chat-drawer-expanded" : "chat-drawer-collapsed"} ${chatResizing ? "chat-drawer-resizing" : ""}`}
          style={chatExpanded ? { height: chatHeight } : undefined}
        >
          {chatExpanded && (
            <div
              className="chat-resize-handle"
              role="separator"
              aria-label="채팅창 높이 조절"
              aria-orientation="horizontal"
              aria-valuemin={180}
              aria-valuemax={maxChatHeight()}
              aria-valuenow={chatHeight}
              tabIndex={0}
              title="드래그하여 채팅창 높이 조절"
              onPointerDown={handleChatResizeStart}
              onPointerMove={handleChatResizeMove}
              onPointerUp={handleChatResizeEnd}
              onPointerCancel={handleChatResizeEnd}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  setChatHeight((height) => clampChatHeight(
                    height + (event.key === "ArrowUp" ? 24 : -24)
                  ));
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setChatHeight(180);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setChatHeight(maxChatHeight());
                }
              }}
              onDoubleClick={() => setChatHeight(300)}
            />
          )}
          <ChatPanel
            messages={chatMessages}
            onSend={handleChatSend}
            loading={chatLoading}
            expanded={chatExpanded}
            modelLabel={modelLabel}
            onToggleExpand={() => setChatExpanded((prev) => !prev)}
          />
        </div>
      )}

      <ProgressOverlay
        visible={showOverlay && !error}
        stage={stage}
        progress={progress}
        error={error}
        onDismiss={dismissOverlay}
      />

      {settingsOpen && (
        <LLMSettingsPanel
          config={{ ...llmConfig, language }}
          connected={connectionOk && !error}
          canReanalyze={analysis != null}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSettingsSave}
          onReanalyze={handleReanalyze}
          onTestConnection={(config) => postMessage({ type: "testConnection", payload: config })}
        />
      )}
    </div>
  );
}
