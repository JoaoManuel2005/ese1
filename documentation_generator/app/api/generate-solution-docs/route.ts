import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { getRuntimeConfig } from "../../../lib/runtimeConfig";
import { getUserSystemPrompt } from "../../../lib/userSettings";
import {
  buildSelectionSnapshot,
  resolveOutputTypeSelection,
} from "../../../lib/outputTypes";

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
    const bodySystemPrompt = typeof body?.systemPrompt === "string" && body.systemPrompt.trim().length > 0
      ? body.systemPrompt.trim()
      : null;
    const bodyOutputTypeId = typeof body?.output_type_id === "string" && body.output_type_id.trim().length > 0
      ? body.output_type_id.trim()
      : typeof body?.outputTypeId === "string" && body.outputTypeId.trim().length > 0
        ? body.outputTypeId.trim()
        : null;
    const bodyOutputTypeTitle = typeof body?.output_type_title === "string" && body.output_type_title.trim().length > 0
      ? body.output_type_title.trim()
      : null;
    const bodyOutputTypeKind = typeof body?.output_type_kind === "string" && body.output_type_kind.trim().length > 0
      ? body.output_type_kind.trim()
      : null;
    const bodyPromptId = typeof body?.prompt_id === "string" && body.prompt_id.trim().length > 0
      ? body.prompt_id.trim()
      : typeof body?.promptId === "string" && body.promptId.trim().length > 0
        ? body.promptId.trim()
        : null;
    const bodyPromptNameSnapshot = typeof body?.prompt_name_snapshot === "string" && body.prompt_name_snapshot.trim().length > 0
      ? body.prompt_name_snapshot.trim()
      : null;
    const bodyPromptTextSnapshot = typeof body?.prompt_text_snapshot === "string" && body.prompt_text_snapshot.length > 0
      ? body.prompt_text_snapshot
      : null;

    const selectedOutputType = await resolveOutputTypeSelection({
      userId,
      outputTypeId:
        typeof body?.output_type === "string"
          ? body.output_type
          : typeof body?.outputType === "string"
            ? body.outputType
            : bodyOutputTypeId,
      outputTypeName:
        typeof body?.output_type_name === "string"
          ? body.output_type_name
          : typeof body?.outputTypeName === "string"
            ? body.outputTypeName
            : null,
      promptId:
        typeof body?.prompt_id === "string"
          ? body.prompt_id
          : typeof body?.promptId === "string"
            ? body.promptId
            : null,
    });

    const snapshot = buildSelectionSnapshot(selectedOutputType, systemPromptFromDb);
    const generationSnapshot = {
      outputTypeId: bodyOutputTypeId ?? snapshot.outputTypeId,
      outputTypeTitle: bodyOutputTypeTitle ?? snapshot.outputTypeTitle,
      outputTypeKind: bodyOutputTypeKind ?? snapshot.outputTypeKind,
      promptId: bodyPromptId ?? snapshot.promptId,
      promptNameSnapshot: bodyPromptNameSnapshot ?? snapshot.promptNameSnapshot,
      promptTextSnapshot: bodyPromptTextSnapshot,
    };

    let resolvedSystemPrompt: string | undefined;
    if (bodyPromptTextSnapshot) {
      resolvedSystemPrompt = bodyPromptTextSnapshot;
    } else if (bodySystemPrompt) {
      resolvedSystemPrompt = bodySystemPrompt;
    } else if (generationSnapshot.promptTextSnapshot) {
      resolvedSystemPrompt = generationSnapshot.promptTextSnapshot;
    } else if (selectedOutputType?.kind === "custom") {
      resolvedSystemPrompt = selectedOutputType.promptText ?? undefined;
    } else if (selectedOutputType?.id === "documentation") {
      resolvedSystemPrompt = [systemPromptFromDb, selectedOutputType.prompt]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join("\n\n")
        .trim() || undefined;
    } else if (selectedOutputType) {
      resolvedSystemPrompt = selectedOutputType.prompt || undefined;
    } else if (systemPromptFromDb) {
      resolvedSystemPrompt = systemPromptFromDb;
    }

    const promptTextSnapshot =
      bodyPromptTextSnapshot ?? generationSnapshot.promptTextSnapshot ?? resolvedSystemPrompt ?? snapshot.promptTextSnapshot;

    const source = bodySystemPrompt ? "body" : (selectedOutputType ? "resolved" : (systemPromptFromDb ? "db" : "none"));
    console.log(
      "[generate-solution-docs] systemPrompt source=%s length=%s outputType=%s",
      source,
      resolvedSystemPrompt != null ? resolvedSystemPrompt.length : "null",
      snapshot.outputTypeId ?? "none"
    );

    const payload = {
      ...body,
      api_key: apiKey,
      endpoint: endpoint,
      systemPrompt: resolvedSystemPrompt,
      output_type: generationSnapshot.outputTypeId ?? body?.output_type ?? body?.outputType ?? body?.output_type_id,
      output_type_title: generationSnapshot.outputTypeTitle,
      output_type_kind: generationSnapshot.outputTypeKind,
      prompt_id: generationSnapshot.promptId,
      prompt_name_snapshot: generationSnapshot.promptNameSnapshot,
      prompt_text_snapshot: promptTextSnapshot,
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
    return NextResponse.json({
      ...data,
      output_type_id: generationSnapshot.outputTypeId,
      output_type_title: generationSnapshot.outputTypeTitle,
      output_type_kind: generationSnapshot.outputTypeKind,
      prompt_id: generationSnapshot.promptId,
      prompt_name_snapshot: generationSnapshot.promptNameSnapshot,
      prompt_text_snapshot: promptTextSnapshot,
    });
  } catch (error: any) {
    console.error("Generate documentation error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
