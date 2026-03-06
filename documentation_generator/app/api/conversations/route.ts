import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { getDb } from "../../../lib/db";

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