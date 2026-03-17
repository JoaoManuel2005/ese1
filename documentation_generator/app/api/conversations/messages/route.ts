import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { getDb } from "../../../../lib/db";
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

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.email;

  try {
    const body = await req.json();
    const {
      conversation_id: conversationId,
      dataset_id: datasetId,
      customer_name: customerName,
      messages,
    } = body as {
      conversation_id?: string;
      dataset_id?: string;
      customer_name?: string;
      messages: Array<{ role: string; content: string }>;
    };
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages array required" }, { status: 400 });
    }

    const db = getDb();
    let sessionId = conversationId;

    if (!sessionId) {
      sessionId = randomUUID();
      const trimmedCustomer = customerName?.trim() || null;
      const title = buildConversationTitle(trimmedCustomer ?? undefined);
      db.prepare(
        `INSERT INTO conversation_sessions (id, user_id, dataset_id, customer_name, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`
      ).run(sessionId, userId, datasetId ?? null, trimmedCustomer, title);
    } else {
      const row = db.prepare("SELECT id FROM conversation_sessions WHERE id = ? AND user_id = ?").get(sessionId, userId);
      if (!row) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
      if (datasetId !== undefined && customerName !== undefined) {
        const trimmedCustomer = customerName.trim() || null;
        db.prepare(
          "UPDATE conversation_sessions SET dataset_id = ?, customer_name = ?, updated_at = unixepoch() WHERE id = ?"
        ).run(datasetId ?? null, trimmedCustomer, sessionId);
      } else if (datasetId !== undefined) {
        db.prepare(
          "UPDATE conversation_sessions SET dataset_id = ?, updated_at = unixepoch() WHERE id = ?"
        ).run(datasetId ?? null, sessionId);
      } else if (customerName !== undefined) {
        const trimmedCustomer = customerName.trim() || null;
        db.prepare(
          "UPDATE conversation_sessions SET customer_name = ?, updated_at = unixepoch() WHERE id = ?"
        ).run(trimmedCustomer, sessionId);
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