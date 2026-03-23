import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { getRuntimeConfig, setRuntimeConfig } from "../../../lib/runtimeConfig";
import {
  SavedPromptNotFoundError,
  getSavedPromptSelection,
  selectSavedPromptForUser,
} from "../../../lib/savedPrompts";
import { getUserSystemPrompt, upsertUserSystemPrompt } from "../../../lib/userSettings";
import { listSavedPrompts } from "../../../lib/savedPrompts";

function getAzureAdAuthority(): string {
  const tenantId = process.env.AZURE_AD_TENANT_ID?.trim();
  return tenantId
    ? `https://login.microsoftonline.com/${tenantId}`
    : "https://login.microsoftonline.com/organizations";
}

function buildPublicConfig(
  config: Awaited<ReturnType<typeof getRuntimeConfig>>,
  systemPrompt: string | null = null,
  activeSavedPromptId: string | null = null,
  savedPrompts: Array<{
    id: string;
    name: string;
    promptText: string;
    createdAt: number;
    updatedAt: number;
    deletedAt: number | null;
  }> = []
) {
  return {
    provider: config.provider ?? null,
    model: config.model ?? null,
    azureAdClientId: process.env.AZURE_AD_CLIENT_ID?.trim() || null,
    azureAdAuthority: getAzureAdAuthority(),
    systemPrompt,
    activeSavedPromptId,
    savedPrompts,
  };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?? null;
    const config = await getRuntimeConfig();
    const savedPromptSelection = userId ? getSavedPromptSelection(userId) : { systemPrompt: null, activePromptId: null };
    const savedPrompts = userId ? listSavedPrompts(userId) : [];
    console.log("[Settings] GET: authenticated=%s systemPromptLength=%s", !!userId, savedPromptSelection.systemPrompt != null ? savedPromptSelection.systemPrompt.length : "null");
    return NextResponse.json(
      buildPublicConfig(
        config,
        savedPromptSelection.systemPrompt,
        savedPromptSelection.activePromptId,
        savedPrompts
      )
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?? null;
    const body = await req.json().catch(() => ({}));
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid settings payload." },
        { status: 400 }
      );
    }

    const updates: {
      provider?: "cloud" | "local" | null;
      model?: string | null;
    } = {};

    if ("provider" in body) updates.provider = body.provider;
    if ("model" in body) updates.model = body.model;

    const config = await setRuntimeConfig(updates);

    let systemPrompt: string | null = null;
    let activeSavedPromptId: string | null = null;

    const selectedPromptId = typeof body.selectedPromptId === "string" ? body.selectedPromptId.trim() : null;
    if (selectedPromptId && !userId) {
      return NextResponse.json(
        { error: "Saved prompts require authentication." },
        { status: 401 }
      );
    }
    if (userId && selectedPromptId) {
      const selectedPrompt = selectSavedPromptForUser(userId, selectedPromptId);
      systemPrompt = selectedPrompt.promptText;
      activeSavedPromptId = selectedPrompt.id;
      console.log("[Settings] POST: loaded saved prompt id=%s", selectedPrompt.id);
    } else if (userId && "systemPrompt" in body) {
      const prompt = typeof body.systemPrompt === "string" ? body.systemPrompt : null;
      systemPrompt = upsertUserSystemPrompt(userId, prompt, null);
      console.log("[Settings] POST: saved to DB (authenticated) systemPromptLength=%s", systemPrompt != null ? systemPrompt.length : "null");
    } else if (userId) {
      const selected = getSavedPromptSelection(userId);
      systemPrompt = selected.systemPrompt ?? getUserSystemPrompt(userId);
      activeSavedPromptId = selected.activePromptId;
    } else if ("systemPrompt" in body) {
      systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : null;
      console.log("[Settings] POST: echoed for session (guest) systemPromptLength=%s", systemPrompt != null ? systemPrompt.length : "null");
    }

    const savedPrompts = userId ? listSavedPrompts(userId) : [];
    return NextResponse.json(buildPublicConfig(config, systemPrompt, activeSavedPromptId, savedPrompts));
  } catch (error: any) {
    if (error instanceof SavedPromptNotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: error?.message || "Failed to save settings" },
      { status: 500 }
    );
  }
}
