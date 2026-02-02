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
  if (!outputs.length) return <div style={{ border: "1px dashed #d0d0d7", borderRadius: 10, padding: 12, background: "#fafbff", color: "#6b6b75", fontSize: 14 }}>No generated outputs yet.</div>;

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
      {outputs.map((out) => (
        <li key={out.id} onClick={() => onSelect(out.id)} style={{ border: out.id === selectedOutputId ? "1px solid #1f7aec" : "1px solid #e0e0e5", background: out.id === selectedOutputId ? "#f0f6ff" : "#fafbff", borderRadius: 10, padding: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{out.filename}</div>
            <div style={{ fontSize: 12, color: "#555" }}>{new Date(out.createdAt).toLocaleTimeString()}</div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onDownload(out); }} style={{ border: "1px solid #d0d0d7", background: "#fff", padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}>Download</button>
        </li>
      ))}
    </ul>
  );
};

export default OutputsList;
