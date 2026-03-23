import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock("../../auth/[...nextauth]/route", () => ({
  authOptions: {},
}));

async function loadModules() {
  vi.resetModules();
  const route = await import("./route");
  const { getDb } = await import("../../../../lib/db");
  const { createSavedPrompt, updateSavedPrompt, deleteSavedPrompt } = await import("../../../../lib/savedPrompts");
  return { route, getDb, createSavedPrompt, updateSavedPrompt, deleteSavedPrompt };
}

describe("/api/conversations/[id]", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-id-route-test-"));
    process.env.RUNTIME_CONFIG_PATH = path.join(tempDir, "runtime.json");
    mockGetServerSession.mockResolvedValue({ user: { email: "user@example.com" } });
  });

  afterEach(() => {
    delete process.env.RUNTIME_CONFIG_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("keeps the original prompt snapshot when the saved prompt is edited later", async () => {
    const { route, getDb, createSavedPrompt, updateSavedPrompt } = await loadModules();
    const prompt = createSavedPrompt("user@example.com", "Release notes", "Original prompt text");
    const db = getDb();
    const sessionId = "session-built-in";

    db.prepare(
      `INSERT INTO conversation_sessions (id, user_id, dataset_id, customer_name, title, document_filename, document_markdown, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    ).run(
      sessionId,
      "user@example.com",
      "dataset-1",
      "Acme",
      "New chat",
      "release-notes.pdf",
      "# Document"
    );
    db.prepare(
      `INSERT INTO conversation_outputs (
        id, session_id, filename, markdown_content, html_preview, pdf_base64, mime,
        output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    ).run(
      "output-1",
      sessionId,
      "release-notes.pdf",
      "# Document",
      "<p>Doc</p>",
      "cGRm",
      "application/pdf",
      `custom:${prompt.id}`,
      "Release notes",
      "custom",
      prompt.id,
      "Release notes",
      "Original prompt text"
    );

    updateSavedPrompt("user@example.com", prompt.id, {
      name: "Renamed prompt",
      promptText: "Updated prompt text",
    });

    const response = await route.GET(new Request("http://localhost/api/conversations/session-built-in"), {
      params: Promise.resolve({ id: sessionId }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.output.prompt_name_snapshot).toBe("Release notes");
    expect(data.output.prompt_text_snapshot).toBe("Original prompt text");
    expect(data.output.prompt_id).toBe(prompt.id);
  });

  it("keeps the original prompt snapshot when the saved prompt is deleted later", async () => {
    const { route, getDb, createSavedPrompt, deleteSavedPrompt } = await loadModules();
    const prompt = createSavedPrompt("user@example.com", "Diagram prompt", "Original diagram instructions");
    const db = getDb();
    const sessionId = "session-custom";

    db.prepare(
      `INSERT INTO conversation_sessions (id, user_id, dataset_id, customer_name, title, document_filename, document_markdown, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    ).run(
      sessionId,
      "user@example.com",
      "dataset-2",
      "Contoso",
      "New chat",
      "diagram.pdf",
      "# Diagram"
    );
    db.prepare(
      `INSERT INTO conversation_outputs (
        id, session_id, filename, markdown_content, html_preview, pdf_base64, mime,
        output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    ).run(
      "output-2",
      sessionId,
      "diagram.pdf",
      "# Diagram",
      "<p>Diagram</p>",
      "cGRm",
      "application/pdf",
      `custom:${prompt.id}`,
      "Diagram prompt",
      "custom",
      prompt.id,
      "Diagram prompt",
      "Original diagram instructions"
    );

    deleteSavedPrompt("user@example.com", prompt.id);

    const response = await route.GET(new Request("http://localhost/api/conversations/session-custom"), {
      params: Promise.resolve({ id: sessionId }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.output.prompt_name_snapshot).toBe("Diagram prompt");
    expect(data.output.prompt_text_snapshot).toBe("Original diagram instructions");
    expect(data.output.prompt_id).toBe(prompt.id);
  });

  it("loads legacy output records without metadata safely", async () => {
    const { route, getDb } = await loadModules();
    const db = getDb();
    const sessionId = "legacy-session";

    db.prepare(
      `INSERT INTO conversation_sessions (id, user_id, dataset_id, customer_name, title, document_filename, document_markdown, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    ).run(
      sessionId,
      "user@example.com",
      "dataset-legacy",
      "Legacy",
      "New chat",
      "legacy.pdf",
      "# Legacy markdown"
    );
    db.prepare(
      `INSERT INTO conversation_outputs (
        id, session_id, filename, markdown_content, html_preview, pdf_base64, mime,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    ).run(
      "legacy-output",
      sessionId,
      "legacy.pdf",
      "# Legacy markdown",
      null,
      null,
      "application/pdf"
    );

    const response = await route.GET(new Request("http://localhost/api/conversations/legacy-session"), {
      params: Promise.resolve({ id: sessionId }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.document_filename).toBe("legacy.pdf");
    expect(data.document_markdown).toBe("# Legacy markdown");
    expect(data.output.output_type_id).toBeNull();
    expect(data.output.prompt_id).toBeNull();
    expect(data.output.prompt_text_snapshot).toBeNull();
  });

  it("preserves existing output metadata when only document content is patched", async () => {
    const { route, getDb } = await loadModules();
    const db = getDb();
    const sessionId = "patch-session";

    db.prepare(
      `INSERT INTO conversation_sessions (id, user_id, dataset_id, customer_name, title, document_filename, document_markdown, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    ).run(
      sessionId,
      "user@example.com",
      "dataset-patch",
      "Patch",
      "New chat",
      "patch.pdf",
      "# Original"
    );
    db.prepare(
      `INSERT INTO conversation_outputs (
        id, session_id, filename, markdown_content, html_preview, pdf_base64, mime,
        output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    ).run(
      "patch-output",
      sessionId,
      "patch.pdf",
      "# Original",
      "<p>Original</p>",
      "cGRm",
      "application/pdf",
      "documentation",
      "Documentation",
      "builtin",
      null,
      "Documentation",
      "Documentation prompt snapshot"
    );

    const response = await route.PATCH(
      new Request("http://localhost/api/conversations/patch-session", {
        method: "PATCH",
        body: JSON.stringify({
          document_markdown: "# Updated",
        }),
      }),
      { params: Promise.resolve({ id: sessionId }) }
    );
    expect(response.status).toBe(200);

    const latest = db.prepare(
      `SELECT output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot
       FROM conversation_outputs
       WHERE session_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    ).get(sessionId) as
      | {
          output_type_id: string | null;
          output_type_title: string | null;
          output_type_kind: string | null;
          prompt_id: string | null;
          prompt_name_snapshot: string | null;
          prompt_text_snapshot: string | null;
        }
      | undefined;

    expect(latest?.output_type_id).toBe("documentation");
    expect(latest?.output_type_title).toBe("Documentation");
    expect(latest?.output_type_kind).toBe("builtin");
    expect(latest?.prompt_name_snapshot).toBe("Documentation");
  });
});
