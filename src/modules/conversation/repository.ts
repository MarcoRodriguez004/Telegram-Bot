const CONTEXT_TTL_MS = 15 * 60 * 1000;

export type SavedNotesContext = {
  kind: "all" | "photos" | "documents" | "links";
  folderId?: number | null;
  nextBeforeId?: number;
};

export type PendingListResource = "task" | "reminder";

export type PendingListContext = {
  resource: PendingListResource;
};

export type PendingConfirmationContext = {
  question: string;
  suggestedText: string;
};

type SavedNotesContextInput = SavedNotesContext & {
  userId: number;
  chatId: number;
  now?: Date;
};

type StoredContext = {
  note_kind: string;
  folder_id: number | null;
  next_before_id: number | null;
  expires_at: string;
};

type StoredPendingListContext = {
  resource_type: string;
  chat_id: number;
  expires_at: string;
};

type StoredPendingConfirmationContext = {
  question: string;
  suggested_text: string;
  expires_at: string;
};

export async function savePendingConfirmation(
  db: D1Database,
  input: { userId: number; chatId: number; question: string; suggestedText: string; now?: Date },
): Promise<void> {
  assertIdentifiers(input.userId, input.chatId);
  if (!input.question.trim() || input.question.length > 4_000) throw new Error("Confirmation question is invalid");
  if (!input.suggestedText.trim() || input.suggestedText.length > 4_000) throw new Error("Confirmation suggestion is invalid");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");
  const expiresAt = new Date(now.getTime() + CONTEXT_TTL_MS).toISOString();

  await db.prepare(
    "INSERT INTO conversation_confirmations (user_id, chat_id, question, suggested_text, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, question = excluded.question, suggested_text = excluded.suggested_text, created_at = excluded.created_at, expires_at = excluded.expires_at",
  ).bind(input.userId, input.chatId, input.question.trim(), input.suggestedText.trim(), now.toISOString(), expiresAt).run();
}

export async function getPendingConfirmation(
  db: D1Database,
  input: { userId: number; chatId: number; now?: Date },
): Promise<PendingConfirmationContext | null> {
  assertIdentifiers(input.userId, input.chatId);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");

  const row = await db.prepare(
    "SELECT question, suggested_text, expires_at FROM conversation_confirmations WHERE user_id = ? AND chat_id = ?",
  ).bind(input.userId, input.chatId).first<StoredPendingConfirmationContext>();

  if (!row) return null;
  if (!row.question || !row.suggested_text || !Number.isFinite(new Date(row.expires_at).getTime()) || new Date(row.expires_at).getTime() <= now.getTime()) {
    await clearPendingConfirmation(db, input.userId);
    return null;
  }

  return { question: row.question, suggestedText: row.suggested_text };
}

export async function clearPendingConfirmation(db: D1Database, userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Context user id is invalid");
  await db.prepare("DELETE FROM conversation_confirmations WHERE user_id = ?").bind(userId).run();
}

export async function savePendingListContext(
  db: D1Database,
  input: { userId: number; chatId: number; resource: PendingListResource; now?: Date },
): Promise<void> {
  assertIdentifiers(input.userId, input.chatId);
  if (input.resource !== "task" && input.resource !== "reminder") throw new Error("Pending list resource is invalid");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");
  const expiresAt = new Date(now.getTime() + CONTEXT_TTL_MS).toISOString();

  await db.prepare(
    "INSERT INTO pending_conversation (user_id, chat_id, resource_type, updated_at, expires_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, resource_type = excluded.resource_type, updated_at = excluded.updated_at, expires_at = excluded.expires_at",
  ).bind(input.userId, input.chatId, input.resource, now.toISOString(), expiresAt).run();
}

export async function getPendingListContext(
  db: D1Database,
  input: { userId: number; chatId: number; now?: Date },
): Promise<PendingListContext | null> {
  assertIdentifiers(input.userId, input.chatId);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");

  const row = await db.prepare(
    "SELECT resource_type, chat_id, expires_at FROM pending_conversation WHERE user_id = ? AND chat_id = ?",
  ).bind(input.userId, input.chatId).first<StoredPendingListContext>();

  if (!row) return null;
  if (!isValidPendingListContext(row) || new Date(row.expires_at).getTime() <= now.getTime()) {
    await clearPendingListContext(db, input.userId);
    return null;
  }

  return { resource: row.resource_type };
}

