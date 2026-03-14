"use client";
import React, {useRef, useState } from "react";
import { AttachedFile } from "../types";

type Props = {
  files: AttachedFile[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  clearFiles?: () => void;
  displayType?: string | null;
  displayReason?: string | null;
};

export default function FileUploader({
  files,
  onAdd,
  onRemove,
  clearFiles,
  displayType,
  displayReason,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    onAdd(Array.from(list));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function formatSize(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  const placeholderBox: React.CSSProperties = { padding: 12, color: "var(--muted)" };

  return (
        <div>
          <div className="panel-header">Input Files</div>
          <div
            className={`dropzone${isDragging ? " dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              void addFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => void addFiles(e.target.files)}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <div style={{ color: "var(--foreground)", fontWeight: 600, marginBottom: 4 }}>Upload a .zip solution file</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Only <strong>.zip solution files</strong> are supported. {isDragging ? "Drop the .zip file here" : "Click to choose or drag & drop."}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--panel-bg)",
                  color: "var(--foreground)",
                  padding: "8px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                }}
              >
                Browse
              </button>
            </div>
          </div>

          {files.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ color: "var(--foreground)", fontWeight: 600 }}>Selected files</div>
                {clearFiles && (
                  <button
                    onClick={() => clearFiles()}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--primary)",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="panel-scroll hide-scrollbar" style={{ maxHeight: "200px", overflowY: "auto", overflowX: "hidden" }}>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8, overflowX: "hidden" }}>
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}-${file.size}`}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "var(--panel-bg)",
                        color: "var(--foreground)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflowWrap: "anywhere", wordBreak: "break-word" }}>{file.name}</div>
                        <div style={{ fontSize: 12, color: "#555" }}>
                          {file.type || "unknown"} • {formatSize(file.size)}
                        </div>
                        <div id = "input_file_box" style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                          {file.error ? (
                            <span style={{ color: "var(--danger)" }}>{file.error}</span>
                          ) : file.name.toLowerCase().endsWith(".zip") ? (
                            <span style={{ color: "var(--primary)", fontWeight: 500 }}>📦 Power Platform Solution (PAC CLI + RAG)</span>
                          ) : file.isText ? (
                            <>
                              <span style={{ color: "var(--warning)" }}>Only .zip solution files are supported</span>
                              {file.truncated && <span style={{ color: "var(--warning)" }}>(truncated)</span>}
                            </>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>Only .zip solution files are supported</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onRemove(index)}
                        aria-label={`Remove ${file.name}`}
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--panel-bg)",
                          color: "var(--danger)",
                          borderRadius: 8,
                          padding: "6px 10px",
                          cursor: "pointer",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                  {files.length} file{files.length !== 1 ? "s" : ""} •{" "}
                  {formatSize(files.reduce((sum, f) => sum + f.size, 0))}
                </div>
                {displayType && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                    <span style={{ padding: "2px 6px", borderRadius: 6, background: "var(--panel-bg)", border: "1px solid var(--border)", color: "var(--primary)" }}>
                      {displayType === "solution_zip" || displayType === "power_platform_solution_zip"
                        ? "Detected: Power Platform solution"
                        : displayType === "docs" || displayType === "generic_docs"
                        ? "Detected: Unsupported file type"
                        : "Detected: Unknown"}
                    </span>
                    {displayReason && (
                      <span style={{ marginLeft: 6, color: "var(--muted)" }}>{displayReason}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ ...placeholderBox, marginTop: 12 }}>No .zip solution file selected yet.</div>
          )}
        </div>
  );
}
