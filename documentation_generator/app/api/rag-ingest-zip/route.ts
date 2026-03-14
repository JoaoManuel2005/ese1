import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8001";

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
      const errorText = await response.text();
      return NextResponse.json(
        { error: errorText || "Failed to ingest solution" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("Ingest ZIP error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
