import React, { useEffect, useMemo, useState } from "react";
import type { LLMConfigPayload, LLMProvider, UILanguage } from "../types/messages";

const PROVIDER_OPTIONS: Array<{ value: LLMProvider; label: string; icon: string }> = [
  { value: "chatgpt", label: "OpenAI", icon: "AI" },
  { value: "claude", label: "Anthropic", icon: "A" },
  { value: "gemini", label: "Google Gemini", icon: "G" },
  { value: "ollama", label: "Ollama", icon: "O" },
];

const MODEL_OPTIONS: Record<LLMProvider, string[]> = {
  chatgpt: ["gpt-5.5", "gpt-4o", "gpt-4o-mini"],
  claude: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash"],
  ollama: ["llama3", "llama3.1", "mistral", "codellama"],
};

interface Props {
  config: LLMConfigPayload;
  connected: boolean;
  onClose: () => void;
  onSave: (config: LLMConfigPayload, secrets: { llmApiKey?: string; githubToken?: string }) => void;
  onTestConnection: (config: LLMConfigPayload) => void;
}

function modelFor(config: LLMConfigPayload): string {
  if (config.provider === "chatgpt") return config.chatgptModel ?? "gpt-5.5";
  if (config.provider === "claude") return config.claudeModel ?? "claude-sonnet-4-20250514";
  if (config.provider === "gemini") return config.geminiModel ?? "gemini-2.5-flash";
  return config.ollamaModel ?? "llama3";
}

function hasProviderKey(config: LLMConfigPayload): boolean {
  if (config.provider === "ollama") return true;
  if (config.provider === "chatgpt") return !!config.hasOpenAIApiKey;
  if (config.provider === "claude") return !!config.hasClaudeApiKey;
  return !!config.hasGeminiApiKey;
}

function withModel(config: LLMConfigPayload, model: string): LLMConfigPayload {
  if (config.provider === "chatgpt") return { ...config, chatgptModel: model };
  if (config.provider === "claude") return { ...config, claudeModel: model };
  if (config.provider === "gemini") return { ...config, geminiModel: model };
  return { ...config, ollamaModel: model };
}

export function LLMSettingsPanel({
  config,
  connected,
  onClose,
  onSave,
  onTestConnection,
}: Props): JSX.Element {
  const [draft, setDraft] = useState<LLMConfigPayload>(config);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setDraft(config);
    setLlmApiKey("");
    setGithubToken("");
  }, [config]);

  const currentModel = modelFor(draft);
  const modelOptions = useMemo(() => MODEL_OPTIONS[draft.provider], [draft.provider]);
  const providerKeyConfigured = hasProviderKey(draft) || llmApiKey.trim().length > 0;
  const githubConfigured = !!draft.hasGitHubToken || githubToken.trim().length > 0;

  function updateProvider(provider: LLMProvider): void {
    setDraft((prev) => ({
      ...prev,
      provider,
      language: prev.language ?? "ko",
    }));
  }

  function updateModel(model: string): void {
    setDraft((prev) => withModel(prev, model));
  }

  function save(): void {
    onSave(draft, {
      llmApiKey: llmApiKey.trim() || undefined,
      githubToken: githubToken.trim() || undefined,
    });
    onClose();
  }

  function testConnection(): void {
    setTesting(true);
    onTestConnection(draft);
    window.setTimeout(() => setTesting(false), 1200);
  }

  return (
    <div className="settings-scrim" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="settings-title">AI PR Insight 설정</h2>
            <p>AI PR 분석에 사용할 동작과 모델을 구성합니다.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} title="닫기" aria-label="닫기">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-section-title">
              <span className="settings-step">1</span>
              <span>Provider</span>
            </div>
            <div className="provider-grid">
              {PROVIDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`provider-option ${draft.provider === option.value ? "provider-option-active" : ""}`}
                  onClick={() => updateProvider(option.value)}
                >
                  <span className="provider-icon">{option.icon}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <label className="field-label" htmlFor="model-select">Model</label>
            <select
              id="model-select"
              className="input"
              value={currentModel}
              onChange={(event) => updateModel(event.target.value)}
            >
              {modelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">
              <span className="settings-step">2</span>
              <span>Authentication</span>
            </div>
            <label className="field-label" htmlFor="llm-api-key">
              LLM Provider API Key
              <span className={`connection-chip ${providerKeyConfigured ? "" : "connection-chip-off"}`}>
                {providerKeyConfigured ? "Connected" : "Not set"}
              </span>
            </label>
            <input
              id="llm-api-key"
              className="input"
              type="password"
              value={llmApiKey}
              placeholder={draft.provider === "ollama" ? "Ollama는 API key가 필요하지 않습니다" : "새 API key 입력"}
              disabled={draft.provider === "ollama"}
              onChange={(event) => setLlmApiKey(event.target.value)}
            />

            <label className="field-label" htmlFor="github-api-key">
              GitHub API Key
              <span className={`connection-chip ${githubConfigured ? "" : "connection-chip-off"}`}>
                {githubConfigured ? "Connected" : "Not set"}
              </span>
            </label>
            <input
              id="github-api-key"
              className="input"
              type="password"
              value={githubToken}
              placeholder="새 GitHub token 입력"
              onChange={(event) => setGithubToken(event.target.value)}
            />
          </section>

          <section className="settings-section settings-section-advanced">
            <div className="settings-section-title">
              <span className="settings-step">3</span>
              <span>Advanced</span>
            </div>
            <div className="settings-grid-2">
              <div>
                <label className="field-label" htmlFor="endpoint-input">Base URL / Endpoint</label>
                <input
                  id="endpoint-input"
                  className="input"
                  value={draft.ollamaEndpoint ?? "http://localhost:11434"}
                  onChange={(event) => setDraft((prev) => ({ ...prev, ollamaEndpoint: event.target.value }))}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="language-select">Output Language</label>
                <select
                  id="language-select"
                  className="input"
                  value={draft.language ?? "ko"}
                  onChange={(event) => setDraft((prev) => ({ ...prev, language: event.target.value as UILanguage }))}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
            <div className="test-row">
              <button className="btn btn-secondary" type="button" onClick={testConnection} disabled={testing}>
                {testing ? "테스트 중" : "연결 테스트"}
              </button>
              <span className={`connection-chip ${connected ? "" : "connection-chip-off"}`}>
                {connected ? "성공" : "대기"}
              </span>
            </div>
          </section>
        </div>

        <footer className="settings-footer">
          <button className="btn btn-secondary" type="button" onClick={onClose}>취소</button>
          <button className="btn btn-primary" type="button" onClick={save}>저장</button>
        </footer>
      </section>
    </div>
  );
}
