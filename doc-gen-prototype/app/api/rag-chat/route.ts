import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8000";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    // Use FREE RAG retrieval - no OpenAI API key needed!
    const ragRes = await fetch(`${RAG_BACKEND_URL}/rag/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: message,
        n_results: 5,
      }),
    });

    if (!ragRes.ok) {
      const errorText = await ragRes.text();
      return NextResponse.json(
        { error: `RAG retrieval failed: ${errorText}` },
        { status: ragRes.status }
      );
    }

    const ragData = await ragRes.json();
    
    if (ragData.chunks_found === 0) {
      return NextResponse.json({
        answer: "No relevant information found in the knowledge base. Please upload and ingest a Power Platform solution first.",
        citations: [],
        chunks_found: 0,
        mode: "rag"
      });
    }

    // Use the natural language answer from the backend if available
    let answer = ragData.answer;
    
    // Fallback to showing chunks if no answer generated
    if (!answer) {
      answer = "Here's what I found:\n\n";
      ragData.chunks.forEach((chunk: any, index: number) => {
        const preview = chunk.content.length > 300 
          ? chunk.content.substring(0, 300) + "..." 
          : chunk.content;
        answer += `**Source ${index + 1}: ${chunk.source}**\n${preview}\n\n`;
      });
    }
    
    // Add sources section
    answer += "\n\n**Sources:**\n";
    ragData.chunks.forEach((chunk: any, index: number) => {
      answer += `- ${chunk.source} (${chunk.relevance}% relevance)\n`;
    });
    
    const citations = ragData.chunks.map((chunk: any) => ({
      metadata: { source: chunk.source },
      relevance: chunk.relevance,
      preview: chunk.content.substring(0, 200) + "...",
    }));

    return NextResponse.json({
      answer,
      citations,
      chunks_found: ragData.chunks_found,
      mode: "rag"
    });

  } catch (error: any) {
    console.error("RAG Chat error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
