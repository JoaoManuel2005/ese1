import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { getRuntimeConfig } from "../../../lib/runtimeConfig";
import { getUserSystemPrompt } from "../../../lib/userSettings";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8001";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const runtimeConfig = await getRuntimeConfig();
    const apiKey = runtimeConfig.openaiApiKey || body?.api_key || undefined;
    const endpoint = runtimeConfig.azureOpenAiEndpoint || body?.endpoint || undefined;

    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?? null;
    const systemPromptFromDb = userId ? getUserSystemPrompt(userId) : null;
    const systemPrompt =
      (typeof body?.systemPrompt === "string" && body.systemPrompt.trim().length > 0)
        ? body.systemPrompt.trim()
        : (systemPromptFromDb != null && systemPromptFromDb.length > 0)
          ? systemPromptFromDb
          : undefined;

    const source = (typeof body?.systemPrompt === "string" && body.systemPrompt.trim().length > 0) ? "body" : (systemPromptFromDb ? "db" : "none");
    console.log("[generate-solution-docs] systemPrompt source=%s length=%s", source, systemPrompt != null ? systemPrompt.length : "null");

    const payload = {
      ...body,
      api_key: apiKey,
      endpoint: endpoint,
      systemPrompt,
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
