import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempDir: string;

async function loadModule() {
  vi.resetModules();
  return import("./savedPrompts");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "saved-prompts-test-"));
  process.env.RUNTIME_CONFIG_PATH = path.join(tempDir, "runtime.json");
});

afterEach(() => {
  delete process.env.RUNTIME_CONFIG_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("saved prompt persistence", () => {
  it("creates, lists, updates, and soft-deletes saved prompts", async () => {
    const {
      createSavedPrompt,
      listSavedPrompts,
      updateSavedPrompt,
      deleteSavedPrompt,
      selectSavedPromptForUser,
      getSavedPromptSelection,
    } = await loadModule();

    const created = createSavedPrompt("user@example.com", "My Prompt", "Initial content");
    expect(created.name).toBe("My Prompt");
    expect(created.promptText).toBe("Initial content");
    expect(getSavedPromptSelection("user@example.com")).toEqual({
      systemPrompt: "Initial content",
      activePromptId: created.id,
    });

    const listed = listSavedPrompts("user@example.com");
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    const selected = selectSavedPromptForUser("user@example.com", created.id);
    expect(selected.id).toBe(created.id);
    expect(getSavedPromptSelection("user@example.com")).toEqual({
      systemPrompt: "Initial content",
      activePromptId: created.id,
    });

    const updated = updateSavedPrompt("user@example.com", created.id, {
      name: "Updated Prompt",
      promptText: "Updated content",
    });
    expect(updated.name).toBe("Updated Prompt");
    expect(updated.promptText).toBe("Updated content");
    expect(getSavedPromptSelection("user@example.com")).toEqual({
      systemPrompt: "Updated content",
      activePromptId: created.id,
    });

    deleteSavedPrompt("user@example.com", created.id);
    expect(listSavedPrompts("user@example.com")).toHaveLength(0);
    expect(getSavedPromptSelection("user@example.com")).toEqual({
      systemPrompt: "Initial content",
      activePromptId: null,
    });
  });

  it("rejects duplicate names case-insensitively and blank values", async () => {
    const { createSavedPrompt, updateSavedPrompt, SavedPromptValidationError, SavedPromptConflictError } = await loadModule();

    createSavedPrompt("user@example.com", "Prompt", "Content");

    expect(() => createSavedPrompt("user@example.com", "  ", "Content")).toThrow(SavedPromptValidationError);
    expect(() => createSavedPrompt("user@example.com", "Another", "   ")).toThrow(SavedPromptValidationError);
    expect(() => createSavedPrompt("user@example.com", "Documentation", "Content")).toThrow(SavedPromptValidationError);
    expect(() => createSavedPrompt("user@example.com", "prompt", "Different")).toThrow(SavedPromptConflictError);

    const created = createSavedPrompt("user@example.com", "Unique", "Content");
    expect(() =>
      updateSavedPrompt("user@example.com", created.id, { name: "PROMPT" })
    ).toThrow(SavedPromptConflictError);
  });

  it("returns null for missing prompts and keeps deleted prompts hidden", async () => {
    const { createSavedPrompt, getSavedPrompt, deleteSavedPrompt } = await loadModule();

    const created = createSavedPrompt("user@example.com", "Prompt", "Content");
    expect(getSavedPrompt("user@example.com", "missing")).toBeNull();
    expect(getSavedPrompt("other@example.com", created.id)).toBeNull();

    deleteSavedPrompt("user@example.com", created.id);
    expect(getSavedPrompt("user@example.com", created.id)).toBeNull();
  });
});
