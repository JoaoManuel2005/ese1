import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8001";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const datasetId = url.searchParams.get("dataset_id");
    if (!datasetId) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "dataset_id is required." } },
        { status: 400 }
      );
    }

    const res = await fetch(`${RAG_BACKEND_URL}/rag/list-docs?dataset_id=${encodeURIComponent(datasetId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: { code: "LIST_FAILED", message: data?.detail || "Failed to list documents." } },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: { code: "SERVER_ERROR", message: error?.message || "Internal server error" } },
      { status: 500 }
    );
  }
}