export async function clearPendingListContext(db: D1Database, userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Context user id is invalid");
  await db.prepare("DELETE FROM pending_conversation WHERE user_id = ?").bind(userId).run();
}

export async function saveSavedNotesContext(db: D1Database, input: SavedNotesContextInput): Promise<void> {
  assertIdentifiers(input.userId, input.chatId);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");
  const expiresAt = new Date(now.getTime() + CONTEXT_TTL_MS).toISOString();
  const folderId = input.folderId ?? null;
  if (folderId !== null && (!Number.isSafeInteger(folderId) || folderId < 0)) {
    throw new Error("Context folder id is invalid");
  }
  const nextBeforeId = input.nextBeforeId === undefined ? null : input.nextBeforeId;
  if (nextBeforeId !== null && (!Number.isSafeInteger(nextBeforeId) || nextBeforeId <= 0)) {
    throw new Error("Context cursor is invalid");
  }

  await db
    .prepare(
      `INSERT INTO conversation_context
        (user_id, chat_id, context_type, note_kind, folder_id, next_before_id, updated_at, expires_at)
       VALUES (?, ?, 'saved_notes', ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         chat_id = excluded.chat_id,
         context_type = excluded.context_type,
         note_kind = excluded.note_kind,
         folder_id = excluded.folder_id,
         next_before_id = excluded.next_before_id,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at`,
    )
    .bind(input.userId, input.chatId, input.kind, folderId, nextBeforeId, now.toISOString(), expiresAt)
    .run();
}

export async function getSavedNotesContext(
  db: D1Database,
  input: { userId: number; chatId: number; now?: Date },
): Promise<SavedNotesContext | null> {
  assertIdentifiers(input.userId, input.chatId);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");

  const row = await db
    .prepare(
      "SELECT note_kind, folder_id, next_before_id, expires_at FROM conversation_context WHERE user_id = ? AND chat_id = ? AND context_type = 'saved_notes'",
    )
    .bind(input.userId, input.chatId)
    .first<StoredContext>();

  if (!row) return null;
  if (!isValidContext(row)) {
    await clearSavedNotesContext(db, input.userId);
    return null;
  }

  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    await clearSavedNotesContext(db, input.userId);
    return null;
  }

  return {
    kind: row.note_kind,
    ...(row.folder_id === null ? {} : { folderId: row.folder_id }),
    ...(row.next_before_id === null ? {} : { nextBeforeId: row.next_before_id }),
  };
}

export async function clearSavedNotesContext(db: D1Database, userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Context user id is invalid");
  await db.prepare("DELETE FROM conversation_context WHERE user_id = ?").bind(userId).run();
}

function assertIdentifiers(userId: number, chatId: number): void {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Context user id is invalid");
  if (!Number.isInteger(chatId)) throw new Error("Context chat id is invalid");
}

function isValidContext(row: StoredContext): row is StoredContext & { note_kind: SavedNotesContext["kind"] } {
  const expiresAt = new Date(row.expires_at).getTime();
  return (
    (row.note_kind === "all" || row.note_kind === "photos" || row.note_kind === "documents" || row.note_kind === "links") &&
    (row.folder_id === null || row.folder_id === 0 || (Number.isSafeInteger(row.folder_id) && row.folder_id > 0)) &&
    (row.next_before_id === null || (Number.isSafeInteger(row.next_before_id) && row.next_before_id > 0)) &&
    Number.isFinite(expiresAt)
  );
}

function isValidPendingListContext(row: StoredPendingListContext): row is StoredPendingListContext & { resource_type: PendingListResource } {
  const expiresAt = new Date(row.expires_at).getTime();
  return (row.resource_type === "task" || row.resource_type === "reminder") && Number.isInteger(row.chat_id) && Number.isFinite(expiresAt);
}
