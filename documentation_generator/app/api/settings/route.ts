import { NextResponse } from "next/server";
import { getRuntimeConfig, maskApiKey, setRuntimeConfig } from "../../../lib/runtimeConfig";

function buildPublicConfig(config: Awaited<ReturnType<typeof getRuntimeConfig>>) {
  return {
    provider: config.provider ?? null,
    model: config.model ?? null,
    azureOpenAiEndpoint: config.azureOpenAiEndpoint ?? null,
    openaiApiKeyConfigured: !!config.openaiApiKey,
    openaiApiKeyMasked: maskApiKey(config.openaiApiKey),
  };
}

export async function GET() {
  try {
    const config = await getRuntimeConfig();
    return NextResponse.json(buildPublicConfig(config));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid settings payload." },
        { status: 400 }
      );
    }
    const endpoint = body?.azureOpenAiEndpoint;

    if (typeof endpoint === "string" && endpoint.trim().length > 0) {
      try {
        new URL(endpoint);
      } catch {
        return NextResponse.json(
          { error: "Invalid Azure OpenAI endpoint. Provide a valid URL." },
          { status: 400 }
        );
      }
    }

    const updates: {
      provider?: "cloud" | "local" | null;
      model?: string | null;
      openaiApiKey?: string | null;
      azureOpenAiEndpoint?: string | null;
    } = {};

    if ("provider" in body) updates.provider = body.provider;
    if ("model" in body) updates.model = body.model;
    if ("openaiApiKey" in body) updates.openaiApiKey = body.openaiApiKey;
    if ("azureOpenAiEndpoint" in body) updates.azureOpenAiEndpoint = body.azureOpenAiEndpoint;

    const config = await setRuntimeConfig(updates);
    return NextResponse.json(buildPublicConfig(config));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to save settings" },
      { status: 500 }
    );
  }
}
