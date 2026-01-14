"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";
// pdf.js worker (kept for completeness; not used in HTML preview flow)
// eslint-disable-next-line import/no-unresolved
import { GlobalWorkerOptions } from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type AttachedFile = {
  name: string;
  type: string;
  size: number;
  text?: string;
  truncated?: boolean;
  error?: string;
  isText: boolean;
};

type OutputFile = {
  id: string;
  filename: string;
  mime: string;
  createdAt: number;
  bytesBase64: string;
  htmlPreview?: string;
};

const MAX_TEXT_CHARS = 200 * 1024; // ~200KB cap for in-memory text
const TEXT_EXTS = ["txt", "md", "json", "csv", "js", "ts", "py"];
const MAX_TOTAL_TEXT_CHARS = 400 * 1024; // overall cap we send to backend
const DEFAULT_TEMP = 0.5;

export default function Page() {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [pdfRenderError, setPdfRenderError] = useState<string | null>(null);
  const [chat, setChat] = useState<{ role: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(DEFAULT_TEMP);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

  useEffect(() => {
    const storedModel = localStorage.getItem("selectedModel");
    const storedPrompt = localStorage.getItem("systemPrompt");
    const storedTemp = localStorage.getItem("temperature");
    if (storedModel) setSelectedModel(storedModel);
    if (storedPrompt) setSystemPrompt(storedPrompt);
    if (storedTemp) {
      const num = parseFloat(storedTemp);
      if (!Number.isNaN(num)) {
        setTemperature(num);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      setModelsLoading(true);
      setModelsError(false);

      try {
        const res = await fetch("/api/models");
        if (!res.ok) {
          throw new Error(await res.text());
        }

        const data = await res.json();
        const names = Array.isArray(data?.models) ? data.models : [];

        if (cancelled) return;
        setModels(names);
        if (names.length) {
          setSelectedModel((prev) => prev || names[0]);
        }
      } catch (e) {
        if (cancelled) return;
        setModelsError(true);
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    }

    fetchModels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem("selectedModel", selectedModel);
    }
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem("systemPrompt", systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    localStorage.setItem("temperature", String(temperature));
  }, [temperature]);

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
  }

  function buildFilesPayload(limitTotalChars = MAX_TOTAL_TEXT_CHARS) {
    let used = 0;
    return files.map((f) => {
      let text = f.text ?? null;
      let truncated = !!f.truncated;

      if (f.isText && typeof text === "string" && limitTotalChars > 0) {
        if (used + text.length > limitTotalChars) {
          const remaining = Math.max(limitTotalChars - used, 0);
          if (remaining <= 0) {
            text = "[Content skipped due to total size limit]";
          } else {
            text = text.slice(0, remaining) + "\n\n[Truncated to respect total size limit]";
          }
          truncated = true;
          used = limitTotalChars;
        } else {
          used += text.length;
        }
      }

      return {
        name: f.name,
        type: f.type,
        size: f.size,
        text,
        truncated,
        isText: f.isText,
        error: f.error ?? null,
      };
    });
  }

  function base64ToUint8(base64: string) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function makeBlobUrl(base64: string, mime: string) {
    const bytes = base64ToUint8(base64);
    const blob = new Blob([bytes], { type: mime || "application/pdf" });
    return URL.createObjectURL(blob);
  }

  function isTextFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext) return false;
    return TEXT_EXTS.includes(ext);
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);

    const processed = await Promise.all(
      incoming.map(async (file) => {
        const base: AttachedFile = {
          name: file.name,
          type: file.type || "unknown",
          size: file.size,
          isText: false,
        };

        if (!isTextFile(file)) {
          return { ...base, text: undefined, truncated: false };
        }

        try {
          let text = await file.text();
          let truncated = false;
          if (text.length > MAX_TEXT_CHARS) {
            text = text.slice(0, MAX_TEXT_CHARS) + `\n\n[Truncated after ${MAX_TEXT_CHARS} characters]`;
            truncated = true;
          }
          return { ...base, isText: true, text, truncated };
        } catch (e: any) {
          return { ...base, error: "Failed to read file", isText: false };
        }
      })
    );

    setFiles((prev) => [...prev, ...processed]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function clearFiles() {
    setFiles([]);
  }

  function upsertOutput(output: OutputFile) {
    setOutputs((prev) => {
      const existingIndex = prev.findIndex((o) => o.filename === output.filename);
      if (existingIndex >= 0) {
        const copy = [...prev];
        copy[existingIndex] = output;
        return copy;
      }
      return [...prev, output];
    });
  }

  async function generateDocs() {
    if (generating || files.length === 0) return;
    setGenerating(true);
    setGenerateError(null);

    try {
      const res = await fetch("/api/generate-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel || undefined,
          systemPrompt,
          temperature,
          files: buildFilesPayload(),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const outputsFromApi: any[] = Array.isArray(data?.outputs) ? data.outputs : [];

      if (!outputsFromApi.length) {
        throw new Error("Invalid generate response");
      }

      setSelectedOutputId(null); // user chooses what to preview

      outputsFromApi.forEach((o) => {
        const created = Date.parse(o.createdAt || "") || Date.now();
        const output: OutputFile = {
          id: `${o.filename || "output"}-${created}`,
          filename: o.filename || "output.pdf",
          bytesBase64: o.bytesBase64 || "",
          mime: o.mime || "application/pdf",
          createdAt: created,
          htmlPreview: o.htmlPreview || "",
        };
        upsertOutput(output);
      });
    } catch (e: any) {
      setGenerateError(e?.message ?? "Failed to generate documentation");
    } finally {
      setGenerating(false);
    }
  }

  function getSelectedOutput() {
    if (!selectedOutputId) return null;
    return outputs.find((o) => o.id === selectedOutputId) || null;
  }

  function downloadOutput(output: OutputFile) {
    if (!output.bytesBase64) return;
    const url = makeBlobUrl(output.bytesBase64, output.mime);
    const link = document.createElement("a");
    link.href = url;
    link.download = output.filename || "output.pdf";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    const out = getSelectedOutput();
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
    setPdfRenderError(null);
    if (!out || !out.bytesBase64) return;
    const blobUrl = makeBlobUrl(out.bytesBase64, out.mime);
    previewBlobUrlRef.current = blobUrl;

    return () => {
      if (previewBlobUrlRef.current) {
        URL.revokeObjectURL(previewBlobUrlRef.current);
        previewBlobUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOutputId, outputs]);

  async function send() {
    const text = message.trim();
    if (!text || loading) return;

    setChat((c) => [
      ...c,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    setMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          model: selectedModel || undefined,
          systemPrompt,
          temperature,
          files: buildFilesPayload(),
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by \n\n
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event
            .split("\n")
            .find((l) => l.startsWith("data: "));

          if (!line) continue;

          const payloadStr = line.slice("data: ".length);

          let payload: any;
          try {
            payload = JSON.parse(payloadStr);
          } catch {
            continue;
          }

          if (payload.error) {
            throw new Error(payload.error);
          }

          if (payload.delta) {
            const delta = String(payload.delta);

            // append delta to the last assistant message
            setChat((c) => {
              const copy = [...c];
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].role === "assistant") {
                  copy[i] = { ...copy[i], content: copy[i].content + delta };
                  break;
                }
              }
              return copy;
            });
          }

          if (payload.done) {
            // end of response
            setLoading(false);
          }
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";

      // replace last assistant message with the error
      setChat((c) => {
        const copy = [...c];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === "assistant") {
            copy[i] = { ...copy[i], content: `Error: ${msg}` };
            break;
          }
        }
        return copy;
      });

      setLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 1400,
        margin: "30px auto",
        fontFamily: "system-ui",
        padding: "0 16px 24px",
        background: "#f7f7fb",
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Documentation Generator (Prototype)</h1>
      

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.2fr 1fr 1.3fr",
          gap: 12,
        }}
      >
        <section style={panelStyle}>
          <div style={panelHeaderStyle}>Input Files</div>
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
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Upload or drop files</div>
                <div style={{ fontSize: 13, color: "#555" }}>
                  Common docs (txt, md, json). {isDragging ? "Drop files here" : "Click to choose or drag & drop."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "1px solid #d0d0d7",
                  background: "#fff",
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
                <div style={{ fontWeight: 600 }}>Selected files</div>
                <button
                  onClick={clearFiles}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#1f7aec",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Clear all
                </button>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}-${file.size}`}
                    style={{
                      border: "1px solid #e0e0e5",
                      borderRadius: 10,
                      padding: 10,
                      background: "#fafbff",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontWeight: 600 }}>{file.name}</div>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        {file.type || "unknown"} • {formatSize(file.size)}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                        {file.error ? (
                          <span style={{ color: "#a00" }}>{file.error}</span>
                        ) : file.isText ? (
                          <>
                            <span style={{ color: "#0a6" }}>Text loaded</span>
                            {file.truncated && <span style={{ color: "#a60" }}>(truncated)</span>}
                          </>
                        ) : (
                          <span style={{ color: "#555" }}>Metadata only (preview not supported)</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      aria-label={`Remove ${file.name}`}
                      style={{
                        border: "none",
                        background: "#fff",
                        color: "#a00",
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
              <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
                {files.length} file{files.length !== 1 ? "s" : ""} •{" "}
                {formatSize(files.reduce((sum, f) => sum + f.size, 0))}
              </div>
            </div>
          ) : (
            <div style={{ ...placeholderBox, marginTop: 12 }}>No files selected yet.</div>
          )}
        </section>

        <section style={panelStyle}>
          <div style={panelHeaderStyle}>Chat</div>

          <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <button
                type="button"
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((v) => !v)}
                style={{
                  border: "1px solid #ddd",
                  background: "#fff",
                  padding: "8px 10px",
                  borderRadius: 10,
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontWeight: 600,
                }}
              >
                Advanced options
                <span style={{ fontSize: 12, color: "#555" }}>
                  {showAdvanced
                    ? "▲"
                    : `Model: ${selectedModel || "default"} • Temp: ${temperature.toFixed(1)}`}
                </span>
              </button>
              {showAdvanced && (
                <div style={{ display: "grid", gap: 10, paddingTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <label htmlFor="model-select" style={{ fontWeight: 600 }}>Model</label>
                    <select
                      id="model-select"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      disabled={modelsLoading || (!models.length && !selectedModel)}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", minWidth: 180, background: "#fff" }}
                    >
                      {modelsLoading && <option>Loading models...</option>}
                      {!modelsLoading && models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {!modelsLoading && models.length === 0 && (
                        <option value={selectedModel || ""}>{selectedModel || "Default (env)"}</option>
                      )}
                    </select>
                    {modelsError && (
                      <span style={{ fontSize: 12, color: "#a00" }}>
                        Model list unavailable. Using default.
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label htmlFor="system-prompt" style={{ fontWeight: 600 }}>System prompt</label>
                    <textarea
                      id="system-prompt"
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={2}
                      placeholder="Add system guidance (optional)"
                      style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", resize: "vertical", lineHeight: 1.4, background: "#fff" }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label htmlFor="temperature" style={{ fontWeight: 600 }}>
                        {Number(temperature.toFixed(1)) === DEFAULT_TEMP
                          ? `Temperature: ${temperature.toFixed(1)} (default)`
                          : `Temperature: ${temperature.toFixed(1)}`}
                      </label>
                      {Number(temperature.toFixed(1)) !== DEFAULT_TEMP && (
                        <button
                          type="button"
                          onClick={() => setTemperature(DEFAULT_TEMP)}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "#1f7aec",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <input
                      id="temperature"
                      type="range"
                      min={0}
                      max={1.2}
                      step={0.1}
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    />
                    <div style={{ fontSize: 12, color: "#555" }}>Lower = precise, higher = creative.</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ border: "1px solid #e0e0e5", borderRadius: 12, padding: 12, minHeight: 260, maxHeight: 360, overflowY: "auto", background: "#fff" }}>
            {chat.map((m, i) => (
              <div key={i} style={{ margin: "12px 0" }}>
                <b>{m.role}:</b>
                <div style={{ marginTop: 6 }}>
                  {m.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    m.content
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
                  e.preventDefault(); // stop newline
                  send();
                }
                // Shift+Enter will naturally insert a newline
              }}
              placeholder="Type a message"
              rows={2}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #ddd",
                resize: "vertical",
                lineHeight: 1.4,
                background: "#fff",
              }}
            />

            <button
              onClick={send}
              disabled={loading}
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "not-allowed" : "pointer",
                background: "#1f7aec",
                color: "#fff",
                border: "none",
              }}
            >
              {loading ? "Sending..." : "Send"}
            </button>

          </div>
        </section>

        <section style={panelStyle}>
          <div style={panelHeaderStyle}>Output Files</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <button
              onClick={generateDocs}
              disabled={files.length === 0 || generating}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #1f7aec",
                background: generating ? "#9dc2f7" : "#1f7aec",
                color: "#fff",
                cursor: files.length === 0 || generating ? "not-allowed" : "pointer",
                opacity: files.length === 0 || generating ? 0.7 : 1,
              }}
            >
              {generating ? "Generating..." : "Generate docs"}
            </button>
            <div style={{ fontSize: 12, color: "#555" }}>
              Uses attached files with current model/system prompt/temperature.
            </div>
          </div>
          {generateError && (
            <div style={{ color: "#a00", fontSize: 12, marginBottom: 8 }}>
              {generateError}
            </div>
          )}

          {outputs.length === 0 ? (
            <div style={placeholderBox}>No generated outputs yet.</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {outputs.map((out) => (
                <li
                  key={out.id}
                  onClick={() => setSelectedOutputId(out.id)}
                  style={{
                    border: out.id === selectedOutputId ? "1px solid #1f7aec" : "1px solid #e0e0e5",
                    background: out.id === selectedOutputId ? "#f0f6ff" : "#fafbff",
                    borderRadius: 10,
                    padding: 10,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{out.filename}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>
                      {new Date(out.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadOutput(out);
                    }}
                    style={{
                      border: "1px solid #d0d0d7",
                      background: "#fff",
                      padding: "6px 10px",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={panelStyle}>
          <div style={panelHeaderStyle}>File Preview</div>
          {(() => {
            const out = getSelectedOutput();
            if (!out) {
              return <div style={placeholderBox}>Select an output file to preview its contents.</div>;
            }
            return (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{out.filename}</div>
                <div style={{ fontSize: 12, color: "#555" }}>
                  Generated at {new Date(out.createdAt).toLocaleString()}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => downloadOutput(out)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid #d0d0d7",
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Download
                  </button>
                  <button
                    onClick={() => {
                      if (previewBlobUrlRef.current) {
                        window.open(previewBlobUrlRef.current, "_blank");
                      }
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid #d0d0d7",
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Open PDF in new tab
                  </button>
                </div>
                {pdfRenderError && (
                  <div style={{ color: "#a00", fontSize: 12 }}>
                    {pdfRenderError}. You can still open the PDF in a new tab.
                  </div>
                )}
                <div
                  style={{
                    border: "1px solid #e0e0e5",
                    borderRadius: 10,
                    padding: 10,
                    background: "#fafbff",
                    maxHeight: 500,
                    overflowY: "auto",
                  }}
                  dangerouslySetInnerHTML={{ __html: out.htmlPreview || "<p>Preview unavailable.</p>" }}
                />
              </div>
            );
          })()}
        </section>
      </div>
    </main>
  );
}

const panelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e0e0e5",
  borderRadius: 12,
  padding: 14,
  minHeight: 420,
  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
};

const panelHeaderStyle: React.CSSProperties = {
  fontWeight: 700,
  marginBottom: 10,
  color: "#222",
};

const placeholderBox: React.CSSProperties = {
  border: "1px dashed #d0d0d7",
  borderRadius: 10,
  padding: 12,
  background: "#fafbff",
  color: "#6b6b75",
  fontSize: 14,
};
