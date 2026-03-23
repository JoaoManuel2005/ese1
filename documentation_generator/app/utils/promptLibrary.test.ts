import { describe, expect, it } from "vitest";
import {
  buildPromptChoices,
  getPromptChoiceLabel,
  getPromptChoicesByGroup,
  getPromptSelectionLabel,
  resolvePromptChoiceFromText,
  resolvePromptSelectionIdFromText,
} from "./promptLibrary";
import type { OutputTypeOption } from "../hooks/useOutputTypes";

const promptTypes: OutputTypeOption[] = [
  {
    id: "documentation",
    title: "Documentation",
    description: "Built-in docs",
    prompt: "Doc prompt",
    mime: "application/pdf",
    keywords: ["docs"],
    kind: "builtin",
    promptId: null,
    promptName: "Documentation",
    promptText: "Doc prompt",
  },
  {
    id: "diagrams",
    title: "Diagrams",
    description: "Built-in diagrams",
    prompt: "Diagram prompt",
    mime: "application/pdf",
    keywords: ["diagram"],
    kind: "builtin",
    promptId: null,
    promptName: "Diagrams",
    promptText: "Diagram prompt",
  },
  {
    id: "custom:prompt-1",
    title: "Concise release notes",
    description: "Custom saved prompt",
    prompt: "Custom prompt text",
    mime: "application/pdf",
    keywords: ["release notes"],
    kind: "custom",
    promptId: "prompt-1",
    promptName: "Concise release notes",
    promptText: "Custom prompt text",
  },
];

describe("promptLibrary", () => {
  it("builds one shared prompt list with consistent labels and grouping", () => {
    const choices = buildPromptChoices(promptTypes, "Default prompt text");
    const { defaultChoice, builtins, saved } = getPromptChoicesByGroup(choices);

    expect(defaultChoice?.title).toBe("Default prompt");
    expect(builtins.map((choice) => choice.title)).toEqual(["Documentation", "Diagrams"]);
    expect(saved.map((choice) => choice.title)).toEqual(["Concise release notes"]);
    expect(getPromptChoiceLabel(choices, "documentation")).toBe("Documentation");
    expect(getPromptChoiceLabel(choices, "custom:prompt-1")).toBe("Concise release notes");
    expect(getPromptChoiceLabel(choices, "custom")).toBe("Custom");
  });

  it("keeps built-in-only lists readable when there are no saved prompts", () => {
    const choices = buildPromptChoices(promptTypes.filter((entry) => entry.kind === "builtin"));
    const { saved } = getPromptChoicesByGroup(choices);

    expect(saved).toHaveLength(0);
    expect(getPromptChoiceLabel(choices, "custom:missing")).toBe("Saved prompt unavailable");
    expect(getPromptChoiceLabel(choices, "custom:missing", false, "output")).toBe("Output type unavailable");
  });

  it("resolves the active prompt label by exact text and active selection id", () => {
    const choices = buildPromptChoices(promptTypes, "Default prompt text");

    expect(resolvePromptChoiceFromText(choices, "Doc prompt")?.title).toBe("Documentation");
    expect(resolvePromptChoiceFromText(choices, "Custom prompt text", "prompt-1")?.title).toBe("Concise release notes");
    expect(resolvePromptSelectionIdFromText(choices, "Doc prompt")).toBe("documentation");
    expect(resolvePromptSelectionIdFromText(choices, "Completely custom text")).toBe("custom");
    expect(getPromptSelectionLabel(choices, "Custom prompt text", "prompt-1")).toBe("Concise release notes");
    expect(getPromptSelectionLabel(choices, "Completely custom text")).toBe("Custom");
    expect(getPromptSelectionLabel(choices, "Missing saved text", "prompt-1", true)).toBe("Saved prompt (loading...)");
  });
});
