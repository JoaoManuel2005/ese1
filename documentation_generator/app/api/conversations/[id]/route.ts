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
      `SELECT id, dataset_id, title, created_at, updated_at
       FROM conversation_sessions
       WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as
    | {
        id: string;
        dataset_id: string | null;
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