import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8001";

type RouteError = {
  code: string;
  message: string;
  hint?: string;
};

// Configure route for long-running operations
export const maxDuration = 900; // 15 minutes

export async function POST(req: Request) {
  try {
    // Get the form data with the ZIP file
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const datasetId = formData.get("dataset_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!datasetId) {
      return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "Only .zip solution files are supported." }, { status: 400 });
    }

    // Forward the ZIP file directly to the backend for full ingestion
    // This will parse ALL files in the ZIP and create embeddings (FREE with Sentence-BERT)
    const backendFormData = new FormData();
    backendFormData.append("file", file);
    if (datasetId) {
      backendFormData.append("dataset_id", datasetId);
    }

    // Set 15-minute timeout for large ZIP ingestion
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);

    const response = await fetch(`${RAG_BACKEND_URL}/rag/ingest-solution`, {
      method: "POST",
      body: backendFormData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await readRouteError(response, "Failed to ingest solution");
      return NextResponse.json(
        { ok: false, error },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Ingest ZIP error:", error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

async function readRouteError(response: Response, fallbackMessage: string): Promise<RouteError> {
  const fallback: RouteError = {
    code: "PARSE_FAILED",
    message: fallbackMessage,
  };

  const raw = await response.text();
  if (!raw.trim()) {
    return fallback;
  }

  try {
    return normalizeRouteError(JSON.parse(raw), fallback);
  } catch {
    return {
      ...fallback,
      message: raw,
    };
  }
}

function normalizeRouteError(value: unknown, fallback: RouteError): RouteError {
  if (typeof value === "string") {
    return {
      ...fallback,
      message: value || fallback.message,
    };
  }

  if (typeof value !== "object" || value === null) {
    return fallback;
  }

  const payload = value as Record<string, unknown>;
  const nestedError = payload.error;

  if (typeof nestedError === "object" && nestedError !== null) {
    const nested = nestedError as Record<string, unknown>;
    return {
      code: typeof nested.code === "string" && nested.code ? nested.code : fallback.code,
      message: typeof nested.message === "string" && nested.message ? nested.message : fallback.message,
      hint: typeof nested.hint === "string" && nested.hint ? nested.hint : undefined,
    };
  }

  if (typeof nestedError === "string" && nestedError.trim()) {
    return {
      ...fallback,
      message: nestedError,
    };
  }

  if (typeof payload.code === "string" && typeof payload.message === "string") {
    return {
      code: payload.code,
      message: payload.message,
      hint: typeof payload.hint === "string" && payload.hint ? payload.hint : undefined,
    };
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    return {
      ...fallback,
      message: payload.message,
    };
  }

  return fallback;
}
