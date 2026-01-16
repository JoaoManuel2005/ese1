"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
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
  file?: File; // Keep original File for .zip uploads
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
const SOLUTION_EXT = "zip"; // Power Platform solution files
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [ragStatus, setRagStatus] = useState<{ status: string; chunks_indexed: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);

  // Fetch RAG status on mount and periodically
  useEffect(() => {
    async function fetchRagStatus() {
      try {
        const res = await fetch("/api/rag-status");
        if (res.ok) {
          const data = await res.json();
          setRagStatus(data);
        }
      } catch {
        setRagStatus(null);
      }
    }
    fetchRagStatus();
    const interval = setInterval(fetchRagStatus, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

  useEffect(() => {
    const storedModel = localStorage.getItem("selectedModel");
    if (storedModel) setSelectedModel(storedModel);
    // Clear any old API key from localStorage for security
    localStorage.removeItem("openaiApiKey");
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

  function isSolutionFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    return ext === SOLUTION_EXT;
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

        // Handle .zip solution files - keep original File reference
        if (isSolutionFile(file)) {
          return { ...base, file, text: "[Power Platform Solution - will be parsed with PAC CLI]", isText: false };
        }

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

  // Check if any file is a solution (.zip) file
  function hasSolutionFile() {
    return files.some((f) => f.name.toLowerCase().endsWith(".zip"));
  }

  // Generate docs for Power Platform solution using PAC CLI + RAG
  async function generateSolutionDocs() {
    const solutionFile = files.find((f) => f.file && f.name.toLowerCase().endsWith(".zip"));
    if (!solutionFile?.file) {
      throw new Error("No solution file found");
    }

    // Step 1: FIRST - Ingest the ZIP file into ChromaDB (parses ALL files, FREE with Sentence-BERT)
    // This happens BEFORE doc generation so RAG chat can use the full solution content
    const ingestFormData = new FormData();
    ingestFormData.append("file", solutionFile.file);
    
    const ingestRes = await fetch("/api/rag-ingest-zip", {
      method: "POST",
      body: ingestFormData,
    });
    
    if (ingestRes.ok) {
      const ingestData = await ingestRes.json();
      console.log("Solution ingested into ChromaDB:", ingestData);
    } else {
      console.warn("Failed to ingest solution into ChromaDB - continuing with doc generation");
    }

    // Step 2: Parse solution with PAC CLI (for doc generation metadata)
    const formData = new FormData();
    formData.append("file", solutionFile.file);

    const parseRes = await fetch("/api/parse-solution", {
      method: "POST",
      body: formData,
    });

    if (!parseRes.ok) {
      const errorData = await parseRes.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to parse solution with PAC CLI");
    }

    const parsedSolution = await parseRes.json();

    // Step 3: Generate documentation with RAG pipeline (API key from backend .env)
    const genRes = await fetch("/api/generate-solution-docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        solution: parsedSolution,
        doc_type: "markdown",
      }),
    });

    if (!genRes.ok) {
      const errorData = await genRes.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to generate documentation");
    }

    const docResult = await genRes.json();
    
    return { parsedSolution, documentation: docResult.documentation };
  }

  async function generateDocs() {
    if (generating || files.length === 0) return;
    setGenerating(true);
    setGenerateError(null);

    try {
      // Check if we have a solution file - use PAC CLI + RAG pipeline
      if (hasSolutionFile()) {
        const { parsedSolution, documentation } = await generateSolutionDocs();
        
        // Create output with the generated documentation
        const createdAt = new Date().toISOString();
        const filename = `${parsedSolution.solution_name || "solution"}_documentation.pdf`;
        
        // Convert markdown to HTML for preview
        const htmlContent = `
          <div style="font-family: system-ui; line-height: 1.6; padding: 20px;">
            <h1>${parsedSolution.solution_name}</h1>
            <p><strong>Version:</strong> ${parsedSolution.version} | <strong>Publisher:</strong> ${parsedSolution.publisher}</p>
            <p><strong>Components:</strong> ${parsedSolution.components?.length || 0}</p>
            <hr style="margin: 20px 0;" />
            <div style="white-space: pre-wrap;">${documentation.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</div>
          </div>
        `;

        // Generate actual PDF using pdf-lib
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        
        const pageWidth = 612; // Letter size
        const pageHeight = 792;
        const margin = 50;
        const lineHeight = 14;
        const maxWidth = pageWidth - margin * 2;
        
        let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        let yPosition = pageHeight - margin;
        
        // Helper function to add text with word wrapping
        const addText = (text: string, fontSize: number, isBold: boolean = false, color = rgb(0, 0, 0)) => {
          const currentFont = isBold ? boldFont : font;
          const words = text.split(' ');
          let line = '';
          
          for (const word of words) {
            const testLine = line + (line ? ' ' : '') + word;
            const testWidth = currentFont.widthOfTextAtSize(testLine, fontSize);
            
            if (testWidth > maxWidth && line) {
              if (yPosition < margin + lineHeight) {
                currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
                yPosition = pageHeight - margin;
              }
              currentPage.drawText(line, { x: margin, y: yPosition, size: fontSize, font: currentFont, color });
              yPosition -= lineHeight;
              line = word;
            } else {
              line = testLine;
            }
          }
          
          if (line) {
            if (yPosition < margin + lineHeight) {
              currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
              yPosition = pageHeight - margin;
            }
            currentPage.drawText(line, { x: margin, y: yPosition, size: fontSize, font: currentFont, color });
            yPosition -= lineHeight;
          }
        };
        
        // Add title
        addText(`${parsedSolution.solution_name || 'Solution'} Documentation`, 20, true);
        yPosition -= 10;
        
        // Add metadata
        addText(`Version: ${parsedSolution.version || 'N/A'}  |  Publisher: ${parsedSolution.publisher || 'N/A'}`, 10, false, rgb(0.4, 0.4, 0.4));
        addText(`Generated: ${new Date().toLocaleString()}`, 10, false, rgb(0.4, 0.4, 0.4));
        addText(`Components: ${parsedSolution.components?.length || 0}`, 10, false, rgb(0.4, 0.4, 0.4));
        yPosition -= 15;
        
        // Add horizontal line
        currentPage.drawLine({
          start: { x: margin, y: yPosition },
          end: { x: pageWidth - margin, y: yPosition },
          thickness: 1,
          color: rgb(0.8, 0.8, 0.8),
        });
        yPosition -= 20;
        
        // Process documentation content
        const lines = documentation.split('\n');
        for (const line of lines) {
          if (line.startsWith('# ')) {
            yPosition -= 10;
            addText(line.substring(2), 16, true);
            yPosition -= 5;
          } else if (line.startsWith('## ')) {
            yPosition -= 8;
            addText(line.substring(3), 14, true);
            yPosition -= 3;
          } else if (line.startsWith('### ')) {
            yPosition -= 5;
            addText(line.substring(4), 12, true);
          } else if (line.startsWith('- ') || line.startsWith('* ')) {
            addText('• ' + line.substring(2), 10);
          } else if (line.trim() === '') {
            yPosition -= 8;
          } else {
            addText(line, 10);
          }
        }
        
        // Generate PDF bytes
        const pdfBytes = await pdfDoc.save();
        const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));

        const output: OutputFile = {
          id: `${filename}-${Date.now()}`,
          filename: filename,
          bytesBase64: pdfBase64,
          mime: "application/pdf",
          createdAt: Date.now(),
          htmlPreview: htmlContent,
        };
        upsertOutput(output);
        setSelectedOutputId(output.id);
        return;
      }

      // Regular file processing (existing flow)
      const res = await fetch("/api/generate-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel || undefined,
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
      // Always use FREE RAG mode - queries ChromaDB for context
      const ragRes = await fetch("/api/rag-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
        }),
      });

      if (!ragRes.ok) {
        const errData = await ragRes.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${ragRes.status}`);
      }

      const ragData = await ragRes.json();
      
      // Update the assistant message with RAG response
      setChat((c) => {
        const copy = [...c];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === "assistant") {
            let response = ragData.answer || "No response";
            // Add citation info if available
            if (ragData.citations?.length > 0) {
              response += "\n\n---\n**Sources:**\n";
              ragData.citations.forEach((cite: any, idx: number) => {
                response += `${idx + 1}. ${cite.metadata?.source || "Document chunk"}\n`;
              });
            }
            copy[i] = { ...copy[i], content: response };
            break;
          }
        }
        return copy;
      });
      
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
    } finally {
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Documentation Generator (Prototype)</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* RAG Status Badge */}
          <div style={{
            padding: "8px 14px",
            background: ragStatus?.status === "ready" ? "#e8f5e9" : "#fff3e0",
            border: ragStatus?.status === "ready" ? "1px solid #4caf50" : "1px solid #ff9800",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
          }}>
            {ragStatus ? (
              <>
                <span style={{ color: ragStatus.status === "ready" ? "#2e7d32" : "#e65100" }}>
                  {ragStatus.status === "ready" ? "🟢" : "🟡"} ChromaDB: {ragStatus.chunks_indexed} chunks
                </span>
              </>
            ) : (
              <span style={{ color: "#666" }}>⚪ RAG Backend Offline</span>
            )}
          </div>
        </div>
      </div>
      

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
                  Docs (txt, md, json) or <strong>.zip solution files</strong>. {isDragging ? "Drop files here" : "Click to choose or drag & drop."}
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
                        ) : file.name.toLowerCase().endsWith(".zip") ? (
                          <span style={{ color: "#1f7aec", fontWeight: 500 }}>📦 Power Platform Solution (PAC CLI + RAG)</span>
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
                  {showAdvanced ? "▲" : `Model: ${selectedModel || "default"}`}
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

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid #e0e0e0" }}>
                    <div style={{ fontWeight: 600, color: "#0a6b3d" }}>
                      API Key (Secure)
                    </div>
                    <div style={{ fontSize: 12, color: "#555" }}>
                      OpenAI API key is stored securely in backend .env file. No browser storage needed.
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid #e0e0e0" }}>
                    <div style={{ fontWeight: 600, color: "#0a6b3d" }}>
                      RAG Mode (FREE)
                    </div>
                    <div style={{ fontSize: 12, color: "#555" }}>
                      Chat uses FREE hybrid search (Sentence-BERT + BM25). No API key needed for chat!
                    </div>
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
                border: hasSolutionFile() ? "1px solid #0a6b3d" : "1px solid #1f7aec",
                background: generating ? "#9dc2f7" : hasSolutionFile() ? "#0a6b3d" : "#1f7aec",
                color: "#fff",
                cursor: files.length === 0 || generating ? "not-allowed" : "pointer",
                opacity: files.length === 0 || generating ? 0.7 : 1,
              }}
            >
              {generating 
                ? (hasSolutionFile() ? "Parsing & Generating..." : "Generating...") 
                : (hasSolutionFile() ? "Parse & Generate Docs" : "Generate docs")}
            </button>
            <div style={{ fontSize: 12, color: "#555" }}>
              {hasSolutionFile() 
                ? "Will parse solution with PAC CLI, then generate docs with RAG pipeline."
                : "Uses attached files with current model/system prompt/temperature."}
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
