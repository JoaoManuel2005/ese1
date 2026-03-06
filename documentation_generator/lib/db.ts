import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = process.env.RUNTIME_CONFIG_PATH
  ? path.dirname(process.env.RUNTIME_CONFIG_PATH)  // reuse the mounted volume dir
  : path.join(process.cwd(), "runtime-data");
const DB_PATH = path.join(DB_DIR, "chat.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      dataset_id TEXT,
      customer_name TEXT,
      title TEXT DEFAULT 'New chat',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON conversation_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      system_prompt TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const sessionColumns = db
    .prepare("PRAGMA table_info(conversation_sessions)")
    .all() as Array<{ name: string }>;
  const hasCustomerName = sessionColumns.some((col) => col.name === "customer_name");
  if (!hasCustomerName) {
    db.exec("ALTER TABLE conversation_sessions ADD COLUMN customer_name TEXT;");
  }

  return db;
}

export { getDb };