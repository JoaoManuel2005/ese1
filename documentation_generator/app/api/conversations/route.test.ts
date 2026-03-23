import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock("../auth/[...nextauth]/route", () => ({
  authOptions: {},
}));

async function loadModules() {
  vi.resetModules();
  const route = await import("./route");
  const { getDb } = await import("../../../lib/db");
  return { route, getDb };
}

describe("/api/conversations", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conversations-route-test-"));
    process.env.RUNTIME_CONFIG_PATH = path.join(tempDir, "runtime.json");
    mockGetServerSession.mockResolvedValue({ user: { email: "user@example.com" } });
  });

  afterEach(() => {
    delete process.env.RUNTIME_CONFIG_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("persists built-in output type metadata when creating a conversation output", async () => {
    const { route, getDb } = await loadModules();

    const request = new Request("http://localhost/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        dataset_id: "dataset-1",
        customer_name: "Acme",
        document_filename: "acme_documentation.pdf",
        document_markdown: "# Documentation",
        document_html: "<p>Doc</p>",
        document_pdf_base64: "cGRm",
        document_mime: "application/pdf",
        output_type_id: "documentation",
        output_type_title: "Documentation",
        output_type_kind: "builtin",
        prompt_id: null,
        prompt_name_snapshot: "Documentation",
        prompt_text_snapshot: "Generated docs prompt snapshot",
      }),
    });

    const response = await route.POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    const db = getDb();
    const row = db.prepare(
      `SELECT output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot
       FROM conversation_outputs
       WHERE session_id = ?`
    ).get(data.conversation_id) as
      | {
          output_type_id: string | null;
          output_type_title: string | null;
          output_type_kind: string | null;
          prompt_id: string | null;
          prompt_name_snapshot: string | null;
          prompt_text_snapshot: string | null;
        }
      | undefined;

    expect(row).toBeTruthy();
    expect(row?.output_type_id).toBe("documentation");
    expect(row?.output_type_title).toBe("Documentation");
    expect(row?.output_type_kind).toBe("builtin");
    expect(row?.prompt_id).toBeNull();
    expect(row?.prompt_name_snapshot).toBe("Documentation");
    expect(row?.prompt_text_snapshot).toBe("Generated docs prompt snapshot");
  });

  it("persists custom prompt metadata when creating a conversation output", async () => {
    const { route, getDb } = await loadModules();

    const request = new Request("http://localhost/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        dataset_id: "dataset-2",
        customer_name: "Contoso",
        document_filename: "contoso_notes.pdf",
        document_markdown: "# Notes",
        document_html: "<p>Notes</p>",
        document_pdf_base64: "cGRm",
        document_mime: "application/pdf",
        output_type_id: "custom:prompt-1",
        output_type_title: "Concise release notes",
        output_type_kind: "custom",
        prompt_id: "prompt-1",
        prompt_name_snapshot: "Concise release notes",
        prompt_text_snapshot: "Summarise release notes with bullets",
      }),
    });

    const response = await route.POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    const db = getDb();
    const row = db.prepare(
      `SELECT output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot
       FROM conversation_outputs
       WHERE session_id = ?`
    ).get(data.conversation_id) as
      | {
          output_type_id: string | null;
          output_type_title: string | null;
          output_type_kind: string | null;
          prompt_id: string | null;
          prompt_name_snapshot: string | null;
          prompt_text_snapshot: string | null;
        }
      | undefined;

    expect(row).toBeTruthy();
    expect(row?.output_type_id).toBe("custom:prompt-1");
    expect(row?.output_type_title).toBe("Concise release notes");
    expect(row?.output_type_kind).toBe("custom");
    expect(row?.prompt_id).toBe("prompt-1");
    expect(row?.prompt_name_snapshot).toBe("Concise release notes");
    expect(row?.prompt_text_snapshot).toBe("Summarise release notes with bullets");
  });
});
