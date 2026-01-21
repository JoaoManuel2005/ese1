import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8000";

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
      return NextResponse.json({ error: "File must be a .zip solution file" }, { status: 400 });
    }

    // Forward the ZIP file directly to the backend for full ingestion
    // This will parse ALL files in the ZIP and create embeddings (FREE with Sentence-BERT)
    const backendFormData = new FormData();
    backendFormData.append("file", file);
    if (datasetId) {
      backendFormData.append("dataset_id", datasetId);
    }

    const response = await fetch(`${RAG_BACKEND_URL}/rag/ingest-solution`, {
      method: "POST",
      body: backendFormData,
    });

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
