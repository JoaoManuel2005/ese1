import type { OutputTypeOption } from "../hooks/useOutputTypes";

export type ChatOutputTypeChangeCommand = {
  target: string;
  shouldGenerate: boolean;
};

export type ResolvedChatOutputTypeChange = ChatOutputTypeChangeCommand & {
  outputType: OutputTypeOption | null;
  errorMessage?: string;
};

const COMMAND_PREFIX = "change output file type to ";
const COMMAND_SUFFIXES = new Set(["and regenerate", "and regen", "and generate", "and gen"]);

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeLookupKey(value: string): string {
  return normalizeWhitespace(value).toLocaleLowerCase();
}

function trimTrailingCommandPunctuation(value: string): string {
  return value.replace(/[.!?,;:]+$/g, "").trim();
}

export function parseChatOutputTypeChangeCommand(text: string): ChatOutputTypeChangeCommand | null {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return null;

  const lower = normalized.toLocaleLowerCase();
  const commandStartIndex = lower.indexOf(COMMAND_PREFIX);
  if (commandStartIndex < 0) {
    return null;
  }

  const remainder = normalized.slice(commandStartIndex + COMMAND_PREFIX.length).trim();
  if (!remainder) return null;

  const lowerRemainder = remainder.toLocaleLowerCase();
  for (const suffix of COMMAND_SUFFIXES) {
    if (!lowerRemainder.endsWith(` ${suffix}`)) {
      continue;
    }
    const target = trimTrailingCommandPunctuation(
      remainder.slice(0, remainder.length - suffix.length - 1)
    );
    if (!target) return null;
    return { target, shouldGenerate: true };
  }

  return { target: trimTrailingCommandPunctuation(remainder), shouldGenerate: false };
}

export function resolveChatOutputTypeSelection(
  target: string,
  outputTypes: OutputTypeOption[]
): OutputTypeOption | null {
  const normalizedTarget = normalizeLookupKey(target);
  if (!normalizedTarget) return null;

  return (
    outputTypes.find((entry) => {
      const candidates = [entry.id, entry.title, entry.promptName].filter(
        (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0
      );
      return candidates.some((candidate) => normalizeLookupKey(candidate) === normalizedTarget);
    }) || null
  );
}

export function describeAvailableOutputTypes(outputTypes: OutputTypeOption[]): string {
  const builtins = outputTypes
    .filter((entry) => entry.kind === "builtin")
    .map((entry) => entry.title);
  const customs = outputTypes
    .filter((entry) => entry.kind === "custom")
    .map((entry) => entry.title);

  const parts: string[] = [];
  if (builtins.length > 0) {
    parts.push(`Built-in types: ${builtins.join(", ")}`);
  }
  if (customs.length > 0) {
    parts.push(`Saved prompts: ${customs.join(", ")}`);
  }

  return parts.length > 0 ? parts.join(". ") : "No output file types are available.";
}

export function buildUnknownChatOutputTypeMessage(
  target: string,
  outputTypes: OutputTypeOption[]
): string {
  return `I couldn't find an output file type named "${target}". ${describeAvailableOutputTypes(outputTypes)}.`;
}

export function resolveChatOutputTypeChange(
  text: string,
  outputTypes: OutputTypeOption[]
): ResolvedChatOutputTypeChange | null {
  const parsed = parseChatOutputTypeChangeCommand(text);
  if (!parsed) return null;

  const outputType = resolveChatOutputTypeSelection(parsed.target, outputTypes);
  if (!outputType) {
    return {
      ...parsed,
      outputType: null,
      errorMessage: buildUnknownChatOutputTypeMessage(parsed.target, outputTypes),
    };
  }

  return {
    ...parsed,
    outputType,
  };
}
