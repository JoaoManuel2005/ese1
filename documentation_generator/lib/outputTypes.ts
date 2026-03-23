import { readFile } from "fs/promises";
import path from "path";
import { getSavedPrompt, listSavedPrompts, type SavedPrompt } from "./savedPrompts";

export type BuiltinOutputType = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  mime: string;
  keywords: string[];
};

export type OutputTypeKind = "builtin" | "custom";

export type ResolvedOutputType = BuiltinOutputType & {
  kind: OutputTypeKind;
  promptId?: string | null;
  promptName?: string | null;
  promptText?: string | null;
  customPrompt?: SavedPrompt | null;
};

export type OutputTypeSelectionInput = {
  userId?: string | null;
  outputTypeId?: string | null;
  outputTypeName?: string | null;
  promptId?: string | null;
};

const OUTPUT_TYPES_PATH = path.join(process.cwd(), "config", "output-types.json");

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function coerceKeywords(input: unknown, fallback: string[]): string[] {
  if (!Array.isArray(input)) return fallback;
  return input
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function readBuiltinOutputTypes(): Promise<BuiltinOutputType[]> {
  const raw = await readFile(OUTPUT_TYPES_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Array<Partial<BuiltinOutputType>>;
  return parsed
    .filter((entry) => typeof entry?.id === "string" && typeof entry?.title === "string")
    .map((entry) => ({
      id: entry.id as string,
      title: entry.title as string,
      description: typeof entry?.description === "string" ? entry.description : "",
      prompt: typeof entry?.prompt === "string" ? entry.prompt : "",
      mime: typeof entry?.mime === "string" && entry.mime.trim() ? entry.mime : "application/pdf",
      keywords: coerceKeywords(entry?.keywords, []),
    }));
}

function toResolvedBuiltin(entry: BuiltinOutputType): ResolvedOutputType {
  return {
    ...entry,
    kind: "builtin",
    promptId: null,
    promptName: entry.title,
    promptText: entry.prompt,
    customPrompt: null,
  };
}

function toResolvedCustom(prompt: SavedPrompt): ResolvedOutputType {
  return {
    id: `custom:${prompt.id}`,
    title: prompt.name,
    description: "Custom saved prompt",
    prompt: prompt.promptText,
    mime: "application/pdf",
    keywords: [prompt.name],
    kind: "custom",
    promptId: prompt.id,
    promptName: prompt.name,
    promptText: prompt.promptText,
    customPrompt: prompt,
  };
}

export async function getAvailableOutputTypes(userId?: string | null): Promise<ResolvedOutputType[]> {
  const builtins = (await readBuiltinOutputTypes()).map(toResolvedBuiltin);
  if (!userId) return builtins;

  const customs = listSavedPrompts(userId).map(toResolvedCustom);
  return [...builtins, ...customs];
}

export async function resolveOutputTypeSelection(
  selection: OutputTypeSelectionInput
): Promise<ResolvedOutputType | null> {
  const builtins = (await readBuiltinOutputTypes()).map(toResolvedBuiltin);
  const builtinById = new Map(builtins.map((entry) => [normalizeKey(entry.id), entry]));
  const builtinByTitle = new Map(builtins.map((entry) => [normalizeKey(entry.title), entry]));
  const normalizedOutputTypeId = normalizeOptionalString(selection.outputTypeId);
  const normalizedOutputTypeName = normalizeOptionalString(selection.outputTypeName);
  const normalizedPromptId = normalizeOptionalString(selection.promptId);
  const userId = normalizeOptionalString(selection.userId);

  if (normalizedPromptId && userId) {
    const prompt = getSavedPrompt(userId, normalizedPromptId);
    if (prompt) return toResolvedCustom(prompt);
  }

  if (normalizedOutputTypeId) {
    const normalizedId = normalizeKey(normalizedOutputTypeId);
    if (normalizedId.startsWith("custom:") && userId) {
      const promptId = normalizedId.slice("custom:".length);
      const prompt = getSavedPrompt(userId, promptId);
      if (prompt) return toResolvedCustom(prompt);
    }
    const builtin = builtinById.get(normalizedId);
    if (builtin) return builtin;
  }

  if (normalizedOutputTypeName) {
    const normalizedName = normalizeKey(normalizedOutputTypeName);
    const builtin = builtinByTitle.get(normalizedName);
    if (builtin) return builtin;
    if (userId) {
      const custom = listSavedPrompts(userId).find((prompt) => normalizeKey(prompt.name) === normalizedName);
      if (custom) return toResolvedCustom(custom);
    }
  }

  return null;
}

export function buildSelectionSnapshot(
  resolved: ResolvedOutputType | null,
  fallbackSystemPrompt?: string | null
): {
  outputTypeId: string | null;
  outputTypeTitle: string | null;
  outputTypeKind: OutputTypeKind | null;
  promptId: string | null;
  promptNameSnapshot: string | null;
  promptTextSnapshot: string | null;
  systemPrompt: string | null;
} {
  if (!resolved) {
    return {
      outputTypeId: null,
      outputTypeTitle: null,
      outputTypeKind: null,
      promptId: null,
      promptNameSnapshot: null,
      promptTextSnapshot: normalizeOptionalString(fallbackSystemPrompt),
      systemPrompt: normalizeOptionalString(fallbackSystemPrompt),
    };
  }

  return {
    outputTypeId: resolved.id,
    outputTypeTitle: resolved.title,
    outputTypeKind: resolved.kind,
    promptId: resolved.kind === "custom" ? resolved.promptId ?? null : null,
    promptNameSnapshot: resolved.promptName ?? resolved.title,
    promptTextSnapshot: resolved.promptText ?? null,
    systemPrompt: resolved.promptText ?? normalizeOptionalString(fallbackSystemPrompt),
  };
}

