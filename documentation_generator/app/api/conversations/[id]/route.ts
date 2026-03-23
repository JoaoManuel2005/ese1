import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { getDb } from "../../../../lib/db";
import { randomUUID } from "crypto";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.email;
  const { id } = await params;

  const db = getDb();
  const sessionRow = db
    .prepare(
      `SELECT id, dataset_id, customer_name, title, document_filename, document_markdown, created_at, updated_at
       FROM conversation_sessions
       WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as
    | {
        id: string;
        dataset_id: string | null;
        customer_name: string | null;
        title: string | null;
        document_filename: string | null;
        document_markdown: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  if (!sessionRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messageRows = db
    .prepare(
      `SELECT id, role, content, created_at
       FROM messages
       WHERE session_id = ?
       ORDER BY created_at ASC`
    )
    .all(id) as Array<{
    id: string;
    role: string;
    content: string;
    created_at: number;
  }>;
  const latestOutput = db
    .prepare(
      `SELECT id, filename, markdown_content, html_preview, pdf_base64, mime,
              output_type_id, output_type_title, output_type_kind,
              prompt_id, prompt_name_snapshot, prompt_text_snapshot,
              created_at, updated_at
       FROM conversation_outputs
       WHERE session_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(id) as
    | {
        id: string;
        filename: string;
        markdown_content: string;
        html_preview: string | null;
        pdf_base64: string | null;
        mime: string | null;
        output_type_id: string | null;
        output_type_title: string | null;
        output_type_kind: string | null;
        prompt_id: string | null;
        prompt_name_snapshot: string | null;
        prompt_text_snapshot: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  return NextResponse.json({
    id: sessionRow.id,
    dataset_id: sessionRow.dataset_id,
    customer_name: sessionRow.customer_name,
    title: sessionRow.title,
    document_filename: latestOutput?.filename ?? sessionRow.document_filename,
    document_markdown: latestOutput?.markdown_content ?? sessionRow.document_markdown,
    output: latestOutput
      ? {
          id: latestOutput.id,
          filename: latestOutput.filename,
          markdown_content: latestOutput.markdown_content,
          html_preview: latestOutput.html_preview,
          pdf_base64: latestOutput.pdf_base64,
          mime: latestOutput.mime ?? "application/pdf",
          output_type_id: latestOutput.output_type_id,
          output_type_title: latestOutput.output_type_title,
          output_type_kind: latestOutput.output_type_kind,
          prompt_id: latestOutput.prompt_id,
          prompt_name_snapshot: latestOutput.prompt_name_snapshot,
          prompt_text_snapshot: latestOutput.prompt_text_snapshot,
          created_at: latestOutput.created_at,
          updated_at: latestOutput.updated_at,
        }
      : null,
    created_at: sessionRow.created_at,
    updated_at: sessionRow.updated_at,
    messages: messageRows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    })),
  });
}
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.email;
  const { id } = await params;

  const db = getDb();
  const row = db.prepare(
    `SELECT id FROM conversation_sessions WHERE id = ? AND user_id = ?`
  ).get(id, userId);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  db.prepare(`DELETE FROM conversation_sessions WHERE id = ?`).run(id);
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.email;
  const { id } = await params;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      dataset_id?: string | null;
      customer_name?: string;
      title?: string;
      document_filename?: string | null;
      document_markdown?: string | null;
      document_html?: string | null;
      document_pdf_base64?: string | null;
      document_mime?: string | null;
      output_type_id?: string | null;
      output_type_title?: string | null;
      output_type_kind?: string | null;
      prompt_id?: string | null;
      prompt_name_snapshot?: string | null;
      prompt_text_snapshot?: string | null;
    };
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid conversation payload." }, { status: 400 });
    }
    const datasetId = "dataset_id" in body
      ? typeof body.dataset_id === "string"
        ? body.dataset_id.trim() || null
        : body.dataset_id == null
          ? null
          : undefined
      : undefined;
    const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : undefined;
    const title = typeof body.title === "string" ? body.title.trim() : undefined;
    const documentFilename = "document_filename" in body
      ? typeof body.document_filename === "string"
        ? body.document_filename.trim() || null
        : body.document_filename == null
          ? null
          : undefined
      : undefined;
    const documentMarkdown = "document_markdown" in body
      ? typeof body.document_markdown === "string"
        ? body.document_markdown
        : body.document_markdown == null
          ? null
          : undefined
      : undefined;
    const documentHtml = "document_html" in body
      ? typeof body.document_html === "string"
        ? body.document_html
        : body.document_html == null
          ? null
          : undefined
      : undefined;
    const documentPdfBase64 = "document_pdf_base64" in body
      ? typeof body.document_pdf_base64 === "string"
        ? body.document_pdf_base64
        : body.document_pdf_base64 == null
          ? null
          : undefined
      : undefined;
    const documentMime = "document_mime" in body
      ? typeof body.document_mime === "string"
        ? body.document_mime.trim() || null
        : body.document_mime == null
          ? null
          : undefined
      : undefined;
    const outputTypeId = "output_type_id" in body
      ? typeof body.output_type_id === "string"
        ? body.output_type_id.trim() || null
        : body.output_type_id == null
          ? null
          : undefined
      : undefined;
    const outputTypeTitle = "output_type_title" in body
      ? typeof body.output_type_title === "string"
        ? body.output_type_title.trim() || null
        : body.output_type_title == null
          ? null
          : undefined
      : undefined;
    const outputTypeKind = "output_type_kind" in body
      ? typeof body.output_type_kind === "string"
        ? body.output_type_kind.trim() || null
        : body.output_type_kind == null
          ? null
          : undefined
      : undefined;
    const promptId = "prompt_id" in body
      ? typeof body.prompt_id === "string"
        ? body.prompt_id.trim() || null
        : body.prompt_id == null
          ? null
          : undefined
      : undefined;
    const promptNameSnapshot = "prompt_name_snapshot" in body
      ? typeof body.prompt_name_snapshot === "string"
        ? body.prompt_name_snapshot.trim() || null
        : body.prompt_name_snapshot == null
          ? null
          : undefined
      : undefined;
    const promptTextSnapshot = "prompt_text_snapshot" in body
      ? typeof body.prompt_text_snapshot === "string"
        ? body.prompt_text_snapshot
        : body.prompt_text_snapshot == null
          ? null
          : undefined
      : undefined;
    const hasOutputUpdate =
      documentFilename !== undefined ||
      documentMarkdown !== undefined ||
      documentHtml !== undefined ||
      documentPdfBase64 !== undefined ||
      documentMime !== undefined;

    if (datasetId === undefined && "dataset_id" in body) {
      return NextResponse.json({ error: "dataset_id must be a string or null" }, { status: 400 });
    }
    if (documentFilename === undefined && "document_filename" in body) {
      return NextResponse.json({ error: "document_filename must be a string or null" }, { status: 400 });
    }
    if (documentMarkdown === undefined && "document_markdown" in body) {
      return NextResponse.json({ error: "document_markdown must be a string or null" }, { status: 400 });
    }
    if (documentHtml === undefined && "document_html" in body) {
      return NextResponse.json({ error: "document_html must be a string or null" }, { status: 400 });
    }
    if (documentPdfBase64 === undefined && "document_pdf_base64" in body) {
      return NextResponse.json({ error: "document_pdf_base64 must be a string or null" }, { status: 400 });
    }
    if (documentMime === undefined && "document_mime" in body) {
      return NextResponse.json({ error: "document_mime must be a string or null" }, { status: 400 });
    }
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

    if (
      datasetId === undefined &&
      customerName === undefined &&
      title === undefined &&
      !hasOutputUpdate
    ) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = getDb();
    const row = db
      .prepare("SELECT id FROM conversation_sessions WHERE id = ? AND user_id = ?")
      .get(id, userId);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const assignments: string[] = [];
    const values: Array<string | null> = [];

    if (datasetId !== undefined) {
      assignments.push("dataset_id = ?");
      values.push(datasetId);
    }
    if (customerName !== undefined) {
      assignments.push("customer_name = ?");
      values.push(customerName || null);
    }
    if (title !== undefined) {
      assignments.push("title = ?");
      values.push(title || null);
    }

    if (assignments.length > 0) {
      db.prepare(
        `UPDATE conversation_sessions
         SET ${assignments.join(", ")}, updated_at = unixepoch()
         WHERE id = ?`
      ).run(...values, id);
    }

    if (hasOutputUpdate) {
      const previousOutput = db
        .prepare(
          `SELECT filename, markdown_content, html_preview, pdf_base64, mime,
                  output_type_id, output_type_title, output_type_kind,
                  prompt_id, prompt_name_snapshot, prompt_text_snapshot
           FROM conversation_outputs
           WHERE session_id = ?
           ORDER BY updated_at DESC
           LIMIT 1`
        )
        .get(id) as
        | {
            filename: string;
            markdown_content: string;
            html_preview: string | null;
            pdf_base64: string | null;
            mime: string | null;
            output_type_id: string | null;
            output_type_title: string | null;
            output_type_kind: string | null;
            prompt_id: string | null;
            prompt_name_snapshot: string | null;
            prompt_text_snapshot: string | null;
          }
        | undefined;

      const nextFilename = documentFilename ?? previousOutput?.filename;
      const nextMarkdown = documentMarkdown ?? previousOutput?.markdown_content;

      if (!nextFilename || nextMarkdown == null) {
        return NextResponse.json(
          { error: "document_filename and document_markdown are required when saving output" },
          { status: 400 }
        );
      }

      const nextHtml = documentHtml ?? previousOutput?.html_preview ?? null;
      const nextPdfBase64 = documentPdfBase64 ?? previousOutput?.pdf_base64 ?? null;
      const nextMime = documentMime ?? previousOutput?.mime ?? "application/pdf";
      const nextOutputTypeId = outputTypeId ?? previousOutput?.output_type_id ?? null;
      const nextOutputTypeTitle = outputTypeTitle ?? previousOutput?.output_type_title ?? null;
      const nextOutputTypeKind = outputTypeKind ?? previousOutput?.output_type_kind ?? null;
      const nextPromptId = promptId ?? previousOutput?.prompt_id ?? null;
      const nextPromptNameSnapshot = promptNameSnapshot ?? previousOutput?.prompt_name_snapshot ?? null;
      const nextPromptTextSnapshot = promptTextSnapshot ?? previousOutput?.prompt_text_snapshot ?? null;

      db.prepare(
        `INSERT INTO conversation_outputs (
          id, session_id, filename, markdown_content, html_preview, pdf_base64, mime,
          output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
      ).run(
        randomUUID(),
        id,
        nextFilename,
        nextMarkdown,
        nextHtml,
        nextPdfBase64,
        nextMime,
        nextOutputTypeId,
        nextOutputTypeTitle,
        nextOutputTypeKind,
        nextPromptId,
        nextPromptNameSnapshot,
        nextPromptTextSnapshot
      );
      db.prepare("UPDATE conversation_sessions SET document_filename = ?, document_markdown = ?, updated_at = unixepoch() WHERE id = ?")
        .run(nextFilename, nextMarkdown, id);
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
