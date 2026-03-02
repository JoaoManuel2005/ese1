import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8001";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const datasetId = body?.dataset_id;
    const fileNames = Array.isArray(body?.file_names) ? body.file_names : [];
    if (!datasetId || fileNames.length === 0) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "dataset_id and file_names are required." } },
        { status: 400 }
      );
    }

    const res = await fetch(`${RAG_BACKEND_URL}/rag/delete-docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, file_names: fileNames }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: { code: "DELETE_FAILED", message: data?.detail || "Failed to delete documents." } },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: { code: "SERVER_ERROR", message: error?.message || "Internal server error" } },
      { status: 500 }
    );
  }
}
