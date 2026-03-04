import { NextResponse } from "next/server";
import { getRuntimeConfig } from "../../../lib/runtimeConfig";

export async function GET(req: Request) {
  try {
    const runtimeConfig = await getRuntimeConfig();
    const apiKey =
      runtimeConfig.openaiApiKey ||
      req.headers.get("x-openai-api-key") ||
      process.env.OPENAI_API_KEY;
    const endpoint =
      runtimeConfig.azureOpenAiEndpoint ||
      req.headers.get("x-azure-openai-endpoint") ||
      process.env.AZURE_OPENAI_ENDPOINT;
    
    if (!apiKey || endpoint) {
      // Return default models if no API key
      return NextResponse.json({ 
        models: ["gpt-4.1", "gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
        message: endpoint
          ? "Using default models. Azure endpoints do not support model listing."
          : "Using default models. Add API key for full list."
      });
    }

    const res = await fetch("https://api.openai.com/v1/models", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { models: ["gpt-4.1", "gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"], error: text || "Failed to fetch models" },
        { status: 200 }
      );
    }

    const data = await res.json();
    // Filter to only show GPT models
    const models = Array.isArray(data?.data)
      ? data.data
          .map((m: any) => m?.id)
          .filter((id: string) => id && (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3")))
          .sort()
      : ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"];

    return NextResponse.json({ models });
  } catch (e: any) {
    return NextResponse.json(
      { models: ["gpt-4.1", "gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"], error: e?.message ?? "Failed to fetch models" },
      { status: 200 }
    );
  }
}
