"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { classifyUploads, UploadClassification } from "../lib/classifyUploads";
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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: { label: string; path: string }[];
};

type GenerateError = {
  message: string;
  code?: string;
  hint?: string;
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
  const [generateError, setGenerateError] = useState<GenerateError | null>(null);
  const [pdfRenderError, setPdfRenderError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [provider, setProvider] = useState<"cloud" | "local">("cloud");
  const [localModel, setLocalModel] = useState("llama3.1:8b");
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [localModelsError, setLocalModelsError] = useState<string | null>(null);
  const [useCustomLocalModel, setUseCustomLocalModel] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [ragStatus, setRagStatus] = useState<{ status: string; chunks_indexed: number; provider?: string; model?: string; backend_online?: boolean } | null>(null);
  const [corpusType, setCorpusType] = useState<"solution_zip" | "docs" | "unknown" | null>(null);
  const [corpusReason, setCorpusReason] = useState<string | null>(null);
  const [uploadClassification, setUploadClassification] = useState<UploadClassification | null>(null);
  const [docsIngestSignature, setDocsIngestSignature] = useState<string | null>(null);
  const [solutionIngestSignature, setSolutionIngestSignature] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [isClient, setIsClient] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);

  function mapProviderError(msg: string, status?: number) {
    const lower = msg.toLowerCase();
    if (
      status === 401 ||
      lower.includes("invalid api key") ||
      (lower.includes("api key") && (lower.includes("missing") || lower.includes("invalid")))
    ) {
      return "Cloud unavailable (invalid API key/billing). Switch to Local or set OPENAI_API_KEY.";
    }
    if (status === 429 || lower.includes("insufficient_quota") || lower.includes("quota") || lower.includes("billing")) {
      return "Cloud quota/billing required. Switch to Local or enable billing.";
    }
    if (lower.includes("model_not_found") || lower.includes("model not found")) {
      return "Cloud model not available. Choose a different model.";
    }
    const localMatch = msg.match(/local llm not reachable at ([^ ]+)/i);
    if (localMatch?.[1]) {
      return `Local LLM not reachable at ${localMatch[1]}. Start Ollama or update LOCAL_LLM_BASE_URL.`;
    }
    if (lower.includes("local llm not reachable")) {
      return "Local LLM not reachable. Start Ollama or update LOCAL_LLM_BASE_URL.";
    }
    return msg;
  }

  function createDatasetId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createMessageId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function parseApiError(payload: any, fallback: string): GenerateError {
    if (payload?.error?.message) {
      return { message: payload.error.message, code: payload.error.code, hint: payload.error.hint };
    }
    if (payload?.error) {
      return { message: payload.error };
    }
    if (payload?.detail?.message) {
      return { message: payload.detail.message };
    }
    if (payload?.detail) {
      return { message: payload.detail };
    }
    return { message: fallback };
  }

  function getFocusFiles(question: string, attached: AttachedFile[]) {
    const names = attached.map((f) => f.name);
    const lower = question.toLowerCase();
    const matches = names.filter((name) => {
      if (name.toLowerCase().endsWith(".zip")) {
        return false;
      }
      return lower.includes(name.toLowerCase());
    });
    const byBase: Record<string, string> = {};
    for (const name of names) {
      const base = name.replace(/\.[^.]+$/, "").toLowerCase();
      if (base && !byBase[base]) {
        byBase[base] = name;
      }
    }
    for (const base of Object.keys(byBase)) {
      if (lower.includes(base)) {
        matches.push(byBase[base]);
      }
    }
    return Array.from(new Set(matches));
  }

  // Fetch RAG status on mount and periodically
  useEffect(() => {
    async function fetchRagStatus() {
      try {
        if (!datasetId) return;
        const res = await fetch(`/api/rag-status?dataset_id=${encodeURIComponent(datasetId)}`);
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
  }, [datasetId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

  useEffect(() => {
    setIsClient(true);
    const storedModel = localStorage.getItem("selectedModel");
    const storedProvider = localStorage.getItem("llmProvider");
    const storedLocalModel = localStorage.getItem("localModel");
    const storedDatasetId = localStorage.getItem("datasetId");
    if (storedModel) setSelectedModel(storedModel);
    if (storedProvider === "local" || storedProvider === "cloud") {
      setProvider(storedProvider);
    }
    if (storedLocalModel) setLocalModel(storedLocalModel);
    // Clear any old API key from localStorage for security
    localStorage.removeItem("openaiApiKey");
    if (storedDatasetId) {
      setDatasetId(storedDatasetId);
    } else {
      const newId = createDatasetId();
      setDatasetId(newId);
      localStorage.setItem("datasetId", newId);
    }
  }, []);

  useEffect(() => {
    if (!isClient || !datasetId) return;
    localStorage.setItem("datasetId", datasetId);
  }, [datasetId, isClient]);

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
    if (provider === "local") {
      fetchLocalModels();
    }
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
    localStorage.setItem("llmProvider", provider);
    if (provider === "local" && !localModels.length) {
      void fetchLocalModels();
    }
  }, [provider]);

  useEffect(() => {
    if (localModel) {
      localStorage.setItem("localModel", localModel);
    }
  }, [localModel]);

  useEffect(() => {
    let cancelled = false;

    async function runClassification() {
      if (!files.length) {
        setUploadClassification(null);
        return;
      }
      const fileList = files.map((f) => f.file).filter(Boolean) as File[];
      if (!fileList.length) {
        setUploadClassification({ type: "unsupported", reason: "No readable files" });
        return;
      }
      const result = await classifyUploads(fileList);
      if (!cancelled) {
        setUploadClassification(result);
      }
    }

    void runClassification();
    return () => {
      cancelled = true;
    };
  }, [files]);

  useEffect(() => {
    let cancelled = false;

    async function ingestDocs() {
      const textFiles = files.filter((f) => f.isText && typeof f.text === "string");
      if (!textFiles.length) return;
      const activeDatasetId = datasetId || createDatasetId();
      if (!datasetId) {
        setDatasetId(activeDatasetId);
      }

      const signature = textFiles.map((f) => `${f.name}:${f.size}`).join("|");
      if (signature === docsIngestSignature) return;

      try {
        const res = await fetch("/api/rag-ingest-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset_id: activeDatasetId,
            files: textFiles.map((f) => ({
              name: f.name,
              text: f.text,
            })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = data?.error?.message || data?.error || "Failed to ingest documents";
          setCorpusType("unknown");
          setCorpusReason(message);
          return;
        }
        if (!cancelled) {
          setDocsIngestSignature(signature);
          setCorpusType(data?.corpus_type || "docs");
          setCorpusReason(data?.corpus_reason || null);
        }
      } catch {
        if (!cancelled) {
          setCorpusType("unknown");
          setCorpusReason("Failed to ingest documents");
        }
      }
    }

    void ingestDocs();
    return () => {
      cancelled = true;
    };
  }, [files, uploadClassification, docsIngestSignature, datasetId]);

  useEffect(() => {
    let cancelled = false;

    async function ingestSolutionZip() {
      const solutionFile = files.find((f) => f.file && f.name.toLowerCase().endsWith(".zip"));
      if (!solutionFile?.file) return;
      const activeDatasetId = datasetId || createDatasetId();
      if (!datasetId) {
        setDatasetId(activeDatasetId);
      }

      const signature = `${solutionFile.name}:${solutionFile.size}`;
      if (signature === solutionIngestSignature) return;

      const ingestFormData = new FormData();
      ingestFormData.append("file", solutionFile.file);
      ingestFormData.append("dataset_id", activeDatasetId);

      try {
        const res = await fetch("/api/rag-ingest-zip", {
          method: "POST",
          body: ingestFormData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) {
            setCorpusType("unknown");
            setCorpusReason(data?.error || "Failed to ingest solution zip.");
          }
          return;
        }
        if (!cancelled) {
          setSolutionIngestSignature(signature);
          setCorpusType(data?.corpus_type || "solution_zip");
          setCorpusReason(data?.corpus_reason || null);
        }
      } catch {
        if (!cancelled) {
          setCorpusType("unknown");
          setCorpusReason("Failed to ingest solution zip.");
        }
      }
    }

    void ingestSolutionZip();
    return () => {
      cancelled = true;
    };
  }, [files, datasetId, solutionIngestSignature]);

  async function fetchLocalModels() {
    setLocalModelsLoading(true);
    setLocalModelsError(null);
    try {
      const res = await fetch("/api/local-models");
      const data = await res.json();
      if (!data?.ok) {
        const message = data?.error?.message || "Couldn't detect local models. Ensure Ollama is running.";
        setLocalModels([]);
        setUseCustomLocalModel(true);
        setLocalModelsError(message);
        return;
      }

      const models = Array.isArray(data?.models) ? data.models.map((m: any) => m?.name).filter(Boolean) : [];
      setLocalModels(models);

      // Default selection logic
      if (models.length > 0) {
        if (localModel && models.includes(localModel)) {
          setUseCustomLocalModel(false);
        } else {
          setLocalModel(models[0]);
          setUseCustomLocalModel(false);
        }
      } else {
        setUseCustomLocalModel(true);
      }

    } catch (err: any) {
      setLocalModels([]);
      setUseCustomLocalModel(true);
      setLocalModelsError("Couldn't detect local models. Ensure Ollama is running.");
    } finally {
      setLocalModelsLoading(false);
    }
  }

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
    if (files.length === 0) {
      setDatasetId(createDatasetId());
      setDocsIngestSignature(null);
    }
    const incoming = Array.from(fileList);

    const processed = await Promise.all(
      incoming.map(async (file) => {
        const base: AttachedFile = {
          name: file.name,
          type: file.type || "unknown",
          size: file.size,
          isText: false,
          file,
        };

        // Handle .zip solution files - keep original File reference
        if (isSolutionFile(file)) {
          return { ...base, text: "[Power Platform Solution - will be parsed with PAC CLI]", isText: false };
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
    const oldId = datasetId;
    setFiles((prev) => {
      const removed = prev[index];
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setDatasetId(createDatasetId());
        setDocsIngestSignature(null);
        setSolutionIngestSignature(null);
        void resetDataset(oldId);
        return next;
      }

      if (removed?.name?.toLowerCase().endsWith(".zip")) {
        setDatasetId(createDatasetId());
        setDocsIngestSignature(null);
        setSolutionIngestSignature(null);
        void resetDataset(oldId);
        return next;
      }

      void deleteDatasetFiles(oldId, [removed.name]);
      return next;
    });
  }

  async function resetDataset(oldId: string) {
    if (!oldId) return;
    await fetch("/api/rag-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: oldId }),
    }).catch(() => {});
  }

  async function deleteDatasetFiles(oldId: string, fileNames: string[]) {
    if (!oldId || !fileNames.length) return;
    await fetch("/api/rag-delete-docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: oldId, file_names: fileNames }),
    }).catch(() => {});
  }

  function clearFiles() {
    const oldId = datasetId;
    setFiles([]);
    setCorpusType(null);
    setCorpusReason(null);
    setDocsIngestSignature(null);
    setSolutionIngestSignature(null);
    setDatasetId(createDatasetId());
    void resetDataset(oldId);
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
    return uploadClassification?.type === "power_platform_solution_zip";
  }

  // Generate docs for Power Platform solution using PAC CLI + RAG
  async function generateSolutionDocs() {
    const activeDatasetId = datasetId || createDatasetId();
    if (!datasetId) {
      setDatasetId(activeDatasetId);
    }
    const solutionFile = files.find((f) => f.file && f.name.toLowerCase().endsWith(".zip"));
    if (!solutionFile?.file) {
      throw new Error("No solution file found");
    }

    // Step 1: FIRST - Ingest the ZIP file into ChromaDB (parses ALL files, FREE with Sentence-BERT)
    // This happens BEFORE doc generation so RAG chat can use the full solution content
    const ingestFormData = new FormData();
    ingestFormData.append("file", solutionFile.file);
    ingestFormData.append("dataset_id", activeDatasetId);
    
    const ingestRes = await fetch("/api/rag-ingest-zip", {
      method: "POST",
      body: ingestFormData,
    });
    
    if (ingestRes.ok) {
      const ingestData = await ingestRes.json();
      const type = ingestData?.corpus_type || ingestData?.details?.corpus_type || null;
      const reason = ingestData?.corpus_reason || ingestData?.details?.corpus_reason || null;
      setCorpusType(type);
      setCorpusReason(reason);
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

    const parsePayload = await parseRes.json().catch(() => ({}));
    if (!parseRes.ok) {
      const parsed = parseApiError(parsePayload, "Failed to parse solution with PAC CLI");
      const err = new Error(parsed.message);
      (err as any).code = parsed.code;
      (err as any).hint = parsed.hint;
      throw err;
    }

    const parsedSolution = parsePayload?.data || parsePayload;

    // Step 3: Generate documentation with RAG pipeline (API key from backend .env)
    const modelForProvider = llmSelection.model;

    // Extract user preferences from chat history
    const userPreferences = chat
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    const genRes = await fetch("/api/generate-solution-docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        solution: parsedSolution,
        doc_type: "markdown",
        provider: llmSelection.provider,
        model: modelForProvider,
        dataset_id: activeDatasetId,
        user_preferences: userPreferences || undefined,
      }),
    });

    if (!genRes.ok) {
      const errorData = await genRes.json().catch(() => ({}));
      const parsed = parseApiError(errorData, "Failed to generate documentation");
      const message = mapProviderError(parsed.message, genRes.status);
      const err = new Error(message);
      (err as any).code = parsed.code;
      (err as any).hint = parsed.hint;
      throw err;
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

        // Add success message to chat if there are existing chat messages
        if (chat.length > 0) {
          const successId = createMessageId();
          setChat((c) => [
            ...c,
            {
              id: successId,
              role: "assistant",
              content: `✅ Document regenerated successfully! Your preferences have been applied. Check the Output Files panel to view the updated PDF.`,
            },
          ]);
        }

        return;
      }

      // Regular file processing (existing flow)
      const modelForProvider = llmSelection.provider === "cloud" ? llmSelection.model : undefined;
      const res = await fetch("/api/generate-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelForProvider,
          provider: llmSelection.provider,
          files: buildFilesPayload(),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let parsedPayload: any = {};
        try {
          parsedPayload = JSON.parse(text);
        } catch {
          parsedPayload = {};
        }
        const parsed = parseApiError(parsedPayload, text || `HTTP ${res.status}`);
        throw new Error(mapProviderError(parsed.message, res.status));
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
      setGenerateError({
        message: e?.message ?? "Failed to generate documentation",
        code: e?.code,
        hint: e?.hint,
      });
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

    // Check if user wants to clear the chat
    if (text.toLowerCase() === 'clear') {
      setChat([]);
      setMessage("");
      return;
    }

    const activeDatasetId = datasetId || createDatasetId();
    if (!datasetId) {
      setDatasetId(activeDatasetId);
    }

    const userId = createMessageId();
    const assistantId = createMessageId();

    setChat((c) => [
      ...c,
      { id: userId, role: "user", content: text },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    setMessage("");
    setLoading(true);

    try {
      // Always use FREE RAG mode - queries ChromaDB for context
      const modelForProvider = llmSelection.model;
      const focusFiles = getFocusFiles(text, files);

      // Send conversation history for context
      const conversationHistory = chat.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const ragRes = await fetch("/api/rag-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          provider: llmSelection.provider,
          model: modelForProvider,
          dataset_id: activeDatasetId,
          focus_files: focusFiles.length ? focusFiles : undefined,
          conversation_history: conversationHistory,
        }),
      });

      if (!ragRes.ok) {
        const errText = await ragRes.text();
        let parsed: any = {};
        try {
          parsed = JSON.parse(errText);
        } catch {
          parsed = {};
        }
        const message = mapProviderError(
          parsed?.error || parsed?.detail || errText || `HTTP ${ragRes.status}`,
          ragRes.status
        );
        throw new Error(message);
      }

      const ragData = await ragRes.json();

      const sources = Array.isArray(ragData.sources) ? ragData.sources : [];

      // Check if user wants to regenerate documentation BEFORE updating chat
      const lowerText = text.toLowerCase();
      const regenerateKeywords = [
        'regenerate', 'generate', 're-generate',
        'update doc', 'update documentation', 'update the doc',
        'create doc', 'create documentation',
        'please update', 'refresh doc', 'refresh documentation'
      ];

      // Also detect document modification requests (more flexible patterns)
      const documentModificationPatterns = [
        /\bexpand\s+(?:on\s+)?(?:the\s+)?/i,
        /\bremove\s+(?:the\s+)?/i,
        /\bdon'?t\s+(?:want|need|include)/i,
        /\bskip\s+(?:the\s+)?/i,
        /\bfocus\s+(?:on\s+)?(?:the\s+)?/i,
        /\bmore\s+(?:details|info|on|about)/i,
        /\bgive\s+more/i,
        /\belaborate/i,
        /\bneed\s+(?:more|details|info)/i,
        /\bwant\s+(?:more|details|info|to\s+see)/i,
        /\b(?:less|fewer)\s+(?:details?|info)/i,
        /\b(?:not|isn'?t)\s+important/i,
        /\bway\s+more/i,
        /\btell\s+me\s+more/i,
        /\bmake\s+(?:the\s+)?.*?\s+more\s+(?:detailed|comprehensive|thorough)/i,
        /\bmake\s+(?:the\s+)?.*?\s+(?:shorter|longer|brief)/i,
        /\badd\s+more\s+(?:details?|info)/i,
        /\binclude\s+more\s+(?:details?|info)/i,
        /\badd\s+(?:a\s+)?.*?\s+section/i,
        /\binclude\s+(?:a\s+)?.*?\s+section/i,
        /\bcreate\s+(?:a\s+)?.*?\s+section/i,
        /\bneed\s+(?:a\s+)?.*?\s+section/i,
        /\bwant\s+(?:a\s+)?.*?\s+section/i,
      ];

      // Check if message contains regenerate keywords OR document modification patterns
      const shouldRegenerate = regenerateKeywords.some(keyword => lowerText.includes(keyword)) ||
                               documentModificationPatterns.some(pattern => pattern.test(lowerText));

      // If this is a regeneration request, override the assistant's response
      let assistantMessage = ragData.answer || "No response";
      if (shouldRegenerate && hasSolutionFile() && outputs.length > 0) {
        assistantMessage = "🔄 Regenerating document with your preferences... This will take a moment.";
      }

      // Update the assistant message with appropriate response
      setChat((c) =>
        c.map((m) =>
          m.id === assistantId
            ? { ...m, content: assistantMessage, sources: shouldRegenerate ? [] : sources }
            : m
        )
      );

      if (shouldRegenerate && hasSolutionFile() && outputs.length > 0) {
        // Automatically regenerate documentation with current chat context
        setTimeout(() => {
          void generateDocs();
        }, 500); // Small delay to let chat update first
        // Don't set loading to false - generateDocs will handle it
        return;
      }

    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";

      // replace last assistant message with the error
      setChat((c) =>
        c.map((m) =>
          m.id === assistantId ? { ...m, content: `Error: ${msg}`, sources: [] } : m
        )
      );
    } finally {
      setLoading(false);
    }
  }

  const statusProvider = provider === "cloud" ? "Cloud" : "Local";
  const statusModel = provider === "cloud" ? (selectedModel || "default") : (localModel || "default");
  const llmSelection = {
    provider,
    model: provider === "cloud" ? selectedModel || undefined : localModel || undefined,
  };
  const hasFiles = files.length > 0;
  const hasSolution = hasSolutionFile();
  const hasOnlyNonSolution = hasFiles && !hasSolution;
  const uploadType = uploadClassification?.type || null;
  const uploadReason = uploadClassification?.reason || null;
  const hasInvalidZip = uploadType === "unsupported" && files.some((f) => f.name.toLowerCase().endsWith(".zip"));
  const displayType = corpusType || uploadType;
  const displayReason = corpusReason || uploadReason;

  return (
    <main className="app-shell" style={{ fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Documentation Generator</h1>
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
                  {ragStatus.status === "ready" ? "Online" : "Degraded"} • ChromaDB: {ragStatus.chunks_indexed} chunks • Provider: {statusProvider} ({statusModel})
                </span>
              </>
            ) : (
              <span style={{ color: "#666" }}>RAG Backend Offline</span>
            )}
          </div>
        </div>
      </div>
      {isClient && process.env.NODE_ENV === "development" && datasetId && (
        <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
          Dataset: {datasetId.slice(0, 8)}
        </div>
      )}
      

      {/* Responsive grid: 4 columns desktop, 2 columns medium, 1 column small */}
      <div className="app-grid">
        <section className="panel">
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
              {displayType && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#333" }}>
                  <span style={{ padding: "2px 6px", borderRadius: 6, background: "#eef2ff", border: "1px solid #c7d2fe" }}>
                    {displayType === "solution_zip" || displayType === "power_platform_solution_zip"
                      ? "Detected: Power Platform solution"
                      : displayType === "docs" || displayType === "generic_docs"
                      ? "Detected: Documents"
                      : "Detected: Unknown"}
                  </span>
                  {displayReason && (
                    <span style={{ marginLeft: 6, color: "#666" }}>{displayReason}</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ ...placeholderBox, marginTop: 12 }}>No files selected yet.</div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">Chat</div>

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
                  {showAdvanced ? "▲" : `Provider: ${provider === "cloud" ? "Cloud" : "Local"}`}
                </span>
              </button>
              {showAdvanced && (
                <div style={{ display: "grid", gap: 10, paddingTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <label htmlFor="provider-select" style={{ fontWeight: 600 }}>Provider</label>
                    <select
                      id="provider-select"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value === "local" ? "local" : "cloud")}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", minWidth: 200, background: "#fff" }}
                    >
                      <option value="cloud">Cloud (OpenAI API)</option>
                      <option value="local">Local (Ollama API)</option>
                    </select>
                  </div>

                  {provider === "cloud" ? (
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
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <label htmlFor="local-model-select" style={{ fontWeight: 600 }}>Local model</label>
                        <select
                          id="local-model-select"
                          value={useCustomLocalModel ? "custom" : localModel}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "custom") {
                              setUseCustomLocalModel(true);
                            } else {
                              setUseCustomLocalModel(false);
                              setLocalModel(val);
                            }
                          }}
                          disabled={localModelsLoading}
                          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", minWidth: 200, background: "#fff" }}
                        >
                          {localModelsLoading && <option>Loading local models...</option>}
                          {!localModelsLoading && localModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="custom">Custom model...</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => fetchLocalModels()}
                          aria-label="Refresh local models"
                          style={{
                            border: "1px solid #ddd",
                            background: "#fff",
                            padding: "6px 8px",
                            borderRadius: 8,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          ⟳
                        </button>
                      </div>
                      {localModelsError && (
                        <span style={{ fontSize: 12, color: "#a00" }}>
                          Couldn't detect local models. Ensure Ollama is running.
                        </span>
                      )}
                      {useCustomLocalModel && (
                        <input
                          id="local-model"
                          value={localModel}
                          onChange={(e) => setLocalModel(e.target.value)}
                          placeholder="llama3.1:8b"
                          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", minWidth: 180, background: "#fff" }}
                        />
                      )}
                    </div>
                  )}

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

          {/* Chat history scrolls inside the panel to avoid page overflow */}
          <div className="panel-scroll" style={{ border: "1px solid #e0e0e5", borderRadius: 12, padding: 12, background: "#fff" }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              {displayType === "docs" || displayType === "generic_docs"
                ? "Chat answers from your uploaded documents (general mode)."
                : displayType === "solution_zip" || displayType === "power_platform_solution_zip"
                ? "Chat answers from solution components (Power Platform mode)."
                : "Chat answers from the knowledge base once files are ingested."}
            </div>
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
                            onClick={() =>
                              setExpandedSources((prev) => ({
                                ...prev,
                                [m.id]: !prev[m.id],
                              }))
                            }
                            style={{
                              border: "1px solid #d0d0d7",
                              background: "#fff",
                              padding: "4px 8px",
                              borderRadius: 8,
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            {expandedSources[m.id] ? "Hide sources" : `Sources (${m.sources.length})`}
                          </button>
                          {expandedSources[m.id] && (
                            <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: "#444" }}>
                              {m.sources.map((source, idx) => (
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

        <section className="panel">
          <div className="panel-header">Output Files</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <button
              onClick={generateDocs}
              disabled={!hasFiles || generating}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: hasSolution ? "1px solid #0a6b3d" : "1px solid #1f7aec",
                background: generating ? "#9dc2f7" : hasSolution ? "#0a6b3d" : "#1f7aec",
                color: "#fff",
                cursor: !hasFiles || generating ? "not-allowed" : "pointer",
                opacity: !hasFiles || generating ? 0.7 : 1,
              }}
            >
              {generating 
                ? (hasSolution ? "Parsing & Generating..." : "Generating...") 
                : (hasSolution ? "Parse & Generate Docs" : "Generate docs")}
            </button>
            <div style={{ fontSize: 12, color: "#555" }}>
              {hasInvalidZip
                ? "Solution docs require a Power Platform solution (.zip export). For other files, use Chat/RAG mode."
                : !hasFiles
                ? "Select files to enable generation."
                : hasSolution
                ? "Will parse solution with PAC CLI, then generate docs with RAG pipeline."
                : "Uses attached files with current model/system prompt/temperature."}
            </div>
          </div>
          {hasOnlyNonSolution && (
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
              Solution docs require a .zip export. For other files, use Chat/RAG mode or Generate docs.
            </div>
          )}
          {generateError && (
            <div
              style={{
                border: "1px solid #f5c2c7",
                background: "#fff5f5",
                color: "#7a1a1a",
                padding: "8px 10px",
                borderRadius: 8,
                fontSize: 12,
                marginBottom: 8,
              }}
            >
              <div style={{ fontWeight: 600 }}>{generateError.message}</div>
              {generateError.code && <div>Code: {generateError.code}</div>}
              {generateError.hint && <div>{generateError.hint}</div>}
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

        <section className="panel">
          <div className="panel-header">File Preview</div>
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

const placeholderBox: React.CSSProperties = {
  border: "1px dashed #d0d0d7",
  borderRadius: 10,
  padding: 12,
  background: "#fafbff",
  color: "#6b6b75",
  fontSize: 14,
};
