import { NextResponse } from "next/server";
import { getRuntimeConfig } from "../../../lib/runtimeConfig";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8001";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const runtimeConfig = await getRuntimeConfig();
    const apiKey = runtimeConfig.openaiApiKey || body?.api_key || undefined;
    const endpoint = runtimeConfig.azureOpenAiEndpoint || body?.endpoint || undefined;

    const payload = {
      ...body,
      api_key: apiKey,
      endpoint: endpoint,
    };

    const response = await fetch(`${RAG_BACKEND_URL}/generate-documentation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsed: any = {};
      try {
        parsed = JSON.parse(errorText);
      } catch {
        parsed = {};
      }
      const message = parsed?.error || parsed?.detail?.message || parsed?.detail || errorText || "Failed to generate documentation";
      return NextResponse.json(
        { error: message },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Generate documentation error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
