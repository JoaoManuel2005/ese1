"use client";

import { useEffect, useRef, useState } from "react";
import useFiles from "./hooks/useFiles";
import useModels from "./hooks/useModels";
import useRag from "./hooks/useRag";
import { classifyUploads, UploadClassification } from "../lib/classifyUploads";
import FileUploader from "./components/FileUploader";
import SettingsButton from "./components/SettingsButton";
import ChatWindow from "./components/ChatWindow";
import OutputsList from "./components/OutputsList";
import OutputTypeSelector from "./components/OutputTypeSelector";
import PreviewPanel from "./components/PreviewPanel";
import SignInButton from "./components/SignInButton";
import { useOutputTypes } from "./hooks/useOutputTypes";
import { useSession, getSession } from "next-auth/react";
import {
  buildUnknownChatOutputTypeMessage,
  resolveChatOutputTypeChange,
} from "./utils/chatOutputType";
import {
  buildPromptChoices,
  resolvePromptSelectionIdFromText,
} from "./utils/promptLibrary";
import {
  buildSolutionForGeneration,
  fetchSharePointEnrichmentWithUserToken,
  hasDetectedSharePointReferences,
  type ParsedSolutionResult,
  type SharePointEnrichmentStatus,
  type SharePointMetadata,
  shouldAttemptSharePointUserEnrichment,
  splitParsedSolutionData,
} from "./utils/solutionSharePoint";
import {
  canGenerateSolutionDocs,
  hasInvalidSelectedFiles as hasInvalidSelectedFilesInState,
} from "./utils/solutionUploadValidation";
import { mapUploadErrorMessage, parseApiError } from "./utils/helpers";
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
  outputTypeId?: string | null;
  outputTypeTitle?: string | null;
  outputTypeKind?: string | null;
  promptId?: string | null;
  promptNameSnapshot?: string | null;
  promptTextSnapshot?: string | null;
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

type ParseSolutionApiResponse = {
  ok: true;
  data: ParsedSolutionResult;
  authenticationRequired: boolean;
  sharePointUrls: string[];
  sharePointEnrichmentStatus: SharePointEnrichmentStatus;
  message?: string;
  sharePointEnrichmentEnabled: boolean;
};

