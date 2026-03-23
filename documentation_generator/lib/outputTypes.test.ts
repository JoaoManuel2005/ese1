import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempDir: string;

async function loadModules() {
  vi.resetModules();
  const outputTypes = await import("./outputTypes");
  const prompts = await import("./savedPrompts");
  return { outputTypes, prompts };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "output-types-test-"));
  process.env.RUNTIME_CONFIG_PATH = path.join(tempDir, "runtime.json");
});

afterEach(() => {
  delete process.env.RUNTIME_CONFIG_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("output type resolution", () => {
  it("returns built-ins and user saved prompts", async () => {
    const { outputTypes, prompts } = await loadModules();
    prompts.createSavedPrompt("user@example.com", "Custom Summary", "Custom instruction");

    const types = await outputTypes.getAvailableOutputTypes("user@example.com");
    expect(types.map((t) => t.id)).toContain("documentation");
    expect(types.map((t) => t.id)).toContain("diagrams");
    expect(types.some((t) => t.id.startsWith("custom:"))).toBe(true);
    expect(types.some((t) => t.kind === "custom" && t.title === "Custom Summary")).toBe(true);
  });

  it("resolves built-in and custom selections safely", async () => {
    const { outputTypes, prompts } = await loadModules();
    const custom = prompts.createSavedPrompt("user@example.com", "My Custom", "Use this prompt");

    const builtin = await outputTypes.resolveOutputTypeSelection({
      outputTypeId: "documentation",
      userId: "user@example.com",
    });
    expect(builtin?.kind).toBe("builtin");
    expect(builtin?.id).toBe("documentation");

    const customById = await outputTypes.resolveOutputTypeSelection({
      outputTypeId: `custom:${custom.id}`,
      userId: "user@example.com",
    });
    expect(customById?.kind).toBe("custom");
    expect(customById?.promptId).toBe(custom.id);

    const customByName = await outputTypes.resolveOutputTypeSelection({
      outputTypeName: "my custom",
      userId: "user@example.com",
    });
    expect(customByName?.kind).toBe("custom");
    expect(customByName?.promptId).toBe(custom.id);

    const missing = await outputTypes.resolveOutputTypeSelection({
      outputTypeId: "missing",
      userId: "user@example.com",
    });
    expect(missing).toBeNull();
  });
});
