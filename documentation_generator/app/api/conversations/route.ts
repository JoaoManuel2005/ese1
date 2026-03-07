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

    return NextResponse.json({ conversation_id: sessionId });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
