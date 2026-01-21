import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const response = await fetch(`${RAG_BACKEND_URL}/health`);
    
    if (!response.ok) {
      return NextResponse.json(
        { status: "unhealthy", error: "Backend not responding" },
        { status: 503 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { status: "unhealthy", error: "Backend not available" },
      { status: 503 }
    );
  }
}
