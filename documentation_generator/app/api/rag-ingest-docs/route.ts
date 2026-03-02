import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8001";

type IncomingFile = {
  name: string;
  text: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const files: IncomingFile[] = Array.isArray(body?.files) ? body.files : [];
    const datasetId = body?.dataset_id as string | undefined;
    if (!datasetId) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "MISSING_DATASET",
            message: "dataset_id is required for ingestion.",
          },
        },
        { status: 400 }
      );
    }

    const chunks = files
      .filter((file) => typeof file?.text === "string" && file.text.trim().length > 0)
      .map((file) => {
        const ext = extensionOf(file.name);
        const content = `File: ${file.name}\n\n${file.text.slice(0, 8000)}`;
        return {
          content,
          metadata: {
            source: file.name,
            file_name: file.name,
            kind: "doc",
            file_type: ext,
          },
        };
      });

    if (!chunks.length) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "NO_CONTENT",
            message: "No text content to ingest.",
            hint: "Upload txt, md, or json files with readable text.",
          },
        },
        { status: 400 }
      );
    }

    const res = await fetch(`${RAG_BACKEND_URL}/rag/ingest-chunks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks, dataset_id: datasetId, dataset_mode: "generic" }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INGEST_FAILED",
            message: data?.detail || data?.error || "Failed to ingest documents.",
          },
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      ok: true,
      ...data,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "SERVER_ERROR",
          message: error?.message || "Internal server error",
        },
      },
      { status: 500 }
    );
  }
}

function extensionOf(name: string) {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx).toLowerCase();
}
