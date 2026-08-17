import React, { useRef, useEffect, useState } from "react";
import type { ChatMessage } from "../types/messages";

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  loading: boolean;
  expanded: boolean;
  modelLabel: string;
  onToggleExpand: () => void;
}

export function ChatPanel({
  messages,
  onSend,
  loading,
  expanded,
  modelLabel,
  onToggleExpand,
}: Props): React.JSX.Element {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (expanded) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, expanded]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    onSend(input.trim());
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleInputFocus() {
    if (!expanded) onToggleExpand();
  }

  return (
    <section className={`chat-panel ${expanded ? "chat-panel-expanded" : "chat-panel-collapsed"}`}>
      <button type="button" className="chat-header-bar" onClick={onToggleExpand}>
        <span className="chat-header-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M3.5 3.5h9A1.5 1.5 0 0 1 14 5v5.2a1.5 1.5 0 0 1-1.5 1.5H8l-3.7 2v-2H3.5A1.5 1.5 0 0 1 2 10.2V5a1.5 1.5 0 0 1 1.5-1.5Z" />
            <path d="M5 6.5h6M5 8.8h4" />
          </svg>
        </span>
        <span className="chat-header-label">{modelLabel}</span>
        {messages.length > 0 && (
          <span className="chat-msg-count">{messages.length}</span>
        )}
        <span style={{ flex: 1 }} />
        <span className="chat-expand-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d={expanded ? "M4.5 6.5 8 10l3.5-3.5" : "M4.5 9.5 8 6l3.5 3.5"} />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="chat-messages">
          {messages.length === 0 && (
            <p className="muted chat-empty">
              변경 의도, 위험 지점, 테스트 범위를 바로 물어볼 수 있습니다.
            </p>
          )}
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`chat-bubble ${msg.role === "user" ? "chat-user" : "chat-assistant"}`}
            >
              <div className="chat-role">
                {msg.role === "user" ? "You" : (msg.modelLabel ?? modelLabel)}
              </div>
              <div className="chat-content">{msg.content}</div>
            </div>
          ))}
          {loading && (
            <div className="chat-bubble chat-assistant">
              <div className="chat-role">{modelLabel}</div>
              <div className="chat-content chat-loading">
                <span className="dot-pulse" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="이 PR에 대해 질문하기"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          rows={1}
          disabled={loading}
        />
        <button
          className="chat-send"
          type="submit"
          disabled={!input.trim() || loading}
          aria-label="질문 보내기"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h9M8.5 4 12.5 8l-4 4" />
          </svg>
        </button>
      </form>
    </section>
  );
}