type BaseSolutionParseResult = {
  parsedSolution: ParsedSolutionResult;
  sharePointDetected: boolean;
  sharePointUrls: string[];
  sharePointEnrichmentStatus: SharePointEnrichmentStatus;
  sharePointMetadata: SharePointMetadata[] | null;
  activeDatasetId: string;
  sharePointEnrichmentEnabled: boolean;
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

type GenerationSnapshot = {
  outputTypeId?: string | null;
  outputTypeTitle?: string | null;
  outputTypeKind?: string | null;
  promptId?: string | null;
  promptNameSnapshot?: string | null;
  promptTextSnapshot?: string | null;
};

const MAX_TEXT_CHARS = 200 * 1024; // ~200KB cap for in-memory text
const SOLUTION_EXT = "zip"; // Supported upload type for solution documentation
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
  const [sharePointToken, setSharePointToken] = useState<string | null>(null);
  const [parsedSolution, setParsedSolution] = useState<ParsedSolutionResult | null>(null);
  const [sharePointUrls, setSharePointUrls] = useState<string[]>([]);
  const [sharePointEnrichmentStatus, setSharePointEnrichmentStatus] = useState<SharePointEnrichmentStatus>("not_needed");
  const [sharePointMetadata, setSharePointMetadata] = useState<SharePointMetadata[] | null>(null);
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
  const [loadedCustomerName, setLoadedCustomerName] = useState("");
  const [isClient, setIsClient] = useState(false);
  const [selectedOutputTypeId, setSelectedOutputTypeId] = useState<string>("documentation");
  const selectedOutputTypeIdRef = useRef<string>("documentation");
  const { data: session, status } = useSession();
  const {
    outputTypes,
    loading: outputTypesLoading,
    error: outputTypesError,
  } = useOutputTypes(status);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);
  const hasAttemptedInitialRestoreRef = useRef(false);
  const activeConversationLoadRef = useRef(0);
  const conversationIdRef = useRef<string | null>(null);
  const creatingConversationRef = useRef<Promise<string> | null>(null);

  function applyConversationId(nextConversationId: string | null) {
    conversationIdRef.current = nextConversationId;
    setConversationId(nextConversationId);
  }

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);


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
      return "Cloud unavailable (invalid API key/billing). Switch to Local or configure a valid server-side key.";
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

  function buildOutputLabel(value: string | null | undefined) {
    const normalized = (value || "documentation")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized || "documentation";
  }

  function resolveGenerationOutputTypeId(overrideOutputTypeId?: string) {
    const candidate = overrideOutputTypeId ?? selectedOutputTypeIdRef.current;
    if (candidate === "custom" || outputTypes.some((entry) => entry.id === candidate)) {
      return candidate;
    }
    return "documentation";
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

  function isLegacyPreviewHtml(htmlPreview: string) {
    const trimmed = htmlPreview.trimStart().toLowerCase();
    return (
      trimmed.startsWith("<!doctype html") ||
      trimmed.startsWith("<html") ||
      trimmed.includes("<head>")
    );
  }

  function resetParsedSolutionState() {
    setParsedSolution(null);
    setSharePointUrls([]);
    setSharePointEnrichmentStatus("not_needed");
    setSharePointMetadata(null);
  }

  async function enrichExistingParsedSolutionWithSharePoint(accessToken: string) {
    if (!parsedSolution || sharePointUrls.length === 0) {
      return { status: sharePointEnrichmentStatus, metadata: sharePointMetadata };
    }

    const enrichment = await fetchSharePointEnrichmentWithUserToken({
      accessToken,
      sharePointUrls,
      fallbackMetadata: sharePointMetadata,
    });

    setSharePointMetadata(enrichment.metadata);
    setSharePointEnrichmentStatus(enrichment.status);

    return enrichment;
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
      markdownContent:
        typeof data.normalizedMarkdown === "string" ? data.normalizedMarkdown : markdownContent,
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

  async function createConversationSession(document?: PersistedDocument, generationSnapshot?: GenerationSnapshot) {
    if (status !== "authenticated" || !session?.user) {
      throw new Error("Sign in to save document edits.");
    }

    if (conversationIdRef.current) return conversationIdRef.current;
    if (creatingConversationRef.current) {
      return creatingConversationRef.current;
    }

    const createPromise = (async () => {
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
          output_type_id: generationSnapshot?.outputTypeId ?? null,
          output_type_title: generationSnapshot?.outputTypeTitle ?? null,
          output_type_kind: generationSnapshot?.outputTypeKind ?? null,
          prompt_id: generationSnapshot?.promptId ?? null,
          prompt_name_snapshot: generationSnapshot?.promptNameSnapshot ?? null,
          prompt_text_snapshot: generationSnapshot?.promptTextSnapshot ?? null,
        }),
      });

      if (!response.ok) {
        throw new Error(await readRouteError(response, "Failed to create conversation."));
      }

      const data = await response.json().catch(() => ({}));
      if (typeof data?.conversation_id !== "string" || !data.conversation_id) {
        throw new Error("Failed to create conversation.");
      }

      applyConversationId(data.conversation_id);
      void refreshConversationList();
      return data.conversation_id as string;
    })();

    creatingConversationRef.current = createPromise;
    try {
      return await createPromise;
    } finally {
      if (creatingConversationRef.current === createPromise) {
        creatingConversationRef.current = null;
      }
    }
  }

  async function syncConversationDataset(nextDatasetId: string, targetConversationId?: string | null) {
    const activeConversationId = targetConversationId ?? conversationIdRef.current;
    if (!activeConversationId || status !== "authenticated" || !session?.user) return;
    await fetch(`/api/conversations/${activeConversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: nextDatasetId }),
    }).catch(() => {});
    void refreshConversationList();
  }

  async function persistConversationDocument(
    document: PersistedDocument,
    targetConversationId?: string | null,
    generationSnapshot?: GenerationSnapshot
  ) {
    if (status !== "authenticated" || !session?.user) {
      throw new Error("Sign in to save document edits.");
    }

    const activeConversationId = targetConversationId ?? conversationIdRef.current;
    if (!activeConversationId) {
      return createConversationSession(document, generationSnapshot);
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
        output_type_id: generationSnapshot?.outputTypeId ?? null,
        output_type_title: generationSnapshot?.outputTypeTitle ?? null,
        output_type_kind: generationSnapshot?.outputTypeKind ?? null,
        prompt_id: generationSnapshot?.promptId ?? null,
        prompt_name_snapshot: generationSnapshot?.promptNameSnapshot ?? null,
        prompt_text_snapshot: generationSnapshot?.promptTextSnapshot ?? null,
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
      output_type_id?: string | null;
      output_type_title?: string | null;
      output_type_kind?: string | null;
      prompt_id?: string | null;
      prompt_name_snapshot?: string | null;
      prompt_text_snapshot?: string | null;
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
      outputTypeId: typeof persistedOutput?.output_type_id === "string" ? persistedOutput.output_type_id : null,
      outputTypeTitle: typeof persistedOutput?.output_type_title === "string" ? persistedOutput.output_type_title : null,
      outputTypeKind: typeof persistedOutput?.output_type_kind === "string" ? persistedOutput.output_type_kind : null,
      promptId: typeof persistedOutput?.prompt_id === "string" ? persistedOutput.prompt_id : null,
      promptNameSnapshot: typeof persistedOutput?.prompt_name_snapshot === "string" ? persistedOutput.prompt_name_snapshot : null,
      promptTextSnapshot: typeof persistedOutput?.prompt_text_snapshot === "string" ? persistedOutput.prompt_text_snapshot : null,
    };
    if (!isCurrentLoad()) return;
    setOutputs([hydratedOutput]);
    setSelectedOutputId(hydratedOutput.id);
    if (hydratedOutput.outputTypeId) {
      setSelectedOutputTypeId(hydratedOutput.outputTypeId);
      selectedOutputTypeIdRef.current = hydratedOutput.outputTypeId;
    }

    if (
      hydratedOutput.htmlPreview &&
      hydratedOutput.bytesBase64 &&
      !isLegacyPreviewHtml(hydratedOutput.htmlPreview)
    ) {
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
            markdown: refreshedOutput.markdownContent || markdown,
            htmlPreview: refreshedOutput.htmlPreview || "",
            bytesBase64: refreshedOutput.bytesBase64 || "",
            mime: refreshedOutput.mime,
          },
          targetConversationId,
          {
            outputTypeId: hydratedOutput.outputTypeId,
            outputTypeTitle: hydratedOutput.outputTypeTitle,
            outputTypeKind: hydratedOutput.outputTypeKind,
            promptId: hydratedOutput.promptId,
            promptNameSnapshot: hydratedOutput.promptNameSnapshot,
            promptTextSnapshot: hydratedOutput.promptTextSnapshot,
          }
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
      markdown: renderedOutput.markdownContent || nextMarkdown,
      htmlPreview: renderedOutput.htmlPreview || "",
      bytesBase64: renderedOutput.bytesBase64 || "",
      mime: renderedOutput.mime,
    });
    if (savedConversationId !== conversationIdRef.current) {
      applyConversationId(savedConversationId);
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
    if (!outputTypes.length) return;
    const promptChoices = buildPromptChoices(outputTypes, DEFAULT_SOLUTION_SYSTEM_PROMPT);
    const resolvedSelectionId = resolvePromptSelectionIdFromText(promptChoices, systemPrompt);
    const nextSelectionId = resolvedSelectionId === "default" ? "documentation" : resolvedSelectionId;
    if (nextSelectionId !== selectedOutputTypeId) {
      setSelectedOutputTypeId(nextSelectionId);
    }
  }, [outputTypes, selectedOutputTypeId, systemPrompt]);

  useEffect(() => {
    selectedOutputTypeIdRef.current = selectedOutputTypeId;
  }, [selectedOutputTypeId]);

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
        setLoadedCustomerName(convData.customer_name || "");
        setCustomerName("");
        applyConversationId(convData.id);
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
            const parsed = parseApiError(data as ApiErrorPayload, "Failed to ingest solution zip.");
            setCorpusType("unknown");
            setCorpusReason(mapUploadErrorMessage(parsed));
            if (parsed.code || parsed.hint) {
              console.warn("Solution ZIP ingest failed:", {
                code: parsed.code,
                message: parsed.message,
                hint: parsed.hint,
              });
            }
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
    if (typeof URL.createObjectURL !== "function") {
      return "";
    }
    return URL.createObjectURL(blob);
  }

  function isSolutionFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    return ext === SOLUTION_EXT;
  }

  async function addFiles(fileList: FileList | File[] | null) {
    if (!fileList) return;
    const incoming = (Array.isArray(fileList) ? fileList : Array.from(fileList)).filter(isSolutionFile);
    if (!incoming.length) return;
    const [nextFile] = incoming;
    if (!nextFile) return;
    const nextDatasetId = createDatasetId();
    const oldId = datasetId;
    setDatasetId(nextDatasetId);
    setDocsIngestSignature(null);
    setSolutionIngestSignature(null);
    setCorpusType(null);
    setCorpusReason(null);
    resetParsedSolutionState();
    if (oldId) {
      void resetDataset(oldId);
    }
    void syncConversationDataset(nextDatasetId);

    const processed = await Promise.all(
      [nextFile].map(async (file) => {
        return {
          name: file.name,
          type: file.type || "unknown",
          size: file.size,
          isText: false,
          file,
          text: "[Power Platform Solution - will be parsed with PAC CLI]",
        };
      })
    );

    setFiles(processed);
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
        resetParsedSolutionState();
        void resetDataset(oldId);
        return next;
      }

      if (removed?.name?.toLowerCase().endsWith(".zip")) {
        setDatasetId(createDatasetId());
        setDocsIngestSignature(null);
        setSolutionIngestSignature(null);
        resetParsedSolutionState();
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
    resetParsedSolutionState();
    void resetDataset(oldId);
  }

  function startNewChat(options?: { clearCustomerName?: boolean }) {
    activeConversationLoadRef.current += 1;
    const nextDatasetId = createDatasetId();
    setChat([]);
    setMessage("");
    applyConversationId(null);
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
    resetParsedSolutionState();
    setCustomerName("");
    setLoadedCustomerName("");
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
  async function runBaseSolutionParse(onProgress?: (stage: string, percent: number) => void): Promise<BaseSolutionParseResult> {
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

    // Step 1: FIRST - Ingest the ZIP file into Qdrant (parses ALL files, FREE with Sentence-BERT)
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
        console.log("Solution ingested into Qdrant:", ingestData);
      } else if (ingestRes.status === 409) {
        console.warn("Ingest already in progress for this dataset. Continuing.");
      } else {
        throw new Error("Failed to ingest solution into Qdrant.");
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
      const parsed = parseApiError(parsePayload as ApiErrorPayload, "Failed to parse solution with PAC CLI");
      const err = new Error(parsed.message) as AppError;
      err.code = parsed.code;
      err.hint = parsed.hint;
      throw err;
    }

    const {
      data: parsedSolutionPayload,
      sharePointEnrichmentEnabled,
      authenticationRequired,
      sharePointUrls: detectedSharePointUrls,
      sharePointEnrichmentStatus: initialSharePointEnrichmentStatus,
    } = parsePayload as ParseSolutionApiResponse;

    const { parsedSolution: baseParsedSolution, sharePointMetadata: initialSharePointMetadata } =
      splitParsedSolutionData(parsedSolutionPayload);
    const hasDetectedSharePoint = hasDetectedSharePointReferences(
      baseParsedSolution,
      detectedSharePointUrls
    );
    let resolvedSharePointMetadata = initialSharePointMetadata;
    let resolvedSharePointEnrichmentStatus = initialSharePointEnrichmentStatus;

    if (
      shouldAttemptSharePointUserEnrichment({
        authenticationRequired,
        detectedSharePointUrls,
        sharePointToken,
      })
    ) {
      const enrichment = await fetchSharePointEnrichmentWithUserToken({
        accessToken: sharePointToken as string,
        sharePointUrls: detectedSharePointUrls,
        fallbackMetadata: initialSharePointMetadata,
      });
      resolvedSharePointMetadata = enrichment.metadata;
      resolvedSharePointEnrichmentStatus = enrichment.status;
    }

    setParsedSolution(baseParsedSolution);
    setSharePointUrls(detectedSharePointUrls);
    setSharePointEnrichmentStatus(resolvedSharePointEnrichmentStatus);
    setSharePointMetadata(resolvedSharePointMetadata);

    return {
      parsedSolution: baseParsedSolution,
      sharePointDetected: hasDetectedSharePoint,
      sharePointUrls: detectedSharePointUrls,
      sharePointEnrichmentStatus: resolvedSharePointEnrichmentStatus,
      sharePointMetadata: resolvedSharePointMetadata,
      activeDatasetId,
      sharePointEnrichmentEnabled,
    };
  }

  useEffect(() => {
    if (!sharePointToken || !parsedSolution || sharePointUrls.length === 0) return;
    if (sharePointEnrichmentStatus !== "detected_requires_auth") return;

    let cancelled = false;

    void (async () => {
      await enrichExistingParsedSolutionWithSharePoint(sharePointToken);
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
  }, [
    parsedSolution,
    sharePointEnrichmentStatus,
    sharePointToken,
    sharePointUrls,
  ]);

  async function generateDocumentationFromParsedSolution(
    parsedSolution: ParsedSolutionResult,
    activeDatasetId: string,
    sharePointMetadataForGeneration: SharePointMetadata[] | null,
    onProgress?: (stage: string, percent: number) => void,
    outputTypeId?: string
  ) {
    onProgress?.("Generating documentation with AI...", 65);
    const modelForProvider = llmSelection.model;
    const solutionForGeneration = buildSolutionForGeneration(parsedSolution, sharePointMetadataForGeneration);
    const selectedOutputTypeSelectionId = resolveGenerationOutputTypeId(outputTypeId);

    // Extract user preferences from chat history
    const userPreferences = chat
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    // Use the currently loaded prompt text as the primary source, while preserving
    // the historical Documentation default composition for untouched default state.
    const activeOutputType = outputTypes.find((t) => t.id === selectedOutputTypeSelectionId);
    const baseSystemPrompt = (systemPrompt && systemPrompt.trim()) || undefined;
    const isDefaultSystemPrompt =
      baseSystemPrompt != null &&
      baseSystemPrompt.trim() === DEFAULT_SOLUTION_SYSTEM_PROMPT.trim();
    const isCustomSelection =
      selectedOutputTypeSelectionId === "custom" ||
      selectedOutputTypeSelectionId.startsWith("custom:");
    const effectiveSystemPrompt = activeOutputType?.kind === "custom"
      ? activeOutputType.promptText || activeOutputType.prompt || baseSystemPrompt || undefined
      : activeOutputType?.id === "documentation" && isDefaultSystemPrompt
        ? [baseSystemPrompt, activeOutputType.prompt].filter(Boolean).join("\n\n")
        : baseSystemPrompt || activeOutputType?.promptText || activeOutputType?.prompt || undefined;
    const generationSnapshot: GenerationSnapshot = {
      outputTypeId: activeOutputType?.id ?? selectedOutputTypeSelectionId,
      outputTypeTitle:
        activeOutputType?.title ??
        (isCustomSelection
          ? "Custom"
          : selectedOutputTypeSelectionId === "documentation"
            ? "Documentation"
            : selectedOutputTypeSelectionId),
      outputTypeKind:
        activeOutputType?.kind ?? (isCustomSelection ? "custom" : "builtin"),
      promptId:
        activeOutputType?.kind === "custom"
          ? activeOutputType.promptId ?? null
          : selectedOutputTypeSelectionId.startsWith("custom:")
            ? selectedOutputTypeSelectionId.slice("custom:".length)
            : null,
      promptNameSnapshot:
        activeOutputType?.promptName ??
        activeOutputType?.title ??
        (isCustomSelection
          ? "Custom"
          : selectedOutputTypeSelectionId === "documentation"
            ? "Documentation"
            : selectedOutputTypeSelectionId),
      promptTextSnapshot: effectiveSystemPrompt || null,
    };

    const genRes = await fetch("/api/generate-solution-docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        solution: solutionForGeneration,
        doc_type: "markdown",
        systemPrompt: effectiveSystemPrompt || undefined,
        output_type: selectedOutputTypeSelectionId,
        output_type_id: generationSnapshot.outputTypeId,
        output_type_title: generationSnapshot.outputTypeTitle,
        output_type_kind: generationSnapshot.outputTypeKind,
        prompt_id: generationSnapshot.promptId,
        prompt_name_snapshot: generationSnapshot.promptNameSnapshot,
        prompt_text_snapshot: generationSnapshot.promptTextSnapshot,
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
    return docResult as {
      documentation: string;
      output_type_id?: string | null;
      output_type_title?: string | null;
      output_type_kind?: string | null;
      prompt_id?: string | null;
      prompt_name_snapshot?: string | null;
      prompt_text_snapshot?: string | null;
    };
  }

  async function createSolutionOutput(
    parsedSolution: ParsedSolutionResult,
    generationResult: {
      documentation: string;
      output_type_id?: string | null;
      output_type_title?: string | null;
      output_type_kind?: string | null;
      prompt_id?: string | null;
      prompt_name_snapshot?: string | null;
      prompt_text_snapshot?: string | null;
    },
    outputTypeId?: string
  ) {
    const solutionName = parsedSolution.solution_name || "solution";
    const componentsCount = Array.isArray(parsedSolution.components) ? parsedSolution.components.length : 0;
    const selectedOutputTypeSelectionId = resolveGenerationOutputTypeId(outputTypeId);
    const activeOutputType = outputTypes.find((t) => t.id === selectedOutputTypeSelectionId);
    const outputLabel = buildOutputLabel(
      generationResult.output_type_title || activeOutputType?.title || activeOutputType?.id || "documentation"
    );
    const filename = `${solutionName}_${outputLabel}.pdf`;
    const metadata = `Version: ${parsedSolution.version || "N/A"} | Publisher: ${parsedSolution.publisher || "Unknown"} | Components: ${componentsCount}`;

    const pdfResponse = await fetch("/api/markdown-to-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: generationResult.documentation,
        title: `${solutionName} Documentation`,
        metadata,
      }),
    });

    if (!pdfResponse.ok) {
      const errorData = await pdfResponse.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to generate PDF");
    }

    const pdfData = await pdfResponse.json();
    const normalizedDocumentation =
      typeof pdfData.normalizedMarkdown === "string" ? pdfData.normalizedMarkdown : generationResult.documentation;
    const output: OutputFile = {
      id: `${filename}-${Date.now()}`,
      filename,
      bytesBase64: pdfData.pdfBase64,
      mime: "application/pdf",
      createdAt: Date.now(),
      htmlPreview: pdfData.html,
      markdownContent: normalizedDocumentation,
      outputTypeId: generationResult.output_type_id ?? selectedOutputTypeSelectionId,
      outputTypeTitle: generationResult.output_type_title ?? activeOutputType?.title ?? null,
      outputTypeKind: generationResult.output_type_kind ?? activeOutputType?.kind ?? null,
      promptId: generationResult.prompt_id ?? activeOutputType?.promptId ?? null,
      promptNameSnapshot: generationResult.prompt_name_snapshot ?? activeOutputType?.title ?? null,
      promptTextSnapshot: generationResult.prompt_text_snapshot ?? null,
    };
    upsertOutput(output);
    setSelectedOutputId(output.id);

    if (status === "authenticated" && session?.user) {
      const savedConversationId = await persistConversationDocument(
        {
          filename: output.filename,
          markdown: normalizedDocumentation,
          htmlPreview: output.htmlPreview || "",
          bytesBase64: output.bytesBase64 || "",
          mime: output.mime,
        },
        undefined,
        {
          outputTypeId: output.outputTypeId,
          outputTypeTitle: output.outputTypeTitle,
          outputTypeKind: output.outputTypeKind,
          promptId: output.promptId,
          promptNameSnapshot: output.promptNameSnapshot,
          promptTextSnapshot: output.promptTextSnapshot,
        }
      );
      if (savedConversationId !== conversationIdRef.current) {
        applyConversationId(savedConversationId);
      }
    }

    if (chat.length > 0) {
      const successId = createMessageId();
      setChat((c) => [
        ...c,
        {
          id: successId,
          role: "assistant",
          content: `Document regenerated successfully as ${activeOutputType ? activeOutputType.title : "PDF"}. Your preferences have been applied. Check the Output Files panel to view the updated output.`,
        },
      ]);
    }
  }

  async function generateDocs(overrideOutputTypeId?: string) {
    if (generating || files.length === 0 || !files.every((f) => f.name.toLowerCase().endsWith(".zip")) || !hasSolutionFile()) return;
    setGenerating(true);
    setGenerateError(null);
    setGenerateProgress(hasSolutionFile() ? { stage: "Starting...", percent: 0 } : { stage: "Generating...", percent: 0 });

    try {
      if (hasSolutionFile()) {
        const {
          parsedSolution,
          sharePointDetected: solutionSharePointDetected,
          sharePointEnrichmentStatus: solutionSharePointEnrichmentStatus,
          sharePointMetadata: parsedSharePointMetadata,
          activeDatasetId,
          sharePointEnrichmentEnabled,
        } = await runBaseSolutionParse((stage, percent) =>
          setGenerateProgress({ stage, percent })
        );

        const sharepointRefs = Array.isArray(parsedSolution?.sharepointRefs)
          ? parsedSolution.sharepointRefs
          : [];

        if (
          sharePointEnrichmentEnabled &&
          solutionSharePointDetected &&
          sharepointRefs.length > 0 &&
          solutionSharePointEnrichmentStatus !== "available"
        ) {
          setGenerateProgress({
            stage: "SharePoint references detected - continuing with base documentation",
            percent: 55,
          });
        }


        const generationResult = await generateDocumentationFromParsedSolution(
          parsedSolution,
          activeDatasetId,
          parsedSharePointMetadata,
          (stage, percent) => setGenerateProgress({ stage, percent }),
          overrideOutputTypeId
        );
        await createSolutionOutput(parsedSolution, generationResult, overrideOutputTypeId);
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
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = output.filename || "output.pdf";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(url);
    }
  }

  useEffect(() => {
    const out = getSelectedOutput();
    if (previewBlobUrlRef.current) {
      if (typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(previewBlobUrlRef.current);
      }
      previewBlobUrlRef.current = null;
    }
    setPdfRenderError(null);
    if (!out || !out.bytesBase64) return;
    const blobUrl = makeBlobUrl(out.bytesBase64, out.mime);
    if (!blobUrl) return;
    previewBlobUrlRef.current = blobUrl;

    return () => {
      if (previewBlobUrlRef.current) {
        if (typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(previewBlobUrlRef.current);
        }
        previewBlobUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOutputId, outputs]);

  async function send(textParam?: string) {
    const text = (textParam ?? message).trim();
    if (!text || loading) return;

    const hasSolutionPendingIngestion =
      files.some((f) => !!f.file && f.name.toLowerCase().endsWith(".zip")) &&
      !solutionIngestSignature &&
      corpusType === null;
    const hasDocsPendingIngestion =
      files.some((f) => f.isText && typeof f.text === "string") &&
      !docsIngestSignature &&
      corpusType === null;
    if (hasSolutionPendingIngestion || hasDocsPendingIngestion) {
      setChat((c) => [
        ...c,
        { id: createMessageId(), role: "user", content: text },
        {
          id: createMessageId(),
          role: "assistant",
          content: "Files are still being ingested. Please wait a few seconds and try again.",
          sources: [],
        },
      ]);
      setMessage("");
      return;
    }

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
      const currentSession = await getSession();
      let activeConversationIdForSave: string | null = conversationIdRef.current;
      if (currentSession?.user && !activeConversationIdForSave) {
        activeConversationIdForSave = await createConversationSession();
      }

      // Always use FREE RAG mode - queries Qdrant for context
      const modelForProvider = llmSelection.model;
      const focusFiles = getFocusFiles(text, files);

      // Send conversation history for context
      const conversationHistory = chat.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const lowerText = text.toLowerCase();
      const explicitOutputTypeChange = resolveChatOutputTypeChange(text, outputTypes);

      let ragData: { answer?: string; sources?: ChatMessage["sources"] } = { answer: "", sources: [] };
      if (!explicitOutputTypeChange) {
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

        ragData = await ragRes.json();
      }

      const sources = Array.isArray(ragData.sources) ? ragData.sources : [];
      const matchedOutputType = explicitOutputTypeChange
        ? null
        : outputTypes.find((t) => t.keywords.some((kw) => lowerText.includes(kw.toLowerCase())));
      if (matchedOutputType && matchedOutputType.id !== selectedOutputTypeId) {
        void persistSelectedOutputType(matchedOutputType.id);
      }
      if (explicitOutputTypeChange?.outputType && explicitOutputTypeChange.outputType.id !== selectedOutputTypeId) {
        void persistSelectedOutputType(explicitOutputTypeChange.outputType.id);
      }

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
      const shouldRegenerate = explicitOutputTypeChange
        ? explicitOutputTypeChange.shouldGenerate
        : regenerateKeywords.some(keyword => lowerText.includes(keyword)) ||
          documentModificationPatterns.some(pattern => pattern.test(lowerText));

      // If this is a regeneration request, override the assistant's response
      let assistantMessage = ragData.answer || "No response";
      if (explicitOutputTypeChange && !explicitOutputTypeChange.outputType) {
        assistantMessage =
          explicitOutputTypeChange.errorMessage ||
          buildUnknownChatOutputTypeMessage(explicitOutputTypeChange.target, outputTypes);
      } else if (explicitOutputTypeChange?.outputType && shouldRegenerate && hasSolutionFile()) {
        assistantMessage = `🔄 Changing output file type to ${explicitOutputTypeChange.outputType.title} and regenerating document... This will take a moment.`;
      } else if (explicitOutputTypeChange?.outputType && shouldRegenerate && !hasSolutionFile()) {
        assistantMessage = `I changed the output file type to ${explicitOutputTypeChange.outputType.title}, but I need a Power Platform solution .zip before I can generate the document.`;
      } else if (shouldRegenerate && hasSolutionFile() && outputs.length > 0) {
        assistantMessage = "🔄 Regenerating document with your preferences... This will take a moment.";
      } else if (explicitOutputTypeChange?.outputType) {
        assistantMessage = `Changed output file type to ${explicitOutputTypeChange.outputType.title}.`;
      }

      const assistantSources: ChatMessage["sources"] = explicitOutputTypeChange
        ? []
        : shouldRegenerate
          ? []
          : sources;

      // Update the assistant message with appropriate response
      setChat((c) =>
        c.map((m) =>
          m.id === assistantId
            ? { ...m, content: assistantMessage, sources: assistantSources }
            : m
        )
      );
      // Persist this exchange when user is signed in
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
              conversation_id: activeConversationIdForSave ?? undefined,
              dataset_id: activeDatasetId,
              customer_name: customerName.trim() || undefined,
              messages: toSave,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.conversation_id) {
              applyConversationId(data.conversation_id);
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
      if (explicitOutputTypeChange?.outputType && shouldRegenerate && hasSolutionFile()) {
        // Automatically regenerate documentation with the selected output type from chat
        setTimeout(() => {
          void generateDocs(explicitOutputTypeChange.outputType?.id);
        }, 500); // Small delay to let chat update first
        // Don't set loading to false - generateDocs will handle it
        return;
      }
      if (!explicitOutputTypeChange && shouldRegenerate && hasSolutionFile() && outputs.length > 0) {
        // Automatically regenerate documentation with current chat context
        setTimeout(() => {
          void generateDocs(matchedOutputType?.id);
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
      setLoadedCustomerName(data.customer_name || "");
      setCustomerName("");
      applyConversationId(data.id);
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

      setCustomerName("");
      setLoadedCustomerName(trimmedCustomer || "");
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

  async function persistSelectedOutputType(nextOutputTypeId: string) {
    const selectedChoice = outputTypes.find((entry) => entry.id === nextOutputTypeId) || null;
    setSelectedOutputTypeId(nextOutputTypeId);
    selectedOutputTypeIdRef.current = nextOutputTypeId;

    if (!selectedChoice) {
      return;
    }

    const nextPromptText = selectedChoice.promptText || selectedChoice.prompt || "";
    setSystemPrompt(nextPromptText);

    if (typeof window !== "undefined" && status !== "authenticated") {
      try {
        sessionStorage.setItem("systemPrompt", nextPromptText);
      } catch {
        /* ignore */
      }
      return;
    }

    if (status === "authenticated" && session?.user) {
      try {
        const payload: Record<string, unknown> = {
          provider,
          model: selectedModel || null,
        };
        if (selectedChoice.kind === "custom" && selectedChoice.promptId) {
          payload.selectedPromptId = selectedChoice.promptId;
        } else {
          payload.systemPrompt = nextPromptText;
        }

        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error(await res.text());
        }
      } catch {
        // Keep the local selection in sync even if persistence fails.
      }
    }
  }

  const statusProvider = provider === "cloud" ? "Cloud" : "Local";
  const statusModel = provider === "cloud" ? (selectedModel || "default") : (localModel || "default");
  const llmSelection = {
    provider,
    model: provider === "cloud" ? selectedModel || undefined : localModel || undefined,
  };
  const hasFiles = files.length > 0;
  const hasInvalidSelectedFiles = hasInvalidSelectedFilesInState(files);
  const hasOnlyZipFiles = hasFiles && files.every((f) => f.name.toLowerCase().endsWith(".zip"));
  const hasSolution = hasSolutionFile();
  const hasOnlyNonSolution = hasFiles && (!hasOnlyZipFiles || !hasSolution);
  const uploadType = uploadClassification?.type || null;
  const uploadReason = uploadClassification?.reason || null;
  const hasInvalidZip = uploadType === "unsupported" && files.some((f) => f.name.toLowerCase().endsWith(".zip"));
  const canGenerate = canGenerateSolutionDocs({ files, uploadClassification, generating });
  const invalidStateMessage = hasInvalidSelectedFiles
    ? "Remove the invalid file before uploading more files or generating documentation."
    : null;
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
            sharePointToken={sharePointToken}
            setSharePointToken={setSharePointToken}
            systemPrompt={systemPrompt}
            setSystemPrompt={setSystemPrompt}
            systemPromptDefault={DEFAULT_SOLUTION_SYSTEM_PROMPT}
          />
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>
            Documentation <span style={{ display: "inline", color: "var(--border)" }}>Generator</span>
          </h1>
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
                  {ragStatus.status === "ready" ? "Online" : "Degraded"} • Qdrant: {ragStatus.chunks_indexed} chunks • Provider: {statusProvider} ({statusModel})
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
          uploadDisabled={hasInvalidSelectedFiles}
          disabledMessage={invalidStateMessage}
        />
        </section>

        <section className="panel">
          <div className="panel-header">Chat</div>

          {status === "authenticated" && conversationList.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--muted)" }}>Past conversations</div>
              <div style={{ overflowX: "hidden" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto", overflowX: "hidden" }}>
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
                          background: "var(--panel-bg)",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          minWidth: 0,
                          maxHeight: 80,
                          minHeight: 0,
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            minHeight: 0,
                            overflowY: "auto",
                            overflowX: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              color: "var(--foreground)",
                              wordBreak: "break-word",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {isTitlePrefixedByCustomer ? titleLabel : customerLabel}
                          </div>
                        </div>
                        {!isTitlePrefixedByCustomer && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--foreground)",
                              marginTop: 4,
                              flexShrink: 0,
                              wordBreak: "break-word",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {titleLabel}
                          </div>
                        )}
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
                          background: "var(--panel-bg)",
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
            </div>
          )}

          {status === "authenticated" && (
            <div style={{ marginBottom: 12, display: "grid", gap: 6 }}>
              <label htmlFor="customer-name" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
                Customer name
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <textarea
                  id="customer-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={loadedCustomerName || "e.g. Acme Corp"}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    background: "var(--panel-bg)",
                    color: "var(--foreground)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                    maxHeight: 60,
                    overflowY: "auto",
                    overflowX: "hidden",
                    fontFamily: "inherit",
                    resize: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (status === "authenticated" && !conversationId) {
                      // Create a new conversation with the customer name
                      try {
                        await createConversationSession();
                      } catch {
                        // If creation fails, fall back to starting a new chat
                        startNewChat({ clearCustomerName: true });
                      }
                    } else {
                      // If already in a conversation or not signed in, start a new chat
                      startNewChat({ clearCustomerName: true });
                    }
                  }}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--panel-bg)",
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
                    background: conversationId ? "var(--panel-bg)" : "var(--panel-bg)",
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
              setChat([]);
              setMessage("");
              setCustomerName("");
              setExpandedSources({});
              setGenerateError(null);
              setGenerateProgress(null);
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
            <div style={{ marginBottom: 10 }}>
              <OutputTypeSelector
                outputTypes={outputTypes}
                selectedOutputTypeId={selectedOutputTypeId}
                onSelect={(nextOutputTypeId) => {
                  void persistSelectedOutputType(nextOutputTypeId);
                }}
                loading={outputTypesLoading}
                error={outputTypesError}
                showEmptyState={status === "authenticated"}
              />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              <button
                onClick={() => void generateDocs(selectedOutputTypeIdRef.current)}
                disabled={!canGenerate}
                style={{
                  flex: "0 0 auto",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: hasSolution ? "1px solid var(--border)" : "1px solid var(--border)",
                  background: generating ? "#727476" : hasSolution ? "var(--panel-bg)" : "var(--panel-bg)",
                  color: "var(--foreground)",
                  cursor: !canGenerate ? "not-allowed" : "pointer",
                  opacity: !canGenerate ? 0.7 : 1,
                }}
              >
                  {generating 
                    ? (hasSolution ? "Parsing & Generating..." : "Generating...") 
                    : (hasSolution ? "Parse & Generate Docs" : "Generate Documentation")}
              </button>
              <div style={{ fontSize: 12, color: "#555", flex: "1 1 180px", minWidth: 0, overflowWrap: "anywhere" }}>
              {hasInvalidZip
                ? "Only .zip solution files are supported for solution documentation."
                : hasInvalidSelectedFiles
                ? "Remove the invalid file before continuing."
                : !hasFiles
                ? "Upload a .zip solution file to enable generation."
                : hasSolution
                ? "Will parse solution with PAC CLI, then generate docs with RAG pipeline."
                : "Upload a valid Power Platform solution .zip to enable generation."}
              </div>
            </div>
            {generateProgress && (
              <div style={{ marginTop: 10, marginBottom: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12, color: "var(--muted)" }}>
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
              {hasInvalidSelectedFiles
                ? "Remove the invalid file before continuing."
                : "Upload a valid Power Platform solution .zip to continue."}
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
