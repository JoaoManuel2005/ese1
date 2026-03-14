import { NextResponse } from "next/server";
import { validateSolutionZip } from "../../../lib/validateSolutionZip";
import { isSharePointEnrichmentEnabled } from "../../../lib/featureFlags";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8001";

type ParsedSolutionPayload = Record<string, unknown>;
type SharePointEnrichmentStatus = "not_needed" | "detected_requires_auth" | "disabled" | "available" | "failed";

type BackendParseSolutionEnvelope = {
  data: ParsedSolutionPayload;
  authenticationRequired?: boolean;
  sharePointUrls?: string[];
  sharePointEnrichmentStatus?: SharePointEnrichmentStatus;
  message?: string;
};

type ParseSolutionApiSuccess = {
  ok: true;
  data: ParsedSolutionPayload;
  authenticationRequired: boolean;
  sharePointUrls: string[];
  sharePointEnrichmentStatus: SharePointEnrichmentStatus;
  message?: string;
  sharePointEnrichmentEnabled: boolean;
};

function normalizeSharePointEnrichmentStatus(value: unknown): SharePointEnrichmentStatus {
  switch (value) {
    case "detected_requires_auth":
    case "disabled":
    case "available":
    case "failed":
      return value;
    default:
      return "not_needed";
  }
}

function isBackendParseSolutionEnvelope(value: unknown): value is BackendParseSolutionEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof (value as { data?: unknown }).data === "object" &&
    (value as { data?: unknown }).data !== null
  );
}

function normalizeParseSolutionResponse(payload: unknown): ParseSolutionApiSuccess {
  const sharePointEnrichmentEnabled = isSharePointEnrichmentEnabled();

  if (isBackendParseSolutionEnvelope(payload)) {
    return {
      ok: true,
      data: payload.data,
      authenticationRequired: Boolean(payload.authenticationRequired),
      sharePointUrls: Array.isArray(payload.sharePointUrls)
        ? payload.sharePointUrls.filter((url): url is string => typeof url === "string")
        : [],
      sharePointEnrichmentStatus: normalizeSharePointEnrichmentStatus(payload.sharePointEnrichmentStatus),
      message: typeof payload.message === "string" ? payload.message : undefined,
      sharePointEnrichmentEnabled,
    };
  }

  return {
    ok: true,
    data: typeof payload === "object" && payload !== null ? (payload as ParsedSolutionPayload) : {},
    authenticationRequired: false,
    sharePointUrls: [],
    sharePointEnrichmentStatus: "not_needed",
    sharePointEnrichmentEnabled,
  };
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return jsonError(
        "INVALID_INPUT",
        "Only .zip solution files are supported.",
        "Upload a Power Platform solution .zip file."
      );
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      return jsonError(
        "INVALID_INPUT",
        "Only .zip solution files are supported.",
        "Upload a Power Platform solution .zip file."
      );
    }

    const zipCheck = await validateSolutionZip(file);
    if (!zipCheck.ok) {
      return jsonError(
        "INVALID_SOLUTION_ZIP",
        "Zip does not look like a Power Platform solution export.",
        "Export a solution from Power Platform and upload the .zip."
      );
    }

    // Forward to Python backend
    const backendFormData = new FormData();
    backendFormData.append("file", file);

    const response = await fetch(`${RAG_BACKEND_URL}/parse-solution`, {
      method: "POST",
      body: backendFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "PARSE_FAILED",
            message: errorText || "Failed to parse solution",
          },
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(normalizeParseSolutionResponse(data));
  } catch (error: any) {
    console.error("Parse solution error:", error);
    return jsonError("SERVER_ERROR", error?.message || "Internal server error", undefined, 500);
  }
}

function jsonError(code: string, message: string, hint?: string, status = 400) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(hint ? { hint } : {}),
      },
    },
    { status }
  );
}
