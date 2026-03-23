import { describe, expect, it } from "vitest";
import {
  buildUnknownChatOutputTypeMessage,
  parseChatOutputTypeChangeCommand,
  resolveChatOutputTypeChange,
  resolveChatOutputTypeSelection,
} from "./chatOutputType";

const outputTypes = [
  {
    id: "documentation",
    title: "Documentation",
    description: "",
    prompt: "Doc prompt",
    mime: "application/pdf",
    keywords: ["docs"],
    kind: "builtin" as const,
    promptId: null,
    promptName: "Documentation",
    promptText: "Doc prompt",
  },
  {
    id: "diagrams",
    title: "Diagrams",
    description: "",
    prompt: "Diagram prompt",
    mime: "application/pdf",
    keywords: ["diagram"],
    kind: "builtin" as const,
    promptId: null,
    promptName: "Diagrams",
    promptText: "Diagram prompt",
  },
  {
    id: "custom:prompt-1",
    title: "Concise Release Notes",
    description: "",
    prompt: "Custom prompt text",
    mime: "application/pdf",
    keywords: ["release notes"],
    kind: "custom" as const,
    promptId: "prompt-1",
    promptName: "Concise Release Notes",
    promptText: "Custom prompt text",
  },
];

describe("parseChatOutputTypeChangeCommand", () => {
  it("parses a change-only command", () => {
    const parsed = parseChatOutputTypeChangeCommand("change output file type to Documentation");
    expect(parsed).toEqual({ target: "Documentation", shouldGenerate: false });
  });

  it("parses the command when embedded in a longer sentence", () => {
    const parsed = parseChatOutputTypeChangeCommand("Could you please change output file type to Diagrams?");
    expect(parsed).toEqual({ target: "Diagrams", shouldGenerate: false });
  });

  it("parses change-and-regenerate variants", () => {
    const parsed = parseChatOutputTypeChangeCommand(
      "Change Output File Type To concise release notes and regenerate"
    );
    expect(parsed).toEqual({ target: "concise release notes", shouldGenerate: true });
  });

  it("parses change-and-gen shorthand with extra spacing", () => {
    const parsed = parseChatOutputTypeChangeCommand(
      "  change   output   file   type   to   diagrams   and   gen  "
    );
    expect(parsed).toEqual({ target: "diagrams", shouldGenerate: true });
  });

  it("trims trailing punctuation from the requested output type", () => {
    const parsed = parseChatOutputTypeChangeCommand("change output file type to diagrams and regenerate.");
    expect(parsed).toEqual({ target: "diagrams", shouldGenerate: true });
  });
});

describe("resolveChatOutputTypeSelection", () => {
  it("matches built-in output types by exact normalized title or id", () => {
    expect(resolveChatOutputTypeSelection("documentation", outputTypes)?.id).toBe("documentation");
    expect(resolveChatOutputTypeSelection("Diagrams", outputTypes)?.id).toBe("diagrams");
  });

  it("matches custom saved prompts by name case-insensitively", () => {
    const resolved = resolveChatOutputTypeSelection("CoNcIsE ReLeAsE NoTeS", outputTypes);
    expect(resolved?.kind).toBe("custom");
    expect(resolved?.promptId).toBe("prompt-1");
  });

  it("returns null for unknown output types", () => {
    expect(resolveChatOutputTypeSelection("missing type", outputTypes)).toBeNull();
  });
});

describe("resolveChatOutputTypeChange", () => {
  it("resolves a built-in type and marks generate requests", () => {
    const resolved = resolveChatOutputTypeChange(
      "change output file type to documentation and generate",
      outputTypes
    );

    expect(resolved?.outputType?.id).toBe("documentation");
    expect(resolved?.shouldGenerate).toBe(true);
  });

  it("resolves a custom prompt and supports change-only requests", () => {
    const resolved = resolveChatOutputTypeChange(
      "change output file type to concise release notes",
      outputTypes
    );

    expect(resolved?.outputType?.id).toBe("custom:prompt-1");
    expect(resolved?.shouldGenerate).toBe(false);
  });

  it("produces a helpful message for unknown types", () => {
    const resolved = resolveChatOutputTypeChange("change output file type to missing type", outputTypes);

    expect(resolved?.outputType).toBeNull();
    expect(resolved?.errorMessage).toContain("missing type");
    expect(resolved?.errorMessage).toContain("Documentation");
    expect(resolved?.errorMessage).toContain("Concise Release Notes");
  });
});

describe("buildUnknownChatOutputTypeMessage", () => {
  it("summarizes the available built-in and saved prompt types", () => {
    const message = buildUnknownChatOutputTypeMessage("missing type", outputTypes);
    expect(message).toContain("missing type");
    expect(message).toContain("Built-in types: Documentation, Diagrams");
    expect(message).toContain("Saved prompts: Concise Release Notes");
  });
});
