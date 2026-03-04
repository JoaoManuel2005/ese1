"use client";

import { useEffect, useRef, useState } from "react";
import useFiles from "./hooks/useFiles";
import useModels from "./hooks/useModels";
import useRag from "./hooks/useRag";
import { classifyUploads, UploadClassification } from "../lib/classifyUploads";
import FileUploader from "./components/FileUploader";
import ModelProviderControls from "./components/ModelProviderControls";
import SettingsButton from "./components/SettingsButton";
import ChatWindow from "./components/ChatWindow";
import OutputsList from "./components/OutputsList";
import PreviewPanel from "./components/PreviewPanel";
import SignInButton from "./components/SignInButton";
import { useSession, getSession } from "next-auth/react";
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
  markdownContent?: string;
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

type ApiErrorPayload = {
  error?: string | { message?: string; code?: string; hint?: string };
  detail?: string | { message?: string };
};

type AppError = Error & { code?: string; hint?: string };

type ApiOutput = {
  filename?: string;
  bytesBase64?: string;
  mime?: string;
  createdAt?: string;
  htmlPreview?: string;
  markdownContent?: string;
};

const MAX_TEXT_CHARS = 200 * 1024; // ~200KB cap for in-memory text
const TEXT_EXTS = ["txt", "md", "json", "csv", "js", "ts", "py"];
const SOLUTION_EXT = "zip"; // Power Platform solution files
const MAX_TOTAL_TEXT_CHARS = 400 * 1024; // overall cap we send to backend
const DEFAULT_TEMP = 0.5;
const DEFAULT_SOLUTION_SYSTEM_PROMPT =
  "You are a technical documentation assistant for Microsoft Power Platform solutions. Produce comprehensive documentation that is exhaustive and component-driven. Every component provided must appear in the output under the correct type. Use only provided component evidence and metadata; if a detail is missing, write 'Not found in solution export'. Never omit component types, and preserve exact component names. Mermaid diagrams are mandatory and must be valid fenced mermaid code blocks.";

