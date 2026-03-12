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
import { useSession, getSession, signIn } from "next-auth/react";
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

type SharePointRef = {
  url: string;
  kind: "site" | "list" | "library" | "unknown";
  source: string;
};

type ParsedSolutionResult = {
  solution_name?: string;
  version?: string;
  publisher?: string;
  components?: unknown[];
  sharepointRefs?: SharePointRef[];
  sharePointMetadata?: SharePointMetadata[];
  [key: string]: unknown;
};

type SharePointMetadata = {
  siteUrl: string;
  siteId: string;
  siteName: string;
  lists: SharePointList[];
  libraries: SharePointLibrary[];
  errorMessage?: string;
};

type SharePointList = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  columns: SharePointColumn[];
  webUrl: string;
  itemCount?: number;
};

type SharePointLibrary = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  webUrl: string;
  driveType: string;
};

type SharePointColumn = {
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  readOnly: boolean;
};

type PendingSolutionGeneration = {
  parsedSolution: ParsedSolutionResult;
  activeDatasetId: string;
};

type SharePointConnection = {
  id: string;
  label: string;
  tenantId: string;
  accountEmail: string;
  createdAt: string;
  lastUsedAt?: string;
  status: "active" | "expired" | "revoked";
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
type PersistedDocument = {
  filename: string;
  markdown: string;
  htmlPreview?: string | null;
  bytesBase64?: string | null;
  mime?: string | null;
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
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
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
  const [showSharePointModal, setShowSharePointModal] = useState(false);
  const [sharePointModalNotice, setSharePointModalNotice] = useState<string | null>(null);
  const [pendingSolutionGeneration, setPendingSolutionGeneration] = useState<PendingSolutionGeneration | null>(null);
  const [sharePointConnections, setSharePointConnections] = useState<SharePointConnection[]>([]);
  const [selectedSharePointConnectionId, setSelectedSharePointConnectionId] = useState<string>("");
  const [savingSharePointConnection, setSavingSharePointConnection] = useState(false);
  const [sharePointToken, setSharePointToken] = useState<string | null>(null);
  const [sharePointNotification, setSharePointNotification] = useState<{ urls: string[]; show: boolean }>({ urls: [], show: false });
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SOLUTION_SYSTEM_PROMPT);
  const [ragStatus, setRagStatus] = useState<{ status: string; chunks_indexed: number; provider?: string; model?: string; backend_online?: boolean } | null>(null);
  const [corpusType, setCorpusType] = useState<"solution_zip" | "docs" | "unknown" | null>(null);
  const [corpusReason, setCorpusReason] = useState<string | null>(null);
  const [uploadClassification, setUploadClassification] = useState<UploadClassification | null>(null);
  const [docsIngestSignature, setDocsIngestSignature] = useState<string | null>(null);
  const [solutionIngestSignature, setSolutionIngestSignature] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  type ConversationListItem = {
    id: string;
    dataset_id: string | null;
    customer_name: string | null;
    title: string | null;
    created_at: number;
    updated_at: number;
  };
  const [conversationList, setConversationList] = useState<ConversationListItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [isClient, setIsClient] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);
  const hasAttemptedInitialRestoreRef = useRef(false);
  const activeConversationLoadRef = useRef(0);
  const { data: session, status } = useSession();

  // Load SharePoint token from sessionStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const token = sessionStorage.getItem("sharepoint_access_token");
      if (token) setSharePointToken(token);
    } catch {}
  }, []);

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

  async function readRouteError(response: Response, fallback: string) {
    const payload = await response.json().catch(() => ({}));
    if (typeof payload?.error === "string" && payload.error.trim().length > 0) {
      return payload.error;
    }
    return fallback;
  }

  function buildRenderTitle(filename: string) {
    const base = filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
    return base || "Documentation";
  }

  async function renderOutputFromMarkdown({
    outputId,
    filename,
    markdownContent,
    createdAt = Date.now(),
  }: {
    outputId: string;
    filename: string;
    markdownContent: string;
    createdAt?: number;
  }) {
    const response = await fetch("/api/markdown-to-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: markdownContent,
        title: buildRenderTitle(filename),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Failed to render document");
    }

    const nextOutput: OutputFile = {
      id: outputId,
      filename,
      bytesBase64: data.pdfBase64 || "",
      mime: "application/pdf",
      createdAt,
      htmlPreview: data.html || "",
      markdownContent,
    };

    return nextOutput;
  }

  async function refreshConversationList() {
    if (status !== "authenticated" || !session?.user) return;
    try {
      const response = await fetch("/api/conversations");
      if (!response.ok) return;
      const data = await response.json();
      setConversationList(data.conversations || []);
    } catch {
      // ignore refresh errors
    }
  }

  async function createConversationSession(document?: PersistedDocument) {
    if (status !== "authenticated" || !session?.user) {
      throw new Error("Sign in to save document edits.");
    }

    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_id: datasetId || null,
        customer_name: customerName.trim() || null,
        document_filename: document?.filename ?? null,
        document_markdown: document?.markdown ?? null,
        document_html: document?.htmlPreview ?? null,
        document_pdf_base64: document?.bytesBase64 ?? null,
        document_mime: document?.mime ?? "application/pdf",
      }),
    });

    if (!response.ok) {
      throw new Error(await readRouteError(response, "Failed to create conversation."));
    }

    const data = await response.json().catch(() => ({}));
    if (typeof data?.conversation_id !== "string" || !data.conversation_id) {
      throw new Error("Failed to create conversation.");
    }

    setConversationId(data.conversation_id);
    void refreshConversationList();
    return data.conversation_id as string;
  }

  async function syncConversationDataset(nextDatasetId: string, targetConversationId?: string | null) {
    const activeConversationId = targetConversationId ?? conversationId;
    if (!activeConversationId || status !== "authenticated" || !session?.user) return;
    await fetch(`/api/conversations/${activeConversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: nextDatasetId }),
    }).catch(() => {});
    void refreshConversationList();
  }

  async function persistConversationDocument(document: PersistedDocument, targetConversationId?: string | null) {
    if (status !== "authenticated" || !session?.user) {
      throw new Error("Sign in to save document edits.");
    }

    const activeConversationId = targetConversationId ?? conversationId;
    if (!activeConversationId) {
      return createConversationSession(document);
    }

    const response = await fetch(`/api/conversations/${activeConversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_filename: document.filename,
        document_markdown: document.markdown,
        document_html: document.htmlPreview ?? null,
        document_pdf_base64: document.bytesBase64 ?? null,
        document_mime: document.mime ?? "application/pdf",
      }),
    });

    if (!response.ok) {
      throw new Error(await readRouteError(response, "Failed to save document."));
    }

    void refreshConversationList();
    return activeConversationId;
  }

  async function restorePersistedOutput(
    data: {
    document_filename?: string | null;
    document_markdown?: string | null;
    updated_at?: number;
    output?: {
      id?: string;
      filename?: string | null;
      markdown_content?: string | null;
      html_preview?: string | null;
      pdf_base64?: string | null;
      mime?: string | null;
      updated_at?: number;
    } | null;
    },
    targetConversationId?: string | null,
    loadToken?: number
  ) {
    const isCurrentLoad = () => loadToken == null || loadToken === activeConversationLoadRef.current;
    const persistedOutput = data.output && typeof data.output === "object" ? data.output : null;
    const filename = typeof persistedOutput?.filename === "string"
      ? persistedOutput.filename
      : typeof data.document_filename === "string"
        ? data.document_filename
        : "";
    const markdown = typeof persistedOutput?.markdown_content === "string"
      ? persistedOutput.markdown_content
      : typeof data.document_markdown === "string"
        ? data.document_markdown
        : null;

    if (!filename || markdown == null) {
      if (!isCurrentLoad()) return;
      setOutputs([]);
      setSelectedOutputId(null);
      setPreviewRefreshing(false);
      return;
    }

    const createdAt = typeof persistedOutput?.updated_at === "number"
      ? persistedOutput.updated_at * 1000
      : typeof data.updated_at === "number"
        ? data.updated_at * 1000
        : Date.now();
    const hydratedOutput: OutputFile = {
      id: typeof persistedOutput?.id === "string" && persistedOutput.id ? persistedOutput.id : `${filename}-${createdAt}`,
      filename,
      bytesBase64: typeof persistedOutput?.pdf_base64 === "string" ? persistedOutput.pdf_base64 : "",
      mime: typeof persistedOutput?.mime === "string" && persistedOutput.mime ? persistedOutput.mime : "application/pdf",
      createdAt,
      htmlPreview: typeof persistedOutput?.html_preview === "string" ? persistedOutput.html_preview : "",
      markdownContent: markdown,
    };
    if (!isCurrentLoad()) return;
    setOutputs([hydratedOutput]);
    setSelectedOutputId(hydratedOutput.id);

    if (hydratedOutput.htmlPreview && hydratedOutput.bytesBase64) {
      setPreviewRefreshing(false);
      return;
    }
    setPreviewRefreshing(true);
    try {
      const refreshedOutput = await renderOutputFromMarkdown({
        outputId: hydratedOutput.id,
        filename: hydratedOutput.filename,
        markdownContent: markdown,
        createdAt,
      });
      if (!isCurrentLoad()) return;
      setOutputs([refreshedOutput]);
      setSelectedOutputId(refreshedOutput.id);
      if (status === "authenticated" && session?.user) {
        await persistConversationDocument(
          {
            filename: refreshedOutput.filename,
            markdown,
            htmlPreview: refreshedOutput.htmlPreview || "",
            bytesBase64: refreshedOutput.bytesBase64 || "",
            mime: refreshedOutput.mime,
          },
          targetConversationId
        );
      }
    } catch {
      // Keep fast hydrated output as fallback.
    } finally {
      if (isCurrentLoad()) {
        setPreviewRefreshing(false);
      }
    }
  }

  async function saveQuickEditOutput(outputId: string, nextMarkdown: string) {
    const currentOutput = outputs.find((output) => output.id === outputId);
    if (!currentOutput) {
      throw new Error("Document not found.");
    }

    if (typeof currentOutput.markdownContent !== "string") {
      throw new Error("Document source unavailable.");
    }

    const renderedOutput = await renderOutputFromMarkdown({
      outputId: currentOutput.id,
      filename: currentOutput.filename,
      markdownContent: nextMarkdown,
      createdAt: Date.now(),
    });

    const savedConversationId = await persistConversationDocument({
      filename: currentOutput.filename,
      markdown: nextMarkdown,
      htmlPreview: renderedOutput.htmlPreview || "",
      bytesBase64: renderedOutput.bytesBase64 || "",
      mime: renderedOutput.mime,
    });
    if (savedConversationId !== conversationId) {
      setConversationId(savedConversationId);
    }

    setOutputs((prev) => prev.map((output) => (output.id === outputId ? renderedOutput : output)));
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
    if (status !== "authenticated" || !session?.user) {
      hasAttemptedInitialRestoreRef.current = false;
      return;
    }
    if (hasAttemptedInitialRestoreRef.current) return;
    if (files.length > 0 || chat.length > 0 || outputs.length > 0) return;
    hasAttemptedInitialRestoreRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const loadToken = ++activeConversationLoadRef.current;
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

        setChat(
          msgs.map((m: { id: string; role: string; content: string }) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
        if (convData.dataset_id) setDatasetId(convData.dataset_id);
        setCustomerName(convData.customer_name || "");
        setConversationId(convData.id);
        void restorePersistedOutput(convData, firstId, loadToken);
      } catch {
        // ignore restore errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chat.length, files.length, outputs.length, session?.user, status]);

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
      const nextDatasetId = createDatasetId();
      setDatasetId(nextDatasetId);
      setDocsIngestSignature(null);
      void syncConversationDataset(nextDatasetId);
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

  function startNewChat(options?: { clearCustomerName?: boolean }) {
    activeConversationLoadRef.current += 1;
    const nextDatasetId = createDatasetId();
    setChat([]);
    setMessage("");
    setConversationId(null);
    setOutputs([]);
    setSelectedOutputId(null);
    setExpandedSources({});
    setGenerateError(null);
    setGenerateProgress(null);
    setPreviewRefreshing(false);
    setDatasetId(nextDatasetId);
    setDocsIngestSignature(null);
    setSolutionIngestSignature(null);
    setCorpusType(null);
    setCorpusReason(null);
    if (options?.clearCustomerName) {
      setCustomerName("");
    }
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

  // Base parse path for Power Platform solution (ingest + parse).
  async function runBaseSolutionParse(onProgress?: (stage: string, percent: number) => void) {
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

    const parsedSolution = (parsePayload?.data || parsePayload) as ParsedSolutionResult;
    const sharePointEnrichmentEnabled = Boolean(parsePayload?.sharePointEnrichmentEnabled);
    const authenticationRequired = Boolean(parsePayload?.authenticationRequired);
    const detectedSharePointUrls = parsePayload?.sharePointUrls || [];

    // Check if SharePoint authentication is required and user has no token
    if (authenticationRequired && detectedSharePointUrls.length > 0 && !sharePointToken) {
      // Show notification banner - don't interrupt parse
      setSharePointNotification({ urls: detectedSharePointUrls, show: true });
      return { parsedSolution, activeDatasetId, sharePointEnrichmentEnabled };
    }

    // If user has token, fetch SharePoint metadata
    if (authenticationRequired && detectedSharePointUrls.length > 0 && sharePointToken) {
      try {
        const spRes = await fetch("/api/fetch-sharepoint-metadata-with-user-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: sharePointToken,
            sharePointUrls: detectedSharePointUrls,
            includeColumns: true,
          }),
        });

        if (spRes.ok) {
          const spData = await spRes.json();
          if (spData.success && spData.sites) {
            parsedSolution.sharePointMetadata = spData.sites;
          }
        }
      } catch (err) {
        console.error("Failed to fetch SharePoint metadata:", err);
        // Continue without SharePoint data
      }
    }

    return { parsedSolution, activeDatasetId, sharePointEnrichmentEnabled };
  }

  async function generateDocumentationFromParsedSolution(
    parsedSolution: ParsedSolutionResult,
    activeDatasetId: string,
    onProgress?: (stage: string, percent: number) => void
  ) {
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
    return docResult.documentation as string;
  }

  async function createSolutionOutput(parsedSolution: ParsedSolutionResult, documentation: string) {
    const solutionName = parsedSolution.solution_name || "solution";
    const componentsCount = Array.isArray(parsedSolution.components) ? parsedSolution.components.length : 0;
    const filename = `${solutionName}_documentation.pdf`;
    const metadata = `Version: ${parsedSolution.version || "N/A"} | Publisher: ${parsedSolution.publisher || "Unknown"} | Components: ${componentsCount}`;

    const pdfResponse = await fetch("/api/markdown-to-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: documentation,
        title: `${solutionName} Documentation`,
        metadata,
      }),
    });

    if (!pdfResponse.ok) {
      const errorData = await pdfResponse.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to generate PDF");
    }

    const pdfData = await pdfResponse.json();
    const output: OutputFile = {
      id: `${filename}-${Date.now()}`,
      filename,
      bytesBase64: pdfData.pdfBase64,
      mime: "application/pdf",
      createdAt: Date.now(),
      htmlPreview: pdfData.html,
      markdownContent: documentation,
    };
    upsertOutput(output);
    setSelectedOutputId(output.id);

    if (status === "authenticated" && session?.user) {
      const savedConversationId = await persistConversationDocument({
        filename: output.filename,
        markdown: documentation,
        htmlPreview: output.htmlPreview || "",
        bytesBase64: output.bytesBase64 || "",
        mime: output.mime,
      });
      if (savedConversationId !== conversationId) {
        setConversationId(savedConversationId);
      }
    }

    if (chat.length > 0) {
      const successId = createMessageId();
      setChat((c) => [
        ...c,
        {
          id: successId,
          role: "assistant",
          content: "Document regenerated successfully. Your preferences have been applied. Check the Output Files panel to view the updated PDF.",
        },
      ]);
    }
  }

  async function continueWithoutSharePointEnrichment() {
    if (!pendingSolutionGeneration) {
      setShowSharePointModal(false);
      return;
    }

    setShowSharePointModal(false);
    setSharePointModalNotice(null);
    setGenerateError(null);
    setGenerating(true);

    try {
      const { parsedSolution, activeDatasetId } = pendingSolutionGeneration;
      const documentation = await generateDocumentationFromParsedSolution(
        parsedSolution,
        activeDatasetId,
        (stage, percent) => setGenerateProgress({ stage, percent })
      );
      await createSolutionOutput(parsedSolution, documentation);
      setGenerateProgress({ stage: "Complete", percent: 100 });
    } catch (e: any) {
      setGenerateError({
        message: e?.message ?? "Failed to generate documentation",
        code: e?.code,
        hint: e?.hint,
      });
      setGenerateProgress({ stage: "Failed", percent: 0, failed: true });
    } finally {
      setGenerating(false);
      setPendingSolutionGeneration(null);
    }
  }

  async function createSharePointConnectionFromSession() {
    const response = await fetch("/api/sharepoint/connections", {
      method: "POST",
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to create SharePoint connection.");
    }

    const connection = payload?.connection as SharePointConnection | undefined;
    if (!connection) {
      throw new Error("SharePoint connection was not returned by the server.");
    }

    setSharePointConnections((prev) => {
      const next = [connection, ...prev.filter((c) => c.id !== connection.id)];
      return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    setSelectedSharePointConnectionId(connection.id);
    return connection;
  }

  async function handleConnectSharePoint() {
    if (savingSharePointConnection) return;
    setSavingSharePointConnection(true);
    setSharePointModalNotice(null);

    try {
      if (status !== "authenticated") {
        const result = await signIn("azure-ad", {
          redirect: false,
          callbackUrl: window.location.href,
        });

        if (result?.error) {
          setSharePointModalNotice(`Sign-in failed: ${result.error}`);
          return;
        }

        if (result?.url && !result.ok) {
          window.location.href = result.url;
          return;
        }

        const refreshedSession = await getSession();
        if (!refreshedSession?.user?.email) {
          setSharePointModalNotice("Sign in is required before adding a SharePoint connection.");
          return;
        }
      }

      const connection = await createSharePointConnectionFromSession();
      setSharePointModalNotice(`Connected: ${connection.label}`);
    } catch (error: any) {
      setSharePointModalNotice(error?.message || "Failed to create SharePoint connection.");
    } finally {
      setSavingSharePointConnection(false);
    }
  }

  async function generateDocs() {
    if (generating || files.length === 0) return;
    setGenerating(true);
    setGenerateError(null);
    setShowSharePointModal(false);
    setSharePointModalNotice(null);
    setPendingSolutionGeneration(null);
    setGenerateProgress(hasSolutionFile() ? { stage: "Starting...", percent: 0 } : { stage: "Generating...", percent: 0 });

    try {
      if (hasSolutionFile()) {
        const { parsedSolution, activeDatasetId, sharePointEnrichmentEnabled } = await runBaseSolutionParse((stage, percent) =>
          setGenerateProgress({ stage, percent })
        );

        const sharepointRefs = Array.isArray(parsedSolution?.sharepointRefs)
          ? parsedSolution.sharepointRefs
          : [];

        if (sharePointEnrichmentEnabled && sharepointRefs.length > 0) {
          setPendingSolutionGeneration({ parsedSolution, activeDatasetId });
          setShowSharePointModal(true);
          setGenerateProgress({ stage: "SharePoint references detected", percent: 55 });
          return;
        }


        const documentation = await generateDocumentationFromParsedSolution(
          parsedSolution,
          activeDatasetId,
          (stage, percent) => setGenerateProgress({ stage, percent })
        );
        await createSolutionOutput(parsedSolution, documentation);
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
              customer_name: customerName.trim() || undefined,
              messages: toSave,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.conversation_id) {
              setConversationId(data.conversation_id);
            }
            const listRes = await fetch("/api/conversations");
            if (listRes.ok) {
              const listData = await listRes.json();
              setConversationList(listData.conversations || []);
            }
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
      const loadToken = ++activeConversationLoadRef.current;
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (loadToken !== activeConversationLoadRef.current) return;
      const msgs = data.messages || [];
      setChat(
        msgs.map((m: { id: string; role: string; content: string }) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
      );
      if (data.dataset_id && files.length === 0) setDatasetId(data.dataset_id);
      setCustomerName(data.customer_name || "");
      setConversationId(data.id);
      void restorePersistedOutput(data, id, loadToken);
    } catch {
      // ignore
    }
  }

  async function saveConversationName() {
    if (!conversationId) return;
    const trimmedCustomer = customerName.trim();
    const dateLabel = new Date().toLocaleDateString("en-GB");
    const nextTitle = trimmedCustomer ? `${trimmedCustomer} - ${dateLabel}` : `New chat - ${dateLabel}`;

    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: trimmedCustomer || null,
          title: nextTitle,
        }),
      });
      if (!res.ok) return;

      const listRes = await fetch("/api/conversations");
      if (listRes.ok) {
        const data = await listRes.json();
        setConversationList(data.conversations || []);
      }
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
        startNewChat({ clearCustomerName: true });
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
            sharePointToken={sharePointToken}
            setSharePointToken={setSharePointToken}
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
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto", paddingRight: 8 }}>
                {conversationList.map((conv) => (
                  (() => {
                    const customerLabel = conv.customer_name || "Unassigned customer";
                    const titleLabel = conv.title || new Date(conv.updated_at * 1000).toLocaleDateString();
                    const customerTrimmed = (conv.customer_name || "").trim();
                    const isTitlePrefixedByCustomer =
                      !!customerTrimmed &&
                      titleLabel.toLowerCase().startsWith(`${customerTrimmed.toLowerCase()} - `);
                    return (
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
                          border: conversationId === conv.id ? "1px solid #1f7aec" : "1px solid var(--border)",
                          borderRadius: 6,
                          background: conversationId === conv.id ? "var(--input-bg)" : "var(--input-bg)",
                          cursor: "pointer",
                        }}
                      >
                        {!isTitlePrefixedByCustomer && (
                          <div style={{ fontWeight: 600, color: "var(--foreground)" }}>{customerLabel}</div>
                        )}
                        <div style={{ fontSize: 11, color: "var(--foreground)" }}>
                          {titleLabel}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                        title="Delete conversation"
                        style={{
                          padding: "4px 8px",
                          fontSize: 12,
                          minWidth: 28,
                          flexShrink: 0,
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          background: "var(--input-bg)",
                          cursor: "pointer",
                          color: "var(--foreground)",
                        }}
                      >
                        ×
                      </button>
                    </div>
                    );
                  })()
                ))}
              </div>
            </div>
          )}

          {status === "authenticated" && (
            <div style={{ marginBottom: 12, display: "grid", gap: 6 }}>
              <label htmlFor="customer-name" style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>
                Customer name
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  id="customer-name"
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    startNewChat();
                  }}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--input-bg)",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  New chat
                </button>
                <button
                  type="button"
                  onClick={() => { void saveConversationName(); }}
                  disabled={!conversationId}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: conversationId ? "var(--input-bg)" : "var(--input-bg)",
                    cursor: conversationId ? "pointer" : "not-allowed",
                    fontSize: 12,
                    color: conversationId ? "var(--foreground)" : "var(--foreground)",
                  }}
                >
                  Save name
                </button>
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
              startNewChat({ clearCustomerName: true });
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
            isRefreshing={previewRefreshing}
            pdfRenderError={pdfRenderError}
            onDownload={(o) => downloadOutput(o)}
            onOpenPdf={() => { if (previewBlobUrlRef.current) window.open(previewBlobUrlRef.current, "_blank"); }}
            onSaveQuickEdit={(outputId, markdown) => saveQuickEditOutput(outputId, markdown)}
          />
        </section>
      </div>

      {showSharePointModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              borderRadius: 12,
              background: "#fff",
              border: "1px solid #ddd",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              padding: 18,
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>SharePoint References Detected</div>
            <div style={{ fontSize: 14, color: "#444", lineHeight: 1.45 }}>
              This solution references SharePoint. You can continue with the current static parse, or connect to SharePoint for enrichment.
            </div>
            {sharePointModalNotice && (
              <div
                style={{
                  fontSize: 13,
                  color: "#7a1a1a",
                  background: "#fff5f5",
                  border: "1px solid #f5c2c7",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                {sharePointModalNotice}
              </div>
            )}
            {sharePointConnections.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor="sharepoint-connection-select" style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>
                  Saved SharePoint connections
                </label>
                <select
                  id="sharepoint-connection-select"
                  value={selectedSharePointConnectionId}
                  onChange={(e) => setSelectedSharePointConnectionId(e.target.value)}
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 14,
                    background: "#fff",
                  }}
                >
                  {sharePointConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void continueWithoutSharePointEnrichment()}
                disabled={generating}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #1f7aec",
                  background: "#1f7aec",
                  color: "#fff",
                  cursor: generating ? "not-allowed" : "pointer",
                  opacity: generating ? 0.7 : 1,
                }}
              >
                Continue without SharePoint enrichment
              </button>
              <button
                type="button"
                onClick={() => void handleConnectSharePoint()}
                disabled={savingSharePointConnection}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #aaa",
                  background: "#fff",
                  color: "#222",
                  cursor: savingSharePointConnection ? "not-allowed" : "pointer",
                  opacity: savingSharePointConnection ? 0.7 : 1,
                }}
              >
                {savingSharePointConnection ? "Connecting..." : "Connect to SharePoint"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SharePoint Notification Banner */}
      {sharePointNotification.show && (
        <div style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          background: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: 12,
          padding: 16,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          maxWidth: 400,
          zIndex: 9998,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#856404" }}>
              📋 SharePoint Sites Detected
            </div>
            <button
              onClick={() => setSharePointNotification({ urls: [], show: false })}
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "#856404" }}
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 13, color: "#856404", marginBottom: 12 }}>
            Found {sharePointNotification.urls.length} SharePoint {sharePointNotification.urls.length === 1 ? "site" : "sites"}. Connect your Microsoft account in Settings to fetch list and library metadata.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                setSharePointNotification({ urls: [], show: false });
                // Trigger settings modal to open (you'd need to expose this via ref or state)
                document.querySelector<HTMLButtonElement>('button[title="Settings"]')?.click();
              }}
              style={{ padding: "6px 12px", background: "#ffc107", color: "#000", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12 }}
            >
              Open Settings
            </button>
            <button
              onClick={() => setSharePointNotification({ urls: [], show: false })}
              style={{ padding: "6px 12px", background: "transparent", color: "#856404", border: "1px solid #856404", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
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

