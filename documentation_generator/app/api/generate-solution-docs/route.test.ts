import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mockGetServerSession = vi.fn();
const mockGetRuntimeConfig = vi.fn();
const mockGetUserSystemPrompt = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock("../auth/[...nextauth]/route", () => ({
  authOptions: {},
}));

vi.mock("../../../lib/runtimeConfig", () => ({
  getRuntimeConfig: (...args: unknown[]) => mockGetRuntimeConfig(...args),
}));

vi.mock("../../../lib/userSettings", () => ({
  getUserSystemPrompt: (...args: unknown[]) => mockGetUserSystemPrompt(...args),
}));

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("/api/generate-solution-docs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-solution-docs-test-"));
    process.env.RUNTIME_CONFIG_PATH = path.join(tempDir, "runtime.json");
    mockGetServerSession.mockResolvedValue({ user: { email: "user@example.com" } });
    mockGetRuntimeConfig.mockResolvedValue({
      openaiApiKey: "test-key",
      azureOpenAiEndpoint: null,
    });
    mockGetUserSystemPrompt.mockReturnValue("Base system prompt");
  });

  afterEach(() => {
    delete process.env.RUNTIME_CONFIG_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns built-in output metadata for documentation generation", async () => {
    const route = await loadRoute();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        documentation: "Generated docs",
        format: "markdown",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await route.POST(
      new Request("http://localhost/api/generate-solution-docs", {
        method: "POST",
        body: JSON.stringify({
          solution: { solution_name: "Acme", components: [] },
          doc_type: "markdown",
          output_type: "documentation",
          output_type_id: "documentation",
          output_type_title: "Documentation",
          output_type_kind: "builtin",
          prompt_id: null,
          prompt_name_snapshot: "Documentation",
          prompt_text_snapshot: "Base system prompt\n\nDoc prompt",
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.output_type_id).toBe("documentation");
    expect(data.output_type_title).toBe("Documentation");
    expect(data.output_type_kind).toBe("builtin");
    expect(data.prompt_name_snapshot).toBe("Documentation");
    expect(data.prompt_text_snapshot).toBe("Base system prompt\n\nDoc prompt");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const backendPayload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(backendPayload.output_type).toBe("documentation");
    expect(backendPayload.output_type_title).toBe("Documentation");
    expect(backendPayload.output_type_kind).toBe("builtin");
    expect(backendPayload.prompt_text_snapshot).toBe("Base system prompt\n\nDoc prompt");
  });

  it("returns custom prompt metadata for prompt-based generation", async () => {
    const route = await loadRoute();
    const { createSavedPrompt } = await import("../../../lib/savedPrompts");
    const prompt = createSavedPrompt("user@example.com", "Concise release notes", "Summarise changes tersely");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        documentation: "Generated custom docs",
        format: "markdown",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await route.POST(
      new Request("http://localhost/api/generate-solution-docs", {
        method: "POST",
        body: JSON.stringify({
          solution: { solution_name: "Acme", components: [] },
          doc_type: "markdown",
          prompt_id: prompt.id,
          output_type_id: `custom:${prompt.id}`,
          output_type_title: "Concise release notes",
          output_type_kind: "custom",
          prompt_name_snapshot: "Concise release notes",
          prompt_text_snapshot: "Summarise changes tersely",
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.output_type_id).toBe(`custom:${prompt.id}`);
    expect(data.output_type_title).toBe("Concise release notes");
    expect(data.output_type_kind).toBe("custom");
    expect(data.prompt_id).toBe(prompt.id);
    expect(data.prompt_name_snapshot).toBe("Concise release notes");
    expect(data.prompt_text_snapshot).toBe("Summarise changes tersely");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const backendPayload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(backendPayload.output_type).toBe(`custom:${prompt.id}`);
    expect(backendPayload.output_type_title).toBe("Concise release notes");
    expect(backendPayload.output_type_kind).toBe("custom");
    expect(backendPayload.prompt_id).toBe(prompt.id);
    expect(backendPayload.prompt_text_snapshot).toBe("Summarise changes tersely");
  });

  it("uses the explicit prompt snapshot even if the saved prompt was deleted before generation", async () => {
    const route = await loadRoute();
    const { createSavedPrompt, deleteSavedPrompt } = await import("../../../lib/savedPrompts");
    const prompt = createSavedPrompt("user@example.com", "Draft notes", "Original prompt text");
    deleteSavedPrompt("user@example.com", prompt.id);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        documentation: "Generated deleted prompt docs",
        format: "markdown",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await route.POST(
      new Request("http://localhost/api/generate-solution-docs", {
        method: "POST",
        body: JSON.stringify({
          solution: { solution_name: "Acme", components: [] },
          doc_type: "markdown",
          output_type: `custom:${prompt.id}`,
          output_type_id: `custom:${prompt.id}`,
          output_type_title: "Draft notes",
          output_type_kind: "custom",
          prompt_id: prompt.id,
          prompt_name_snapshot: "Draft notes",
          prompt_text_snapshot: "Original prompt text",
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.output_type_id).toBe(`custom:${prompt.id}`);
    expect(data.output_type_title).toBe("Draft notes");
    expect(data.output_type_kind).toBe("custom");
    expect(data.prompt_id).toBe(prompt.id);
    expect(data.prompt_name_snapshot).toBe("Draft notes");
    expect(data.prompt_text_snapshot).toBe("Original prompt text");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const backendPayload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(backendPayload.output_type).toBe(`custom:${prompt.id}`);
    expect(backendPayload.output_type_title).toBe("Draft notes");
    expect(backendPayload.output_type_kind).toBe("custom");
    expect(backendPayload.prompt_id).toBe(prompt.id);
    expect(backendPayload.prompt_name_snapshot).toBe("Draft notes");
    expect(backendPayload.prompt_text_snapshot).toBe("Original prompt text");
    expect(backendPayload.systemPrompt).toBe("Original prompt text");
  });
});