export default function Page() {
  const [message, setMessage] = useState("");
  const { files, setFiles, updateFileText } = useFiles([]);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState<{ stage: string; percent: number; failed?: boolean } | null>(null);
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
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SOLUTION_SYSTEM_PROMPT);

  const [ragStatus, setRagStatus] = useState<{ status: string; chunks_indexed: number; provider?: string; model?: string; backend_online?: boolean } | null>(null);
  const [corpusType, setCorpusType] = useState<"solution_zip" | "docs" | "unknown" | null>(null);
  const [corpusReason, setCorpusReason] = useState<string | null>(null);
  const [uploadClassification, setUploadClassification] = useState<UploadClassification | null>(null);
  const [docsIngestSignature, setDocsIngestSignature] = useState<string | null>(null);
  const [solutionIngestSignature, setSolutionIngestSignature] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  type ConversationListItem = { id: string; dataset_id: string | null; title: string | null; created_at: number; updated_at: number };
  const [conversationList, setConversationList] = useState<ConversationListItem[]>([]);
  const [isClient, setIsClient] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);
  const { data: session, status } = useSession();

  function mapProviderError(msg: string, status?: number) {
    const lower = msg.toLowerCase();
    if (
      status === 401 ||
      lower.includes("invalid api key") ||
      (lower.includes("api key") && (lower.includes("missing") || lower.includes("invalid")))
    ) {
      return "Cloud unavailable (invalid API key/billing). Switch to Local or update Settings.";
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

  function parseApiError(payload: ApiErrorPayload | undefined, fallback: string): GenerateError {
    if (!payload) return { message: fallback };

    const { error, detail } = payload;

    if (typeof error === "object" && error?.message) {
      return { message: error.message, code: error.code, hint: error.hint };
    }
    if (typeof error === "string" && error) {
      return { message: error };
    }
    if (typeof detail === "object" && detail?.message) {
      return { message: detail.message };
    }
    if (typeof detail === "string" && detail) {
      return { message: detail };
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

  // Load system prompt: from API when authenticated, from sessionStorage when not
  useEffect(() => {
    if (status === "authenticated") {
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch("/api/settings");
          if (!res.ok || cancelled) return;
          const data = await res.json();
          if (cancelled) return;
          if (typeof data?.systemPrompt === "string" && data.systemPrompt.trim().length > 0) {
            setSystemPrompt(data.systemPrompt);
          } else {
            setSystemPrompt(DEFAULT_SOLUTION_SYSTEM_PROMPT);
          }
        } catch {
          if (!cancelled) setSystemPrompt(DEFAULT_SOLUTION_SYSTEM_PROMPT);
        }
      })();
      return () => { cancelled = true; };
    }
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem("systemPrompt");
        if (stored != null && stored.trim().length > 0) {
          setSystemPrompt(stored);
          return;
        }
      } catch { /* ignore */ }
    }
    setSystemPrompt(DEFAULT_SOLUTION_SYSTEM_PROMPT);
  }, [status]);

  // Restore most recent conversation when user is signed in
  useEffect(() => {
    if (status !== "authenticated" || !session?.user) return;
    let cancelled = false;

    (async () => {
      try {
        const listRes = await fetch("/api/conversations");
        if (!listRes.ok || cancelled) return;
        const listData = await listRes.json();
        const convs = listData.conversations || [];
        setConversationList(convs);
        if (convs.length === 0 || cancelled) return;

        const firstId = convs[0].id;
        const convRes = await fetch(`/api/conversations/${firstId}`);
        if (!convRes.ok || cancelled) return;
        const convData = await convRes.json();
        const msgs = convData.messages || [];

        if (cancelled) return;

        if (files.length > 0 || chat.length > 0) return;
        
        setChat(
          msgs.map((m: { id: string; role: string; content: string }) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
        if (convData.dataset_id) setDatasetId(convData.dataset_id);
        setConversationId(convData.id);
      } catch {
        // ignore restore errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user, status]);

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

      const signature = `${activeDatasetId}:${textFiles.map((f) => `${f.name}:${f.size}`).join("|")}`;
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

      const signature = `${activeDatasetId}:${solutionFile.name}:${solutionFile.size}`;
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
        
        const stored = data?.details?.chunks_stored ?? data?.chunks_stored ?? 0;
        if (stored <= 0) {
          if (!cancelled) {
            setCorpusType("unknown");
            setCorpusReason("Solution parsed but no chunks were indexed for chat.");
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

      const models = Array.isArray(data?.models)
        ? data.models
            .map((m: { name?: string }) => m?.name)
            .filter((name: string | undefined): name is string => Boolean(name))
        : [];
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

    } catch {
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

  async function addFiles(fileList: FileList | File[] | null) {
    if (!fileList) return;
    if (files.length === 0) {
      setDatasetId(createDatasetId());
      setDocsIngestSignature(null);
      setConversationId(null);
    }
    const incoming = Array.isArray(fileList) ? fileList : Array.from(fileList);

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
        } catch {
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
  async function generateSolutionDocs(onProgress?: (stage: string, percent: number) => void) {
    const activeDatasetId = datasetId || createDatasetId();
    if (!datasetId) {
      setDatasetId(activeDatasetId);
    }
    const solutionFile = files.find((f) => f.file && f.name.toLowerCase().endsWith(".zip"));
    if (!solutionFile?.file) {
      throw new Error("No solution file found");
    }
    const currentSignature = `${activeDatasetId}:${solutionFile.name}:${solutionFile.size}`;
    const alreadyIngested = solutionIngestSignature === currentSignature;

    // Step 1: FIRST - Ingest the ZIP file into ChromaDB (parses ALL files, FREE with Sentence-BERT)
    // This happens BEFORE doc generation so RAG chat can use the full solution content
    if (!alreadyIngested) {
      onProgress?.("Ingesting solution into RAG...", 15);
      const ingestFormData = new FormData();
      ingestFormData.append("file", solutionFile.file);
      ingestFormData.append("dataset_id", activeDatasetId);

      const ingestRes = await fetch("/api/rag-ingest-zip", {
        method: "POST",
        body: ingestFormData,
      });

      if (ingestRes.ok) {
        const ingestData = await ingestRes.json();
        const stored = ingestData?.details?.chunks_stored ?? ingestData?.chunks_stored ?? 0;

        if (stored <= 0) {
          throw new Error("Solution parsed but no chunks were indexed for chat.");
        }

        const type = ingestData?.corpus_type || ingestData?.details?.corpus_type || null;
        const reason = ingestData?.corpus_reason || ingestData?.details?.corpus_reason || null;
        setCorpusType(type);
        setCorpusReason(reason);
        setSolutionIngestSignature(currentSignature);
        console.log("Solution ingested into ChromaDB:", ingestData);
      } else if (ingestRes.status === 409) {
        console.warn("Ingest already in progress for this dataset. Continuing.");
      } else {
        throw new Error("Failed to ingest solution into ChromaDB.");
      }
    }

    // Step 2: Parse solution with PAC CLI (for doc generation metadata)
    onProgress?.("Parsing solution with PAC CLI...", 40);
    const formData = new FormData();
    formData.append("file", solutionFile.file);

    const parseRes = await fetch("/api/parse-solution", {
      method: "POST",
      body: formData,
    });

    const parsePayload = await parseRes.json().catch(() => ({}));
    if (!parseRes.ok) {
      const parsed = parseApiError(parsePayload, "Failed to parse solution with PAC CLI");
      const err = new Error(parsed.message) as AppError;
      err.code = parsed.code;
      err.hint = parsed.hint;
      throw err;
    }

    const parsedSolution = parsePayload?.data || parsePayload;

    // Step 3: Generate documentation with RAG pipeline (API key from runtime settings)
    onProgress?.("Generating documentation with AI...", 65);
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
        systemPrompt: (systemPrompt && systemPrompt.trim()) || undefined,
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
      const err = new Error(message) as AppError;
      err.code = parsed.code;
      err.hint = parsed.hint;
      throw err;
    }

    const docResult = await genRes.json();
    
    return { parsedSolution, documentation: docResult.documentation };
  }

  async function generateDocs() {
    if (generating || files.length === 0) return;
    setGenerating(true);
    setGenerateError(null);
    setGenerateProgress(hasSolutionFile() ? { stage: "Starting...", percent: 0 } : { stage: "Generating...", percent: 0 });

    try {
      // Check if we have a solution file - use PAC CLI + RAG pipeline
      if (hasSolutionFile()) {
        const { parsedSolution, documentation } = await generateSolutionDocs((stage, percent) =>
          setGenerateProgress({ stage, percent })
        );
        
        // Create output with the generated documentation
        const createdAt = new Date().toISOString();
        const filename = `${parsedSolution.solution_name || "solution"}_documentation.pdf`;
        
        // Generate PDF with Mermaid support using the markdown-to-pdf API
        const metadata = `Version: ${parsedSolution.version} | Publisher: ${parsedSolution.publisher} | Components: ${parsedSolution.components?.length || 0}`;
        const pdfResponse = await fetch("/api/markdown-to-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            markdown: documentation,
            title: `${parsedSolution.solution_name} Documentation`,
            metadata: metadata,
          }),
        });

        if (!pdfResponse.ok) {
          const errorData = await pdfResponse.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to generate PDF");
        }

        const pdfData = await pdfResponse.json();
        const pdfBase64 = pdfData.pdfBase64;
        const htmlContent = pdfData.html;

        const output: OutputFile = {
          id: `${filename}-${Date.now()}`,
          filename: filename,
          bytesBase64: pdfBase64,
          mime: "application/pdf",
          createdAt: Date.now(),
          htmlPreview: htmlContent,
          markdownContent: documentation, // Store original markdown for Mermaid rendering
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

        setGenerateProgress({ stage: "Complete", percent: 100 });
        return;
      }

      // Regular file processing (existing flow)
      setGenerateProgress({ stage: "Generating documentation...", percent: 50 });
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
        let parsedPayload: unknown = {};
        try {
          parsedPayload = JSON.parse(text);
        } catch {
          parsedPayload = {};
        }
        const parsed = parseApiError(parsedPayload as ApiErrorPayload, text || `HTTP ${res.status}`);
        throw new Error(mapProviderError(parsed.message, res.status));
      }

      const data = await res.json();
      const outputsFromApi: ApiOutput[] = Array.isArray(data?.outputs) ? (data.outputs as ApiOutput[]) : [];

      if (!outputsFromApi.length) {
        throw new Error("Invalid generate response");
      }

      setSelectedOutputId(null); // user chooses what to preview
      setGenerateProgress({ stage: "Complete", percent: 100 });

      outputsFromApi.forEach((o) => {
        const created = Date.parse(o.createdAt || "") || Date.now();
        const output: OutputFile = {
          id: `${o.filename || "output"}-${created}`,
          filename: o.filename || "output.pdf",
          bytesBase64: o.bytesBase64 || "",
          mime: o.mime || "application/pdf",
          createdAt: created,
          htmlPreview: o.htmlPreview || "",
          markdownContent: o.markdownContent, // Store original markdown for Mermaid rendering
        };
        upsertOutput(output);
      });
    } catch (e: unknown) {
      setGenerateError({
        message: e instanceof Error ? e.message : "Failed to generate documentation",
        code: (e as AppError | undefined)?.code,
        hint: (e as AppError | undefined)?.hint,
      });
      setGenerateProgress({ stage: "Failed", percent: 0, failed: true });
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

  async function send(textParam?: string) {
    const text = (textParam ?? message).trim();
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
        let parsed: { error?: string; detail?: string } = {};
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
      // Persist this exchange when user is signed in
      const currentSession = await getSession();
      if (currentSession?.user) {
        const toSave = [
          { role: "user" as const, content: text },
          { role: "assistant" as const, content: assistantMessage },
        ];
        try {
          const res = await fetch("/api/conversations/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversation_id: conversationId ?? undefined,
              dataset_id: activeDatasetId,
              messages: toSave,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.conversation_id) setConversationId(data.conversation_id);
          }
        } catch {
          // ignore save errors
        }
      }
      if (shouldRegenerate && hasSolutionFile() && outputs.length > 0) {
        // Automatically regenerate documentation with current chat context
        setTimeout(() => {
          void generateDocs();
        }, 500); // Small delay to let chat update first
        // Don't set loading to false - generateDocs will handle it
        return;
      }

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";

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

  async function loadConversation(id: string) {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs = data.messages || [];
      setChat(
        msgs.map((m: { id: string; role: string; content: string }) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
      );
      if (data.dataset_id && files.length === 0) setDatasetId(data.dataset_id);
      setConversationId(data.id);
    } catch {
      // ignore
    }
  }

  async function deleteConversation(id: string) {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setConversationList((prev) => prev.filter((c) => c.id !== id));
      if (conversationId === id) {
        setChat([]);
        setMessage("");
        setConversationId(null);
      }
    } catch {
      // ignore
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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <SettingsButton
            isAuthenticated={status === "authenticated"}
            provider={provider}
            setProvider={setProvider}
            models={models}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            localModels={localModels}
            localModel={localModel}
            setLocalModel={setLocalModel}
            localModelsLoading={localModelsLoading}
            localModelsError={localModelsError}
            useCustomLocalModel={useCustomLocalModel}
            setUseCustomLocalModel={setUseCustomLocalModel}
            fetchLocalModels={fetchLocalModels}
            apiKey={apiKey}
            setApiKey={setApiKey}
            endpoint={endpoint}
            setEndpoint={setEndpoint}
            systemPrompt={systemPrompt}
            setSystemPrompt={setSystemPrompt}
            systemPromptDefault={DEFAULT_SOLUTION_SYSTEM_PROMPT}
          />
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>Documentation Generator</h1>
        </div>
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
          <SignInButton />
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
          <FileUploader
          files={files}
          onAdd={(fl) => addFiles(fl)}
          onRemove={removeFile}
          clearFiles={clearFiles}
          displayType={corpusType}
          displayReason={corpusReason}
        />
        </section>

        <section className="panel">
          <div className="panel-header">Chat</div>

          <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <ModelProviderControls
                provider={provider}
                setProvider={setProvider}
                models={models}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                modelsLoading={modelsLoading}
                modelsError={modelsError}
                localModels={localModels}
                localModel={localModel}
                setLocalModel={setLocalModel}
                localModelsLoading={localModelsLoading}
                localModelsError={localModelsError}
                useCustomLocalModel={useCustomLocalModel}
                setUseCustomLocalModel={setUseCustomLocalModel}
                fetchLocalModels={fetchLocalModels}
              />
            </div>
          </div>

          {status === "authenticated" && conversationList.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#555" }}>Past conversations</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflowY: "auto" }}>
                {conversationList.map((conv) => (
                    <div
                      key={conv.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => loadConversation(conv.id)}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          textAlign: "left",
                          fontSize: 12,
                          border: conversationId === conv.id ? "1px solid #1f7aec" : "1px solid #ddd",
                          borderRadius: 6,
                          background: conversationId === conv.id ? "#e8f0fe" : "#fafafa",
                          cursor: "pointer",
                        }}
                      >
                        {conv.title || "Chat"} · {new Date(conv.updated_at * 1000).toLocaleDateString()}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                        title="Delete conversation"
                        style={{
                          padding: "4px 8px",
                          fontSize: 12,
                          border: "1px solid #ccc",
                          borderRadius: 6,
                          background: "#fff",
                          cursor: "pointer",
                          color: "#666",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <ChatWindow
            chat={chat}
            loading={loading}
            onSend={(txt) => void send(txt)}
            onClear={async () => {
              if (conversationId) {
                try {
                  const res = await fetch("/api/conversations");
                  if (res.ok) {
                    const data = await res.json();
                    setConversationList(data.conversations || []);
                  }
                } catch {
                  // ignore
                }
              }
              setChat([]);
              setMessage("");
              setConversationId(null);
            }}
            expandedSources={expandedSources}
            onToggleSources={(id) => setExpandedSources((prev) => ({ ...prev, [id]: !prev[id] }))}
            bottomRef={bottomRef}
            displayType={displayType}
          />
        </section>

        <section className="panel">
          <div className="panel-header">Output Files</div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            {generateProgress && (
              <div style={{ marginTop: 10, marginBottom: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12, color: "#555" }}>
                  <span>{generateProgress.stage}</span>
                  <span>{generateProgress.percent}%</span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: generateProgress.failed ? "#ffe0e0" : "#e8e8ec",
                    overflow: "hidden",
                  }}
                >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(generateProgress.percent, 100)}%`,
                    background: generateProgress.failed ? "#c41e3a" : hasSolution ? "#0a6b3d" : "#1f7aec",
                    borderRadius: 3,
                    transition: "width 0.3s ease-out",
                  }}
                />
                </div>
              </div>
            )}
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

          <OutputsList outputs={outputs} selectedOutputId={selectedOutputId} onSelect={(id) => setSelectedOutputId(id)} onDownload={(o) => downloadOutput(o)} />
        </section>

        <section className="panel">
          <div className="panel-header">File Preview</div>
          <PreviewPanel
            out={getSelectedOutput()}
            previewBlobUrl={previewBlobUrlRef.current}
            pdfRenderError={pdfRenderError}
            onDownload={(o) => downloadOutput(o)}
            onOpenPdf={() => { if (previewBlobUrlRef.current) window.open(previewBlobUrlRef.current, "_blank"); }}
          />
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
