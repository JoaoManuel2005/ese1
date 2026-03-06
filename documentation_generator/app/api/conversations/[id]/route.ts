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
      `SELECT id, dataset_id, customer_name, title, created_at, updated_at
       FROM conversation_sessions
       WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as
    | {
        id: string;
        dataset_id: string | null;
        customer_name: string | null;
        title: string | null;
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
    };
    const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : undefined;
    const title = typeof body.title === "string" ? body.title.trim() : undefined;

    if (customerName === undefined && title === undefined) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = getDb();
    const row = db
      .prepare("SELECT id FROM conversation_sessions WHERE id = ? AND user_id = ?")
      .get(id, userId);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (customerName !== undefined && title !== undefined) {
      db.prepare(
        "UPDATE conversation_sessions SET customer_name = ?, title = ?, updated_at = unixepoch() WHERE id = ?"
      ).run(customerName || null, title || null, id);
    } else if (customerName !== undefined) {
      db.prepare(
        "UPDATE conversation_sessions SET customer_name = ?, updated_at = unixepoch() WHERE id = ?"
      ).run(customerName || null, id);
    } else if (title !== undefined) {
      db.prepare(
        "UPDATE conversation_sessions SET title = ?, updated_at = unixepoch() WHERE id = ?"
      ).run(title || null, id);
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}