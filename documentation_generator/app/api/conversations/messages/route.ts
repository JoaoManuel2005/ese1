import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { getDb } from "../../../../lib/db";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.email;

  try {
    const body = await req.json();
    const { conversation_id: conversationId, dataset_id: datasetId, messages } = body as {
      conversation_id?: string;
      dataset_id?: string;
      messages: Array<{ role: string; content: string }>;
    };
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages array required" }, { status: 400 });
    }

    const db = getDb();
    let sessionId = conversationId;

    if (!sessionId) {
      sessionId = randomUUID();
      db.prepare(
        `INSERT INTO conversation_sessions (id, user_id, dataset_id, title, created_at, updated_at)
         VALUES (?, ?, ?, 'New chat', unixepoch(), unixepoch())`
      ).run(sessionId, userId, datasetId ?? null);
    } else {
      const row = db.prepare("SELECT id FROM conversation_sessions WHERE id = ? AND user_id = ?").get(sessionId, userId);
      if (!row) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
    }

    const insert = db.prepare(
      "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, unixepoch())"
    );
    for (const msg of messages) {
      insert.run(randomUUID(), sessionId, msg.role, msg.content);
    }
    db.prepare("UPDATE conversation_sessions SET updated_at = unixepoch() WHERE id = ?").run(sessionId);

    return NextResponse.json({ conversation_id: sessionId });
  } catch (e: unknown) {
    console.error("Conversations messages error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}