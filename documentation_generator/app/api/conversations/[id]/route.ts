import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { getDb } from "../../../../lib/db";

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

  return NextResponse.json({
    id: sessionRow.id,
    dataset_id: sessionRow.dataset_id,
    customer_name: sessionRow.customer_name,
    title: sessionRow.title,
    document_filename: sessionRow.document_filename,
    document_markdown: sessionRow.document_markdown,
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
    const body = (await req.json()) as {
      customer_name?: string;
      title?: string;
      document_filename?: string | null;
      document_markdown?: string | null;
    };
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

    if (documentFilename === undefined && "document_filename" in body) {
      return NextResponse.json({ error: "document_filename must be a string or null" }, { status: 400 });
    }
    if (documentMarkdown === undefined && "document_markdown" in body) {
      return NextResponse.json({ error: "document_markdown must be a string or null" }, { status: 400 });
    }

    if (
      customerName === undefined &&
      title === undefined &&
      documentFilename === undefined &&
      documentMarkdown === undefined
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

    if (customerName !== undefined) {
      assignments.push("customer_name = ?");
      values.push(customerName || null);
    }
    if (title !== undefined) {
      assignments.push("title = ?");
      values.push(title || null);
    }
    if (documentFilename !== undefined) {
      assignments.push("document_filename = ?");
      values.push(documentFilename);
    }
    if (documentMarkdown !== undefined) {
      assignments.push("document_markdown = ?");
      values.push(documentMarkdown);
    }

    db.prepare(
      `UPDATE conversation_sessions
       SET ${assignments.join(", ")}, updated_at = unixepoch()
       WHERE id = ?`
    ).run(...values, id);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
