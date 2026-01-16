import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${RAG_BACKEND_URL}/rag/status`);
    
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
