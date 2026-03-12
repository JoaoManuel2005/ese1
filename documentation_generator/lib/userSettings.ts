import { getDb } from "./db";

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getUserSystemPrompt(userId: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT system_prompt FROM user_settings WHERE user_id = ?`)
    .get(userId) as { system_prompt: string | null } | undefined;

  if (!row) return null;
  return normalizeOptionalString(row.system_prompt);
}

export function upsertUserSystemPrompt(userId: string, systemPrompt: string | null): string | null {
  const db = getDb();
  const normalized = normalizeOptionalString(systemPrompt);

  db.prepare(
    `INSERT INTO user_settings (user_id, system_prompt, updated_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       system_prompt = excluded.system_prompt,
       updated_at = unixepoch()`
  ).run(userId, normalized);

  return normalized;
}
