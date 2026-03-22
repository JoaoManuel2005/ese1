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
  const database = db;
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      dataset_id TEXT,
      customer_name TEXT,
      title TEXT DEFAULT 'New chat',
      document_filename TEXT,
      document_markdown TEXT,
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
    CREATE TABLE IF NOT EXISTS conversation_outputs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      markdown_content TEXT NOT NULL,
      html_preview TEXT,
      pdf_base64 TEXT,
      mime TEXT DEFAULT 'application/pdf',
      output_type_id TEXT,
      output_type_title TEXT,
      output_type_kind TEXT,
      prompt_id TEXT,
      prompt_name_snapshot TEXT,
      prompt_text_snapshot TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_outputs_session ON conversation_outputs(session_id);
    CREATE INDEX IF NOT EXISTS idx_outputs_updated ON conversation_outputs(updated_at DESC);

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      system_prompt TEXT,
      active_prompt_id TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS saved_prompts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_saved_prompts_user ON saved_prompts(user_id);
    CREATE INDEX IF NOT EXISTS idx_saved_prompts_updated ON saved_prompts(updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_prompts_user_name_active
      ON saved_prompts(user_id, name_normalized)
      WHERE deleted_at IS NULL;
  `);

  const sessionColumns = database
    .prepare("PRAGMA table_info(conversation_sessions)")
    .all() as Array<{ name: string }>;
  const hasCustomerName = sessionColumns.some((col) => col.name === "customer_name");
  if (!hasCustomerName) {
    database.exec("ALTER TABLE conversation_sessions ADD COLUMN customer_name TEXT;");
  }
  const hasDocumentFilename = sessionColumns.some((col) => col.name === "document_filename");
  if (!hasDocumentFilename) {
    database.exec("ALTER TABLE conversation_sessions ADD COLUMN document_filename TEXT;");
  }
  const hasDocumentMarkdown = sessionColumns.some((col) => col.name === "document_markdown");
  if (!hasDocumentMarkdown) {
    database.exec("ALTER TABLE conversation_sessions ADD COLUMN document_markdown TEXT;");
  }

  const settingsColumns = database
    .prepare("PRAGMA table_info(user_settings)")
    .all() as Array<{ name: string }>;
  const hasActivePromptId = settingsColumns.some((col) => col.name === "active_prompt_id");
  if (!hasActivePromptId) {
    database.exec("ALTER TABLE user_settings ADD COLUMN active_prompt_id TEXT;");
  }

  const outputColumns = database
    .prepare("PRAGMA table_info(conversation_outputs)")
    .all() as Array<{ name: string }>;
  const ensureOutputColumn = (column: string, type: "TEXT") => {
    if (!outputColumns.some((col) => col.name === column)) {
      database.exec(`ALTER TABLE conversation_outputs ADD COLUMN ${column} ${type};`);
    }
  };
  ensureOutputColumn("output_type_id", "TEXT");
  ensureOutputColumn("output_type_title", "TEXT");
  ensureOutputColumn("output_type_kind", "TEXT");
  ensureOutputColumn("prompt_id", "TEXT");
  ensureOutputColumn("prompt_name_snapshot", "TEXT");
  ensureOutputColumn("prompt_text_snapshot", "TEXT");

  // One-time migration from legacy session-level document columns to conversation_outputs.
  database.exec(`
    INSERT INTO conversation_outputs (
      id, session_id, filename, markdown_content, mime, created_at, updated_at
    )
    SELECT
      'legacy-' || id,
      id,
      document_filename,
      document_markdown,
      'application/pdf',
      created_at,
      updated_at
    FROM conversation_sessions s
    WHERE s.document_filename IS NOT NULL
      AND s.document_markdown IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM conversation_outputs o
        WHERE o.session_id = s.id
      );
  `);

  return database;
}

export { getDb };
