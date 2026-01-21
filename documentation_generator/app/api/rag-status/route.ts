import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8000";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const datasetId = url.searchParams.get("dataset_id");
    const backendUrl = datasetId
      ? `${RAG_BACKEND_URL}/rag/status?dataset_id=${encodeURIComponent(datasetId)}`
      : `${RAG_BACKEND_URL}/rag/status`;
    const res = await fetch(backendUrl);
    
    if (!res.ok) {
      return NextResponse.json(
        { status: "error", error: "RAG backend not available" },
        { status: 503 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);

  } catch (error: any) {
    return NextResponse.json(
      { status: "error", error: error?.message || "RAG backend not available" },
      { status: 503 }
    );
  }
}
