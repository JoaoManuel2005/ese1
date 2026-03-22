import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "./db";

export type SavedPrompt = {
  id: string;
  userId: string;
  name: string;
  promptText: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export class SavedPromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedPromptValidationError";
  }
}

export class SavedPromptConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedPromptConflictError";
  }
}

export class SavedPromptNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedPromptNotFoundError";
  }
}

type SavedPromptRow = {
  id: string;
  user_id: string;
  name: string;
  prompt_text: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

const BUILTIN_OUTPUT_TYPES_PATH = path.join(process.cwd(), "config", "output-types.json");
const RESERVED_PROMPT_NAMES = new Set<string>();

try {
  const raw = fs.readFileSync(BUILTIN_OUTPUT_TYPES_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Array<{ id?: string; title?: string }>;
  for (const entry of parsed) {
    if (typeof entry?.id === "string" && entry.id.trim()) {
      RESERVED_PROMPT_NAMES.add(entry.id.trim().toLocaleLowerCase());
    }
    if (typeof entry?.title === "string" && entry.title.trim()) {
      RESERVED_PROMPT_NAMES.add(entry.title.trim().toLocaleLowerCase());
    }
  }
} catch {
  RESERVED_PROMPT_NAMES.add("documentation");
  RESERVED_PROMPT_NAMES.add("diagrams");
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function rowToSavedPrompt(row: SavedPromptRow): SavedPrompt {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    promptText: row.prompt_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  };
}

function assertValidPromptName(name: unknown): string {
  const normalized = normalizeOptionalString(name);
  if (!normalized) {
    throw new SavedPromptValidationError("Prompt name is required.");
  }
  if (RESERVED_PROMPT_NAMES.has(normalizeNameKey(normalized))) {
    throw new SavedPromptValidationError("Prompt name conflicts with a built-in output type.");
  }
  return normalized;
}

function assertValidPromptText(promptText: unknown): string {
  const normalized = normalizeOptionalString(promptText);
  if (!normalized) {
    throw new SavedPromptValidationError("Prompt content is required.");
  }
  return normalized;
}

function ensureUniquePromptName(userId: string, name: string, excludePromptId?: string) {
  const db = getDb();
  const nameKey = normalizeNameKey(name);
  const stmt = db.prepare(
    `SELECT id
     FROM saved_prompts
     WHERE user_id = ?
       AND name_normalized = ?
       AND deleted_at IS NULL
       ${excludePromptId ? "AND id != ?" : ""}
     LIMIT 1`
  );
  const conflict = (excludePromptId
    ? stmt.get(userId, nameKey, excludePromptId)
    : stmt.get(userId, nameKey)) as { id: string } | undefined;

  if (conflict) {
    throw new SavedPromptConflictError(`A saved prompt named "${name}" already exists.`);
  }
}

export function listSavedPrompts(userId: string, includeDeleted = false): SavedPrompt[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, user_id, name, prompt_text, created_at, updated_at, deleted_at
       FROM saved_prompts
       WHERE user_id = ?
         ${includeDeleted ? "" : "AND deleted_at IS NULL"}
       ORDER BY updated_at DESC, created_at DESC, name ASC`
    )
    .all(userId) as SavedPromptRow[];

  return rows.map(rowToSavedPrompt);
}

export function getSavedPrompt(userId: string, promptId: string, includeDeleted = false): SavedPrompt | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id, name, prompt_text, created_at, updated_at, deleted_at
       FROM saved_prompts
       WHERE user_id = ?
         AND id = ?
         ${includeDeleted ? "" : "AND deleted_at IS NULL"}
       LIMIT 1`
    )
    .get(userId, promptId) as SavedPromptRow | undefined;

  return row ? rowToSavedPrompt(row) : null;
}

export function createSavedPrompt(
  userId: string,
  nameInput: unknown,
  promptTextInput: unknown
): SavedPrompt {
  const name = assertValidPromptName(nameInput);
  const promptText = assertValidPromptText(promptTextInput);
  ensureUniquePromptName(userId, name);

  const db = getDb();
  const id = randomUUID();
  const nameKey = normalizeNameKey(name);

  db.prepare(
    `INSERT INTO saved_prompts (
      id, user_id, name, name_normalized, prompt_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`
  ).run(id, userId, name, nameKey, promptText);

  db.prepare(
    `INSERT INTO user_settings (user_id, system_prompt, active_prompt_id, updated_at)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       system_prompt = excluded.system_prompt,
       active_prompt_id = excluded.active_prompt_id,
       updated_at = unixepoch()`
  ).run(userId, promptText, id);

  const created = getSavedPrompt(userId, id);
  if (!created) {
    throw new Error("Failed to create saved prompt.");
  }

  return created;
}

export function updateSavedPrompt(
  userId: string,
  promptId: string,
  updates: {
    name?: unknown;
    promptText?: unknown;
  }
): SavedPrompt {
  const existing = getSavedPrompt(userId, promptId, true);
  if (!existing) {
    throw new SavedPromptNotFoundError("Saved prompt not found.");
  }
  if (existing.deletedAt != null) {
    throw new SavedPromptNotFoundError("Saved prompt not found.");
  }

  const nextName = updates.name !== undefined ? assertValidPromptName(updates.name) : existing.name;
  const nextPromptText = updates.promptText !== undefined ? assertValidPromptText(updates.promptText) : existing.promptText;

  if (normalizeNameKey(nextName) !== normalizeNameKey(existing.name)) {
    ensureUniquePromptName(userId, nextName, promptId);
  }

  const db = getDb();
  db.prepare(
    `UPDATE saved_prompts
     SET name = ?,
         name_normalized = ?,
         prompt_text = ?,
         updated_at = unixepoch()
     WHERE id = ? AND user_id = ?`
  ).run(nextName, normalizeNameKey(nextName), nextPromptText, promptId, userId);

  const activeSelection = db
    .prepare(`SELECT active_prompt_id FROM user_settings WHERE user_id = ?`)
    .get(userId) as { active_prompt_id: string | null } | undefined;
  if (activeSelection?.active_prompt_id === promptId) {
    db.prepare(
      `UPDATE user_settings
       SET system_prompt = ?,
           updated_at = unixepoch()
       WHERE user_id = ? AND active_prompt_id = ?`
    ).run(nextPromptText, userId, promptId);
  }

  const updated = getSavedPrompt(userId, promptId);
  if (!updated) {
    throw new SavedPromptNotFoundError("Saved prompt not found.");
  }
  return updated;
}

export function deleteSavedPrompt(userId: string, promptId: string): void {
  const db = getDb();
  const existing = getSavedPrompt(userId, promptId, true);
  if (!existing) {
    throw new SavedPromptNotFoundError("Saved prompt not found.");
  }

  db.prepare(
    `UPDATE saved_prompts
     SET deleted_at = unixepoch(),
         updated_at = unixepoch()
     WHERE id = ? AND user_id = ?`
  ).run(promptId, userId);

  db.prepare(
    `UPDATE user_settings
     SET active_prompt_id = NULL,
         updated_at = unixepoch()
     WHERE user_id = ? AND active_prompt_id = ?`
  ).run(userId, promptId);
}

export function selectSavedPromptForUser(userId: string, promptId: string): SavedPrompt {
  const prompt = getSavedPrompt(userId, promptId);
  if (!prompt) {
    throw new SavedPromptNotFoundError("Saved prompt not found.");
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO user_settings (user_id, system_prompt, active_prompt_id, updated_at)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       system_prompt = excluded.system_prompt,
       active_prompt_id = excluded.active_prompt_id,
       updated_at = unixepoch()`
  ).run(userId, prompt.promptText, prompt.id);

  return prompt;
}

export function getSavedPromptSelection(userId: string): { systemPrompt: string | null; activePromptId: string | null } {
  const db = getDb();
  const row = db
    .prepare(`SELECT system_prompt, active_prompt_id FROM user_settings WHERE user_id = ?`)
    .get(userId) as { system_prompt: string | null; active_prompt_id: string | null } | undefined;

  return {
    systemPrompt: normalizeOptionalString(row?.system_prompt),
    activePromptId: normalizeOptionalString(row?.active_prompt_id),
  };
}
