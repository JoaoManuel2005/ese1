export function createDatasetId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function mapProviderError(msg: string, status?: number) {
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

export function parseApiError(payload: any, fallback: string) {
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

const DEFAULT_UPLOAD_ERROR_MESSAGE =
  "This .zip file does not appear to be a valid Power Platform solution export. Please choose another file.";
const GENERIC_UPLOAD_ERROR_MESSAGE =
  "We couldn't validate this .zip file. Please choose another file.";

function looksLikeJsonish(message: string) {
  const trimmed = message.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function mapUploadErrorMessage(error: { code?: string; message?: string; hint?: string } | null | undefined) {
  switch (error?.code) {
    case "INVALID_SOLUTION_ZIP":
      return DEFAULT_UPLOAD_ERROR_MESSAGE;
    case "INVALID_INPUT":
      return "Only .zip solution files are supported. Please choose a Power Platform solution export.";
    default: {
      const message = typeof error?.message === "string" ? error.message.trim() : "";
      if (message && !looksLikeJsonish(message)) {
        return message;
      }
      return GENERIC_UPLOAD_ERROR_MESSAGE;
    }
  }
}
