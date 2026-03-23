import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { getDb } from "../../../lib/db";
import { randomUUID } from "crypto";

function formatSessionDate(timestampSeconds: number) {
  return new Date(timestampSeconds * 1000).toLocaleDateString("en-GB");
}

function buildConversationTitle(customerName?: string) {
  const trimmedCustomer = customerName?.trim() || "";
  const date = formatSessionDate(Math.floor(Date.now() / 1000));
  if (!trimmedCustomer) return `New chat - ${date}`;
  return `${trimmedCustomer} - ${date}`;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.email;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, dataset_id, customer_name, title, created_at, updated_at
       FROM conversation_sessions
       WHERE user_id = ?
       ORDER BY updated_at DESC`
    )
    .all(userId) as Array<{
    id: string;
    dataset_id: string | null;
    customer_name: string | null;
    title: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return NextResponse.json({
    conversations: rows.map((r) => ({
      id: r.id,
      dataset_id: r.dataset_id,
      customer_name: r.customer_name,
      title: r.title,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.email;

  try {
    const body = await req.json().catch(() => ({}));
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid conversation payload." }, { status: 400 });
    }
    const datasetId = typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
    const customerName = typeof body?.customer_name === "string" ? body.customer_name.trim() : "";
    const documentFilename =
      typeof body?.document_filename === "string" && body.document_filename.trim().length > 0
        ? body.document_filename.trim()
        : null;
    const documentMarkdown =
      typeof body?.document_markdown === "string"
        ? body.document_markdown
        : body?.document_markdown == null
          ? null
          : undefined;

    if (documentMarkdown === undefined) {
      return NextResponse.json({ error: "document_markdown must be a string or null" }, { status: 400 });
    }
    const documentHtml =
      typeof body?.document_html === "string"
        ? body.document_html
        : body?.document_html == null
          ? null
          : undefined;
    const documentPdfBase64 =
      typeof body?.document_pdf_base64 === "string"
        ? body.document_pdf_base64
        : body?.document_pdf_base64 == null
          ? null
          : undefined;
    const documentMime =
      typeof body?.document_mime === "string" && body.document_mime.trim().length > 0
        ? body.document_mime.trim()
        : body?.document_mime == null
          ? null
          : undefined;
    if (documentHtml === undefined) {
      return NextResponse.json({ error: "document_html must be a string or null" }, { status: 400 });
    }
    if (documentPdfBase64 === undefined) {
      return NextResponse.json({ error: "document_pdf_base64 must be a string or null" }, { status: 400 });
    }
    if (documentMime === undefined) {
      return NextResponse.json({ error: "document_mime must be a string or null" }, { status: 400 });
    }

    const outputTypeId =
      typeof body?.output_type_id === "string" && body.output_type_id.trim().length > 0
        ? body.output_type_id.trim()
        : body?.output_type_id == null
          ? null
          : undefined;
    const outputTypeTitle =
      typeof body?.output_type_title === "string" && body.output_type_title.trim().length > 0
        ? body.output_type_title.trim()
        : body?.output_type_title == null
          ? null
          : undefined;
    const outputTypeKind =
      typeof body?.output_type_kind === "string" && body.output_type_kind.trim().length > 0
        ? body.output_type_kind.trim()
        : body?.output_type_kind == null
          ? null
          : undefined;
    const promptId =
      typeof body?.prompt_id === "string" && body.prompt_id.trim().length > 0
        ? body.prompt_id.trim()
        : body?.prompt_id == null
          ? null
          : undefined;
    const promptNameSnapshot =
      typeof body?.prompt_name_snapshot === "string" && body.prompt_name_snapshot.trim().length > 0
        ? body.prompt_name_snapshot.trim()
        : body?.prompt_name_snapshot == null
          ? null
          : undefined;
    const promptTextSnapshot =
      typeof body?.prompt_text_snapshot === "string"
        ? body.prompt_text_snapshot
        : body?.prompt_text_snapshot == null
          ? null
          : undefined;

    if (outputTypeId === undefined && "output_type_id" in body) {
      return NextResponse.json({ error: "output_type_id must be a string or null" }, { status: 400 });
    }
    if (outputTypeTitle === undefined && "output_type_title" in body) {
      return NextResponse.json({ error: "output_type_title must be a string or null" }, { status: 400 });
    }
    if (outputTypeKind === undefined && "output_type_kind" in body) {
      return NextResponse.json({ error: "output_type_kind must be a string or null" }, { status: 400 });
    }
    if (promptId === undefined && "prompt_id" in body) {
      return NextResponse.json({ error: "prompt_id must be a string or null" }, { status: 400 });
    }
    if (promptNameSnapshot === undefined && "prompt_name_snapshot" in body) {
      return NextResponse.json({ error: "prompt_name_snapshot must be a string or null" }, { status: 400 });
    }
    if (promptTextSnapshot === undefined && "prompt_text_snapshot" in body) {
      return NextResponse.json({ error: "prompt_text_snapshot must be a string or null" }, { status: 400 });
    }

    const sessionId = randomUUID();
    const db = getDb();
    const title = buildConversationTitle(customerName || undefined);

    db.prepare(
      `INSERT INTO conversation_sessions (
        id, user_id, dataset_id, customer_name, title, document_filename, document_markdown, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    ).run(
      sessionId,
      userId,
      datasetId || null,
      customerName || null,
      title,
      documentFilename,
      documentMarkdown
    );
    if (documentFilename && documentMarkdown != null) {
      db.prepare(
      `INSERT INTO conversation_outputs (
          id, session_id, filename, markdown_content, html_preview, pdf_base64, mime,
          output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
      ).run(
        randomUUID(),
        sessionId,
        documentFilename,
        documentMarkdown,
        documentHtml,
        documentPdfBase64,
        documentMime || "application/pdf",
        outputTypeId,
        outputTypeTitle,
        outputTypeKind,
        promptId,
        promptNameSnapshot,
        promptTextSnapshot
      );
    }

    return NextResponse.json({ conversation_id: sessionId });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
