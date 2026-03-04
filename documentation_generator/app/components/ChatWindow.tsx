"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FC } from "react";
import type { ChatMessage } from "../types";

type Props = {
  chat: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => Promise<void> | void;
  onClear: () => void;
  expandedSources: Record<string, boolean>;
  onToggleSources: (id: string) => void;
  bottomRef?: React.RefObject<HTMLDivElement | null>;
  displayType?: string | null;
};

const ChatWindow: FC<Props> = ({ chat, loading, onSend, onClear, expandedSources, onToggleSources, bottomRef, displayType }) => {
  const [message, setMessage] = useState("");

  async function send() {
    const txt = message.trim();
    if (!txt || loading) return;
    setMessage("");
    await onSend(txt);
  }

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 12, height: "100vh", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
        {displayType === "docs" || displayType === "generic_docs"
          ? "Chat answers from your uploaded documents (general mode)."
          : displayType === "solution_zip" || displayType === "power_platform_solution_zip"
          ? "Chat answers from solution components (Power Platform mode)."
          : "Chat answers from the knowledge base once files are ingested."}
      </div>

      <div className="panel-scroll" style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--panel-bg)", overflowY: "auto", overflowX: "hidden", minWidth: 0, minHeight: 0 }}>
        {chat.map((m) => (
          <div key={m.id} style={{ margin: "12px 0", minWidth: 0 }}>
            <b>{m.role}:</b>
            <div style={{ marginTop: 6, minWidth: 0 }}>
              {m.role === "assistant" ? (
                <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                  <div className="chat-message" style={{ minWidth: 0, overflow: "hidden" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                  {m.sources && m.sources.length > 0 && (
                    <div style={{ minWidth: 0 }}>
                      <button
                        type="button"
                        onClick={() => onToggleSources(m.id)}
                        style={{ border: "1px solid var(--border)", background: "var(--input-bg)", padding: "4px 8px", borderRadius: 8, cursor: "pointer", fontSize: 12, flexShrink: 0 }}
                      >
                        {expandedSources[m.id] ? "Hide sources" : `Sources (${m.sources.length})`}
                      </button>
                      {expandedSources[m.id] && (
                        <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: "var(--muted)", wordWrap: "break-word" }}>
                          {m.sources!.map((source, idx) => (
                            <li key={`${m.id}-source-${idx}`}>{source.label}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="chat-message" style={{ minWidth: 0, wordWrap: "break-word" }}>{m.content}</div>
              )}
            </div>
          </div>
        ))}

        {loading && <div><b>assistant:</b> ...</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", paddingLeft: 1, paddingBottom: 1, gap: 8, width: "100%", boxSizing: "border-box", flexShrink: 0 }}>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type a message"
          rows={2}
          style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid var(--border)", resize: "none", lineHeight: 1.4, background: "var(--input-bg)", width: "50%", minWidth: 0, boxSizing: "border-box"}}
        />

        <button onClick={() => void send()} disabled={loading} style={{ padding: "12px 16px", borderRadius: 10, opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer", background: "var(--primary)", color: "var(--foreground)", border: "none", flexShrink: 0, whiteSpace: "nowrap", width: "20%" }}>{loading ? "Sending..." : "Send"}</button>
        <button onClick={onClear} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", flexShrink: 0, whiteSpace: "nowrap", width: "20%" }}>Clear</button>
      </div>
    </div>
  );
};

export default ChatWindow;
