type ColumnInfo = { name: string };

type ConversationSessionRow = {
  id: string;
  user_id: string;
  dataset_id: string | null;
  customer_name: string | null;
  title: string | null;
  document_filename: string | null;
  document_markdown: string | null;
  created_at: number;
  updated_at: number;
};

type ConversationMessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
};

type ConversationOutputRow = {
  id: string;
  session_id: string;
  filename: string;
  markdown_content: string;
  html_preview: string | null;
  pdf_base64: string | null;
  mime: string | null;
  output_type_id: string | null;
  output_type_title: string | null;
  output_type_kind: string | null;
  prompt_id: string | null;
  prompt_name_snapshot: string | null;
  prompt_text_snapshot: string | null;
  created_at: number;
  updated_at: number;
};

type UserSettingsRow = {
  user_id: string;
  system_prompt: string | null;
  active_prompt_id: string | null;
  active_prompt_text_snapshot: string | null;
  updated_at: number;
};

type SavedPromptRow = {
  id: string;
  user_id: string;
  name: string;
  name_normalized: string;
  prompt_text: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type MockDbState = {
  clock: number;
  conversation_sessions: ConversationSessionRow[];
  messages: ConversationMessageRow[];
  conversation_outputs: ConversationOutputRow[];
  user_settings: UserSettingsRow[];
  saved_prompts: SavedPromptRow[];
};

const schemaColumns: Record<string, ColumnInfo[]> = {
  conversation_sessions: [
    "id",
    "user_id",
    "dataset_id",
    "customer_name",
    "title",
    "document_filename",
    "document_markdown",
    "created_at",
    "updated_at",
  ].map((name) => ({ name })),
  messages: ["id", "session_id", "role", "content", "created_at"].map((name) => ({ name })),
  conversation_outputs: [
    "id",
    "session_id",
    "filename",
    "markdown_content",
    "html_preview",
    "pdf_base64",
    "mime",
    "output_type_id",
    "output_type_title",
    "output_type_kind",
    "prompt_id",
    "prompt_name_snapshot",
    "prompt_text_snapshot",
    "created_at",
    "updated_at",
  ].map((name) => ({ name })),
  user_settings: [
    "user_id",
    "system_prompt",
    "active_prompt_id",
    "active_prompt_text_snapshot",
    "updated_at",
  ].map((name) => ({ name })),
  saved_prompts: [
    "id",
    "user_id",
    "name",
    "name_normalized",
    "prompt_text",
    "created_at",
    "updated_at",
    "deleted_at",
  ].map((name) => ({ name })),
};

const registry = new Set<MockBetterSqliteDatabase>();

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function createEmptyState(): MockDbState {
  return {
    clock: 1,
    conversation_sessions: [],
    messages: [],
    conversation_outputs: [],
    user_settings: [],
    saved_prompts: [],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nextTimestamp(state: MockDbState): number {
  const value = state.clock;
  state.clock += 1;
  return value;
}

function getUserSettingsRow(state: MockDbState, userId: string): UserSettingsRow | undefined {
  return state.user_settings.find((row) => row.user_id === userId);
}

function upsertUserSettings(
  state: MockDbState,
  userId: string,
  systemPrompt: string | null,
  activePromptId: string | null,
  activePromptTextSnapshot: string | null
) {
  const existing = getUserSettingsRow(state, userId);
  const timestamp = nextTimestamp(state);
  if (existing) {
    existing.system_prompt = systemPrompt;
    existing.active_prompt_id = activePromptId;
    existing.active_prompt_text_snapshot = activePromptTextSnapshot;
    existing.updated_at = timestamp;
    return;
  }

  state.user_settings.push({
    user_id: userId,
    system_prompt: systemPrompt,
    active_prompt_id: activePromptId,
    active_prompt_text_snapshot: activePromptTextSnapshot,
    updated_at: timestamp,
  });
}

function deleteConversationSession(state: MockDbState, sessionId: string) {
  state.conversation_sessions = state.conversation_sessions.filter((row) => row.id !== sessionId);
  state.messages = state.messages.filter((row) => row.session_id !== sessionId);
  state.conversation_outputs = state.conversation_outputs.filter((row) => row.session_id !== sessionId);
}

function sortedSavedPrompts(rows: SavedPromptRow[]) {
  return [...rows].sort((a, b) => {
    if (a.updated_at !== b.updated_at) return b.updated_at - a.updated_at;
    if (a.created_at !== b.created_at) return b.created_at - a.created_at;
    return a.name.localeCompare(b.name);
  });
}

function selectLatestOutput(state: MockDbState, sessionId: string): ConversationOutputRow | undefined {
  return [...state.conversation_outputs]
    .filter((row) => row.session_id === sessionId)
    .sort((a, b) => {
      if (a.updated_at !== b.updated_at) return b.updated_at - a.updated_at;
      if (a.created_at !== b.created_at) return b.created_at - a.created_at;
      return a.id.localeCompare(b.id);
    })[0];
}

class MockStatement {
  constructor(
    private readonly db: MockBetterSqliteDatabase,
    private readonly sql: string
  ) {}

  get(...params: unknown[]) {
    return this.db.executeGet(this.sql, params);
  }

  all(...params: unknown[]) {
    return this.db.executeAll(this.sql, params);
  }

  run(...params: unknown[]) {
    return this.db.executeRun(this.sql, params);
  }
}

class MockBetterSqliteDatabase {
  private state: MockDbState = createEmptyState();

  constructor(public readonly path: string) {
    registry.add(this);
  }

  reset() {
    this.state = createEmptyState();
  }

  pragma() {
    return this;
  }

  exec(_sql: string) {
    return this;
  }

  prepare(sql: string) {
    return new MockStatement(this, normalizeSql(sql));
  }

  private getSchemaInfo(tableName: string): ColumnInfo[] {
    return clone(schemaColumns[tableName] ?? []);
  }

  private findSavedPrompt(
    userId: string,
    promptId: string,
    includeDeleted: boolean
  ): SavedPromptRow | undefined {
    return this.state.saved_prompts.find(
      (row) =>
        row.user_id === userId &&
        row.id === promptId &&
        (includeDeleted || row.deleted_at == null)
    );
  }

  executeAll(sql: string, params: unknown[]) {
    const state = this.state;

    if (sql === "pragma table_info(conversation_sessions)") {
      return this.getSchemaInfo("conversation_sessions");
    }
    if (sql === "pragma table_info(user_settings)") {
      return this.getSchemaInfo("user_settings");
    }
    if (sql === "pragma table_info(conversation_outputs)") {
      return this.getSchemaInfo("conversation_outputs");
    }

    if (
      sql.startsWith(
        "select id, dataset_id, customer_name, title, created_at, updated_at from conversation_sessions where user_id = ? order by updated_at desc"
      )
    ) {
      const [userId] = params as [string];
      return this.state.conversation_sessions
        .filter((row) => row.user_id === userId)
        .sort((a, b) => b.updated_at - a.updated_at)
        .map((row) => clone(row));
    }

    if (
      sql.startsWith(
        "select id, user_id, name, prompt_text, created_at, updated_at, deleted_at from saved_prompts where user_id = ?"
      )
    ) {
      const [userId] = params as [string];
      const includeDeleted = sql.includes("deleted_at is null") ? false : true;
      return sortedSavedPrompts(
        this.state.saved_prompts.filter(
          (row) => row.user_id === userId && (includeDeleted || row.deleted_at == null)
        )
      ).map((row) => clone(row));
    }

    if (
      sql.startsWith(
        "select id, role, content, created_at from messages where session_id = ? order by created_at asc"
      )
    ) {
      const [sessionId] = params as [string];
      return this.state.messages
        .filter((row) => row.session_id === sessionId)
        .sort((a, b) => a.created_at - b.created_at)
        .map((row) => clone(row));
    }

    return [];
  }

  executeGet(sql: string, params: unknown[]) {
    const state = this.state;

    if (
      sql.startsWith("select id from saved_prompts where user_id = ? and name_normalized = ?")
    ) {
      const [userId, nameKey, excludeId] = params as [string, string, string?];
      const row = this.state.saved_prompts.find((entry) => {
        if (entry.user_id !== userId) return false;
        if (entry.name_normalized !== nameKey) return false;
        if (entry.deleted_at != null) return false;
        if (excludeId && entry.id === excludeId) return false;
        return true;
      });
      return row ? { id: row.id } : undefined;
    }

    if (
      sql.startsWith(
        "select id, user_id, name, prompt_text, created_at, updated_at, deleted_at from saved_prompts where user_id = ? and id = ?"
      )
    ) {
      const [userId, promptId] = params as [string, string];
      const includeDeleted = !sql.includes("deleted_at is null");
      const row = this.findSavedPrompt(userId, promptId, includeDeleted);
      return row ? clone(row) : undefined;
    }

    if (sql.startsWith("select active_prompt_id from user_settings where user_id = ?")) {
      const [userId] = params as [string];
      const row = getUserSettingsRow(state, userId);
      return row ? { active_prompt_id: row.active_prompt_id } : undefined;
    }

    if (
      sql.startsWith(
        "select system_prompt, active_prompt_id, active_prompt_text_snapshot from user_settings where user_id = ?"
      )
    ) {
      const [userId] = params as [string];
      const row = getUserSettingsRow(state, userId);
      return row
        ? {
            system_prompt: row.system_prompt,
            active_prompt_id: row.active_prompt_id,
            active_prompt_text_snapshot: row.active_prompt_text_snapshot,
          }
        : undefined;
    }

    if (sql.startsWith("select system_prompt, active_prompt_id from user_settings where user_id = ?")) {
      const [userId] = params as [string];
      const row = getUserSettingsRow(state, userId);
      return row ? { system_prompt: row.system_prompt, active_prompt_id: row.active_prompt_id } : undefined;
    }

    if (sql.startsWith("select system_prompt from user_settings where user_id = ?")) {
      const [userId] = params as [string];
      const row = getUserSettingsRow(state, userId);
      return row ? { system_prompt: row.system_prompt } : undefined;
    }

    if (sql.startsWith("select id, dataset_id, customer_name, title, document_filename, document_markdown, created_at, updated_at from conversation_sessions where id = ? and user_id = ?")) {
      const [id, userId] = params as [string, string];
      const row = state.conversation_sessions.find((entry) => entry.id === id && entry.user_id === userId);
      return row ? clone(row) : undefined;
    }

    if (sql.startsWith("select id from conversation_sessions where id = ? and user_id = ?")) {
      const [id, userId] = params as [string, string];
      const row = state.conversation_sessions.find((entry) => entry.id === id && entry.user_id === userId);
      return row ? { id: row.id } : undefined;
    }

    if (
      sql.startsWith(
        "select id, filename, markdown_content, html_preview, pdf_base64, mime, output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot, created_at, updated_at from conversation_outputs where session_id = ? order by updated_at desc limit 1"
      )
    ) {
      const [sessionId] = params as [string];
      const output = selectLatestOutput(state, sessionId);
      return output ? clone(output) : undefined;
    }

    if (
      sql.startsWith(
        "select output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot from conversation_outputs where session_id = ?"
      )
    ) {
      const [sessionId] = params as [string];
      const output = selectLatestOutput(state, sessionId);
      if (!output) return undefined;
      return {
        output_type_id: output.output_type_id,
        output_type_title: output.output_type_title,
        output_type_kind: output.output_type_kind,
        prompt_id: output.prompt_id,
        prompt_name_snapshot: output.prompt_name_snapshot,
        prompt_text_snapshot: output.prompt_text_snapshot,
      };
    }

    if (
      sql.startsWith(
        "select filename, markdown_content, html_preview, pdf_base64, mime, output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot from conversation_outputs where session_id = ? order by updated_at desc limit 1"
      )
    ) {
      const [sessionId] = params as [string];
      const output = selectLatestOutput(state, sessionId);
      if (!output) return undefined;
      const {
        filename,
        markdown_content,
        html_preview,
        pdf_base64,
        mime,
        output_type_id,
        output_type_title,
        output_type_kind,
        prompt_id,
        prompt_name_snapshot,
        prompt_text_snapshot,
      } = output;
      return {
        filename,
        markdown_content,
        html_preview,
        pdf_base64,
        mime,
        output_type_id,
        output_type_title,
        output_type_kind,
        prompt_id,
        prompt_name_snapshot,
        prompt_text_snapshot,
      };
    }

    if (sql.startsWith("select id, filename, markdown_content, html_preview, pdf_base64, mime, output_type_id, output_type_title, output_type_kind, prompt_id, prompt_name_snapshot, prompt_text_snapshot, created_at, updated_at from conversation_outputs where session_id = ? order by updated_at desc limit 1")) {
      const [sessionId] = params as [string];
      const output = selectLatestOutput(state, sessionId);
      return output ? clone(output) : undefined;
    }

    if (sql.startsWith("select id, user_id, name, prompt_text, created_at, updated_at, deleted_at from saved_prompts where user_id = ? and id = ?")) {
      const [userId, promptId] = params as [string, string];
      const includeDeleted = !sql.includes("deleted_at is null");
      const row = this.findSavedPrompt(userId, promptId, includeDeleted);
      return row ? clone(row) : undefined;
    }

    if (sql.startsWith("select id, dataset_id, customer_name, title, created_at, updated_at from conversation_sessions where user_id = ? order by updated_at desc")) {
      const [userId] = params as [string];
      return state.conversation_sessions
        .filter((row) => row.user_id === userId)
        .sort((a, b) => b.updated_at - a.updated_at)
        .map((row) => clone(row));
    }

    if (sql.startsWith("select id, dataset_id, customer_name, title, document_filename, document_markdown, created_at, updated_at from conversation_sessions where id = ? and user_id = ?")) {
      const [id, userId] = params as [string, string];
      const row = state.conversation_sessions.find((entry) => entry.id === id && entry.user_id === userId);
      return row ? clone(row) : undefined;
    }

    if (sql.startsWith("select id, role, content, created_at from messages where session_id = ? order by created_at asc")) {
      const [sessionId] = params as [string];
      return state.messages
        .filter((row) => row.session_id === sessionId)
        .sort((a, b) => a.created_at - b.created_at)
        .map((row) => clone(row));
    }

    return undefined;
  }

  executeRun(sql: string, params: unknown[]) {
    const state = this.state;

    if (sql.startsWith("insert into saved_prompts")) {
      const [id, userId, name, nameNormalized, promptText] = params as [string, string, string, string, string];
      const timestamp = nextTimestamp(state);
      state.saved_prompts.push({
        id,
        user_id: userId,
        name,
        name_normalized: nameNormalized,
        prompt_text: promptText,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      });
      return { changes: 1, lastInsertRowid: id };
    }

    if (sql.startsWith("insert into user_settings")) {
      const [userId, systemPrompt, activePromptId, activePromptTextSnapshot] = params as [
        string,
        string | null,
        string | null,
        string | null | undefined,
      ];
      upsertUserSettings(
        state,
        userId,
        systemPrompt ?? null,
        activePromptId ?? null,
        activePromptTextSnapshot ?? null
      );
      return { changes: 1, lastInsertRowid: userId };
    }

    if (sql.startsWith("update saved_prompts set name = ?, name_normalized = ?, prompt_text = ?, updated_at = unixepoch() where id = ? and user_id = ?")) {
      const [nextName, nextNameNormalized, nextPromptText, promptId, userId] =
        params as [string, string, string, string, string];
      const row = state.saved_prompts.find((entry) => entry.id === promptId && entry.user_id === userId);
      if (row) {
        row.name = nextName;
        row.name_normalized = nextNameNormalized;
        row.prompt_text = nextPromptText;
        row.updated_at = nextTimestamp(state);
      }
      return { changes: row ? 1 : 0 };
    }

    if (
      sql.startsWith(
        "update user_settings set system_prompt = ?, active_prompt_text_snapshot = ?, updated_at = unixepoch() where user_id = ? and active_prompt_id = ?"
      )
    ) {
      const [systemPrompt, snapshot, userId, activePromptId] = params as [
        string | null,
        string | null,
        string,
        string,
      ];
      const row = getUserSettingsRow(state, userId);
      if (row && row.active_prompt_id === activePromptId) {
        row.system_prompt = systemPrompt ?? null;
        row.active_prompt_text_snapshot = snapshot ?? null;
        row.updated_at = nextTimestamp(state);
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    if (sql.startsWith("update saved_prompts set deleted_at = unixepoch(), updated_at = unixepoch() where id = ? and user_id = ?")) {
      const [promptId, userId] = params as [string, string];
      const row = state.saved_prompts.find((entry) => entry.id === promptId && entry.user_id === userId);
      if (row) {
        row.deleted_at = nextTimestamp(state);
        row.updated_at = nextTimestamp(state);
        const activeRow = getUserSettingsRow(state, userId);
        if (activeRow && activeRow.active_prompt_id === promptId) {
          const restored = activeRow.active_prompt_text_snapshot ?? activeRow.system_prompt;
          activeRow.system_prompt = restored;
          activeRow.active_prompt_id = null;
          activeRow.active_prompt_text_snapshot = null;
          activeRow.updated_at = nextTimestamp(state);
        }
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    if (sql.startsWith("update user_settings set active_prompt_id = null, updated_at = unixepoch() where user_id = ? and active_prompt_id = ?")) {
      const [userId, activePromptId] = params as [string, string];
      const row = getUserSettingsRow(state, userId);
      if (row && row.active_prompt_id === activePromptId) {
        row.active_prompt_id = null;
        row.active_prompt_text_snapshot = null;
        row.updated_at = nextTimestamp(state);
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    if (sql.startsWith("insert into conversation_sessions")) {
      const [id, userId, datasetId, customerName, title, documentFilename, documentMarkdown] =
        params as [string, string, string | null, string | null, string | null, string | null, string | null];
      const timestamp = nextTimestamp(state);
      state.conversation_sessions.push({
        id,
        user_id: userId,
        dataset_id: datasetId ?? null,
        customer_name: customerName ?? null,
        title: title ?? null,
        document_filename: documentFilename ?? null,
        document_markdown: documentMarkdown ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      });
      return { changes: 1, lastInsertRowid: id };
    }

    if (sql.startsWith("insert into conversation_outputs")) {
      const [
        id,
        sessionId,
        filename,
        markdownContent,
        htmlPreview,
        pdfBase64,
        mime,
        outputTypeId,
        outputTypeTitle,
        outputTypeKind,
        promptId,
        promptNameSnapshot,
        promptTextSnapshot,
      ] = params as [
        string,
        string,
        string,
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
      ];
      const timestamp = nextTimestamp(state);
      state.conversation_outputs.push({
        id,
        session_id: sessionId,
        filename,
        markdown_content: markdownContent,
        html_preview: htmlPreview ?? null,
        pdf_base64: pdfBase64 ?? null,
        mime: mime ?? "application/pdf",
        output_type_id: outputTypeId ?? null,
        output_type_title: outputTypeTitle ?? null,
        output_type_kind: outputTypeKind ?? null,
        prompt_id: promptId ?? null,
        prompt_name_snapshot: promptNameSnapshot ?? null,
        prompt_text_snapshot: promptTextSnapshot ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      });
      return { changes: 1, lastInsertRowid: id };
    }

    if (sql.startsWith("update conversation_sessions set document_filename = ?, document_markdown = ?, updated_at = unixepoch() where id = ?")) {
      const [documentFilename, documentMarkdown, id] = params as [string | null, string | null, string];
      const row = state.conversation_sessions.find((entry) => entry.id === id);
      if (row) {
        row.document_filename = documentFilename ?? null;
        row.document_markdown = documentMarkdown ?? null;
        row.updated_at = nextTimestamp(state);
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    if (sql.startsWith("update conversation_sessions set")) {
      const id = String(params[params.length - 1]);
      const row = state.conversation_sessions.find((entry) => entry.id === id);
      if (!row) return { changes: 0 };
      const fields: Array<keyof ConversationSessionRow> = [];
      if (sql.includes("dataset_id = ?")) fields.push("dataset_id");
      if (sql.includes("customer_name = ?")) fields.push("customer_name");
      if (sql.includes("title = ?")) fields.push("title");
      let index = 0;
      for (const field of fields) {
        const nextValue = params[index++] as string | null;
        row[field] = nextValue ?? null;
      }
      row.updated_at = nextTimestamp(state);
      return { changes: 1 };
    }

    if (sql.startsWith("delete from conversation_sessions where id = ?")) {
      const [id] = params as [string];
      deleteConversationSession(state, id);
      return { changes: 1 };
    }

    if (sql.startsWith("insert into messages")) {
      const [id, sessionId, role, content] = params as [string, string, string, string];
      const timestamp = nextTimestamp(state);
      state.messages.push({
        id,
        session_id: sessionId,
        role,
        content,
        created_at: timestamp,
      });
      return { changes: 1, lastInsertRowid: id };
    }

    if (sql.startsWith("update user_settings set system_prompt = ? , active_prompt_id = ?")) {
      return { changes: 0 };
    }

    if (sql.startsWith("update user_settings set system_prompt = ?, active_prompt_id = ?, updated_at = unixepoch() where user_id = ? and active_prompt_id = ?")) {
      return { changes: 0 };
    }

    if (sql.startsWith("update user_settings set system_prompt = ?, active_prompt_id = ?, updated_at = unixepoch()")) {
      return { changes: 0 };
    }

    if (
      sql.startsWith(
        "update user_settings set system_prompt = ?, active_prompt_text_snapshot = ?, active_prompt_id = ?, updated_at = unixepoch() where user_id = ? and active_prompt_id = ?"
      ) ||
      sql.startsWith(
        "update user_settings set system_prompt = ?, active_prompt_text_snapshot = ?, active_prompt_id = ?, updated_at = unixepoch()"
      )
    ) {
      return { changes: 0 };
    }

    return { changes: 0 };
  }
}

export function resetMockBetterSqlite3() {
  for (const db of registry) {
    db.reset();
  }
}

export default MockBetterSqliteDatabase;
