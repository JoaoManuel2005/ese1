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
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 12, color: "#666" }}>
        {displayType === "docs" || displayType === "generic_docs"
          ? "Chat answers from your uploaded documents (general mode)."
          : displayType === "solution_zip" || displayType === "power_platform_solution_zip"
          ? "Chat answers from solution components (Power Platform mode)."
          : "Chat answers from the knowledge base once files are ingested."}
      </div>

      <div className="panel-scroll" style={{ border: "1px solid #e0e0e5", borderRadius: 12, padding: 12, background: "#fff" }}>
        {chat.map((m) => (
          <div key={m.id} style={{ margin: "12px 0" }}>
            <b>{m.role}:</b>
            <div style={{ marginTop: 6 }}>
              {m.role === "assistant" ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div className="chat-message">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                  {m.sources && m.sources.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => onToggleSources(m.id)}
                        style={{ border: "1px solid #d0d0d7", background: "#fff", padding: "4px 8px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}
                      >
                        {expandedSources[m.id] ? "Hide sources" : `Sources (${m.sources.length})`}
                      </button>
                      {expandedSources[m.id] && (
                        <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: "#444" }}>
                          {m.sources!.map((source, idx) => (
                            <li key={`${m.id}-source-${idx}`}>{source.label}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="chat-message">{m.content}</div>
              )}
            </div>
          </div>
        ))}

        {loading && <div><b>assistant:</b> ...</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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
          style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid #ddd", resize: "vertical", lineHeight: 1.4, background: "#fff" }}
        />

        <button onClick={() => void send()} disabled={loading} style={{ padding: "12px 16px", borderRadius: 10, opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer", background: "#1f7aec", color: "#fff", border: "none" }}>{loading ? "Sending..." : "Send"}</button>
        <button onClick={onClear} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", background: "#fff" }}>Clear</button>
      </div>
    </div>
  );
};

export default ChatWindow;
