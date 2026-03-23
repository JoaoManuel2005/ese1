"use client";

import type { OutputTypeOption } from "../hooks/useOutputTypes";

export type PromptChoiceGroup = "default" | "builtin" | "saved";

export type PromptChoice = {
  id: string;
  title: string;
  description: string;
  promptText: string;
  kind: "builtin" | "custom";
  group: PromptChoiceGroup;
  promptId: string | null;
};

export function buildPromptChoices(
  outputTypes: OutputTypeOption[],
  defaultPromptText?: string | null
): PromptChoice[] {
  const defaultChoice =
    typeof defaultPromptText === "string"
      ? [
          {
            id: "default",
            title: "Default prompt",
            description: "Restore the default system prompt.",
            promptText: defaultPromptText,
            kind: "builtin" as const,
            group: "default" as const,
            promptId: null,
          },
        ]
      : [];

  const builtins = outputTypes
    .filter((entry) => entry.kind === "builtin")
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      promptText: entry.promptText || entry.prompt || "",
      kind: "builtin" as const,
      group: "builtin" as const,
      promptId: null,
    }));

  const customs = outputTypes
    .filter((entry) => entry.kind === "custom")
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description || "Saved prompt",
      promptText: entry.promptText || entry.prompt || "",
      kind: "custom" as const,
      group: "saved" as const,
      promptId: entry.promptId || entry.id,
    }));

  return [...defaultChoice, ...builtins, ...customs];
}

export function getPromptChoicesByGroup(choices: PromptChoice[]) {
  return {
    defaultChoice: choices.find((choice) => choice.group === "default") || null,
    builtins: choices.filter((choice) => choice.group === "builtin"),
    saved: choices.filter((choice) => choice.group === "saved"),
  };
}

export function getPromptChoiceLabel(
  choices: PromptChoice[],
  selectedPromptId: string,
  loading = false,
  context: "prompt" | "output" = "prompt"
): string {
  const unavailableLabel =
    context === "output" ? "Output type unavailable" : "Saved prompt unavailable";
  const loadingLabel =
    context === "output" ? "Output type (loading...)" : "Saved prompt (loading...)";
  const missingLabel = context === "output" ? "Output type unavailable" : "Prompt unavailable";

  if (selectedPromptId === "custom") {
    return "Custom";
  }

  const selectedEntry = choices.find((entry) => entry.id === selectedPromptId) || null;
  if (selectedEntry) return selectedEntry.title;

  if (selectedPromptId.startsWith("custom:")) {
    return loading ? loadingLabel : unavailableLabel;
  }

  return selectedPromptId ? missingLabel : "No output type selected.";
}

export function resolvePromptSelectionIdFromText(
  choices: PromptChoice[],
  currentText: string
): string {
  const resolvedChoice = resolvePromptChoiceFromText(choices, currentText);
  return resolvedChoice?.id || "custom";
}

export function resolvePromptChoiceFromText(
  choices: PromptChoice[],
  currentText: string,
  activePromptId: string | null = null
): PromptChoice | null {
  const activeChoice =
    activePromptId != null
      ? choices.find((choice) => choice.promptId === activePromptId) || null
      : null;

  if (activeChoice && activeChoice.promptText === currentText) {
    return activeChoice;
  }

  return choices.find((choice) => choice.promptText === currentText) || null;
}

export function getPromptSelectionLabel(
  choices: PromptChoice[],
  currentText: string,
  activePromptId: string | null = null,
  loading = false
): string {
  const resolvedChoice = resolvePromptChoiceFromText(choices, currentText, activePromptId);
  if (resolvedChoice) {
    return resolvedChoice.title;
  }

  if (loading && activePromptId) {
    return "Saved prompt (loading...)";
  }

  return "Custom";
}
