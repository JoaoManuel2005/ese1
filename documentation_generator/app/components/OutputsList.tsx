"use client";

import React from "react";
import type { FC } from "react";
import type { OutputFile } from "../types";

type Props = {
  outputs: OutputFile[];
  selectedOutputId: string | null;
  onSelect: (id: string) => void;
  onDownload: (o: OutputFile) => void;
};

const OutputsList: FC<Props> = ({ outputs, selectedOutputId, onSelect, onDownload }) => {
  if (!outputs.length) return <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 12, background: "var(--panel-bg)", color: "var(--muted)", fontSize: 14 }}>No generated outputs yet.</div>;

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
      {outputs.map((out) => (
        <li key={out.id} onClick={() => onSelect(out.id)} style={{ border: out.id === selectedOutputId ? "1px solid var(--primary)" : "1px solid var(--border)", background: out.id === selectedOutputId ? "#f0f6ff" : "var(--panel-bg)", borderRadius: 10, padding: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{out.filename}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(out.createdAt).toLocaleTimeString()}</div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onDownload(out); }} style={{ border: "1px solid var(--border)", background: "var(--input-bg)", padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}>Download</button>
        </li>
      ))}
    </ul>
  );
};

export default OutputsList;
