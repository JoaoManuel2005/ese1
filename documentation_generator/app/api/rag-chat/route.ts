import { NextResponse } from "next/server";
import { formatSources } from "../../../lib/formatSources";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8000";

export async function POST(req: Request) {
  try {
    const { message, provider, model, dataset_id: datasetId, focus_files: focusFiles, conversation_history: conversationHistory } = await req.json();
    if (!datasetId) {
      return NextResponse.json(
        { error: "No dataset selected. Upload files and try again." },
        { status: 400 }
      );
    }

    // Use FREE RAG retrieval - no OpenAI API key needed!
    const ragRes = await fetch(`${RAG_BACKEND_URL}/rag/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: message,
        n_results: 5,
        provider,
        model,
        dataset_id: datasetId,
        focus_files: focusFiles,
        conversation_history: conversationHistory,
      }),
    });

    if (!ragRes.ok) {
      const errorText = await ragRes.text();
      let parsed: any = {};
      try {
        parsed = JSON.parse(errorText);
      } catch {
        parsed = {};
      }
      return NextResponse.json(
        { error: parsed?.error || parsed?.detail || errorText || "RAG retrieval failed" },
        { status: ragRes.status }
      );
    }

    const ragData = await ragRes.json();

    const question = typeof message === "string" ? message : "";
    const sources = formatSources(ragData?.chunks || []);

    const mentionedFile = extractMentionedFilename(question);
    if (mentionedFile && !sourceMatchesFile(sources, mentionedFile)) {
      return NextResponse.json({
        answer: `I don't see ${mentionedFile} in the uploaded files. Upload it or select it.`,
        sources: [],
        chunks_found: 0,
        mode: "rag",
      });
    }

    if (ragData.chunks_found === 0) {
      return NextResponse.json({
        answer:
          ragData.answer ||
          "No relevant information found in the knowledge base. Please upload and ingest documents first.",
        sources: [],
        chunks_found: 0,
        mode: "rag",
      });
    }

    // Use the natural language answer from the backend if available
    let answer = ragData.answer || "No response";
    answer = stripSourcesSection(answer);

    return NextResponse.json({
      answer,
      sources,
      chunks_found: ragData.chunks_found,
      mode: "rag",
    });

  } catch (error: any) {
    console.error("RAG Chat error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

function stripSourcesSection(text: string) {
  if (!text) return "";
  const match = text.match(/(^|\n)\s*(sources|evidence|citations)\s*[:\-]/i);
  if (!match || match.index === undefined) return text.trim();
  return text.slice(0, match.index).trim();
}

function extractMentionedFilename(message: string) {
  const match = message.match(/\b[\w.-]+\.[a-z0-9]{1,8}\b/i);
  return match?.[0];
}

function sourceMatchesFile(
  sources: Array<{ label: string; path: string }>,
  filename: string
) {
  const target = filename.toLowerCase();
  return sources.some((source) => source.path.toLowerCase().includes(target));
}
