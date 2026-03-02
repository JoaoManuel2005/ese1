import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8001";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const datasetId = body?.dataset_id;
    if (!datasetId) {
      return NextResponse.json(
        { ok: false, error: { code: "MISSING_DATASET", message: "dataset_id is required." } },
        { status: 400 }
      );
    }

    const res = await fetch(`${RAG_BACKEND_URL}/rag/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: { code: "RESET_FAILED", message: data?.detail || "Failed to reset dataset." } },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true, ...data });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: { code: "SERVER_ERROR", message: error?.message || "Internal server error" } },
      { status: 500 }
    );
  }
}
