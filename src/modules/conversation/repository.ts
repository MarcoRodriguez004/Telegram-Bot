import { normalizeHttpUrl } from "../../shared/urls";
import { isTelegramFileId } from "../../telegram/types";
import type { TelegramAttachment } from "../../telegram/types";

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

export type ConversationDraftFlow = "task" | "reminder" | "expense";
export type ConversationDraftMissing = "title" | "time" | "amount" | "category";

export type ConversationDraft = {
  flow: ConversationDraftFlow;
  missing: ConversationDraftMissing;
  baseText: string;
};

export type PendingConfirmationContext = {
  question: string;
  suggestedText: string;
};

export type PendingFolderSave = {
  content: string;
  url?: string;
  attachment?: TelegramAttachment;
  requestedFolderName: string;
  existingFolderId: number;
  existingFolderName: string;
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

type StoredConversationDraft = {
  chat_id: number;
  flow: string;
  missing: string;
  base_text: string;
  expires_at: string;
};

type StoredPendingConfirmationContext = {
  question: string;
  suggested_text: string;
  expires_at: string;
};

type StoredPendingFolderSave = {
  chat_id: number;
  content: string;
  url: string | null;
  file_kind: string | null;
  file_id: string | null;
  requested_folder_name: string;
  existing_folder_id: number;
  existing_folder_name: string;
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

export async function savePendingFolderSave(
  db: D1Database,
  input: {
    userId: number;
    chatId: number;
    pending: PendingFolderSave;
    now?: Date;
  },
): Promise<void> {
  assertIdentifiers(input.userId, input.chatId);
  const content = input.pending.content.trim().replace(/\s+/g, " ");
  if (!content || content.length > 1_000) throw new Error("Pending folder content is invalid");
  const url = input.pending.url === undefined ? null : normalizeHttpUrl(input.pending.url);
  if (input.pending.url !== undefined && url === null) throw new Error("Pending folder URL is invalid");
  const requestedFolderName = normalizeFolderName(input.pending.requestedFolderName);
  const existingFolderName = normalizeFolderName(input.pending.existingFolderName);
  if (!requestedFolderName || requestedFolderName.length > 80) throw new Error("Pending requested folder name is invalid");
  if (!existingFolderName || existingFolderName.length > 80) throw new Error("Pending existing folder name is invalid");
  if (!Number.isSafeInteger(input.pending.existingFolderId) || input.pending.existingFolderId < 1) {
    throw new Error("Pending existing folder id is invalid");
  }
  if (input.pending.attachment && !isValidAttachment(input.pending.attachment)) {
    throw new Error("Pending folder attachment is invalid");
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");
  const expiresAt = new Date(now.getTime() + CONTEXT_TTL_MS).toISOString();
  const fileKind = input.pending.attachment?.kind ?? null;
  const fileId = input.pending.attachment?.fileId ?? null;

  await db.prepare(
    "INSERT INTO pending_folder_saves (user_id, chat_id, content, url, file_kind, file_id, requested_folder_name, existing_folder_id, existing_folder_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, content = excluded.content, url = excluded.url, file_kind = excluded.file_kind, file_id = excluded.file_id, requested_folder_name = excluded.requested_folder_name, existing_folder_id = excluded.existing_folder_id, existing_folder_name = excluded.existing_folder_name, created_at = excluded.created_at, expires_at = excluded.expires_at",
  ).bind(
    input.userId,
    input.chatId,
    content,
    url,
    fileKind,
    fileId,
    requestedFolderName,
    input.pending.existingFolderId,
    existingFolderName,
    now.toISOString(),
    expiresAt,
  ).run();
}

export async function getPendingFolderSave(
  db: D1Database,
  input: { userId: number; chatId: number; now?: Date },
): Promise<PendingFolderSave | null> {
  assertIdentifiers(input.userId, input.chatId);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");
  const row = await db.prepare(
    "SELECT chat_id, content, url, file_kind, file_id, requested_folder_name, existing_folder_id, existing_folder_name, expires_at FROM pending_folder_saves WHERE user_id = ? AND chat_id = ?",
  ).bind(input.userId, input.chatId).first<StoredPendingFolderSave>();

  if (!row) return null;
  if (!isValidPendingFolderSave(row) || new Date(row.expires_at).getTime() <= now.getTime()) {
    await clearPendingFolderSave(db, input.userId);
    return null;
  }

  return {
    content: row.content,
    ...(row.url === null ? {} : { url: row.url }),
    ...(row.file_kind === null || row.file_id === null ? {} : { attachment: { kind: row.file_kind, fileId: row.file_id } }),
    requestedFolderName: row.requested_folder_name,
    existingFolderId: row.existing_folder_id,
    existingFolderName: row.existing_folder_name,
  };
}

export async function clearPendingFolderSave(db: D1Database, userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Context user id is invalid");
  await db.prepare("DELETE FROM pending_folder_saves WHERE user_id = ?").bind(userId).run();
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

export async function saveConversationDraft(
  db: D1Database,
  input: {
    userId: number;
    chatId: number;
    flow: ConversationDraftFlow;
    missing: ConversationDraftMissing;
    baseText: string;
    now?: Date;
  },
): Promise<void> {
  assertIdentifiers(input.userId, input.chatId);
  if (!isConversationDraftFlow(input.flow) || !isConversationDraftMissing(input.missing)) {
    throw new Error("Conversation draft type is invalid");
  }
  const baseText = input.baseText.trim().replace(/\s+/g, " ");
  if (!baseText || baseText.length > 4_000) throw new Error("Conversation draft text is invalid");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");
  const expiresAt = new Date(now.getTime() + CONTEXT_TTL_MS).toISOString();

  await db.prepare(
    "INSERT INTO conversation_drafts (user_id, chat_id, flow, missing, base_text, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id, chat_id) DO UPDATE SET flow = excluded.flow, missing = excluded.missing, base_text = excluded.base_text, updated_at = excluded.updated_at, expires_at = excluded.expires_at",
  ).bind(
    input.userId,
    input.chatId,
    input.flow,
    input.missing,
    baseText,
    now.toISOString(),
    expiresAt,
  ).run();
}

export async function getConversationDraft(
  db: D1Database,
  input: { userId: number; chatId: number; now?: Date },
): Promise<ConversationDraft | null> {
  assertIdentifiers(input.userId, input.chatId);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Context timestamp is invalid");
  const row = await db.prepare(
    "SELECT chat_id, flow, missing, base_text, expires_at FROM conversation_drafts WHERE user_id = ? AND chat_id = ?",
  ).bind(input.userId, input.chatId).first<StoredConversationDraft>();

  if (!row) return null;
  if (!isValidConversationDraft(row) || new Date(row.expires_at).getTime() <= now.getTime()) {
    await clearConversationDraft(db, input.userId);
    return null;
  }

  return {
    flow: row.flow,
    missing: row.missing,
    baseText: row.base_text,
  };
}

export async function clearConversationDraft(db: D1Database, userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Context user id is invalid");
  await db.prepare("DELETE FROM conversation_drafts WHERE user_id = ?").bind(userId).run();
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

function normalizeFolderName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function isValidAttachment(attachment: TelegramAttachment): boolean {
  return (attachment.kind === "photo" || attachment.kind === "document") && isTelegramFileId(attachment.fileId);
}

function isValidPendingFolderSave(row: StoredPendingFolderSave): row is StoredPendingFolderSave & {
  file_kind: "photo" | "document";
  file_id: string;
} {
  const expiresAt = new Date(row.expires_at).getTime();
  const hasNoAttachment = row.file_kind === null && row.file_id === null;
  const hasAttachment = (row.file_kind === "photo" || row.file_kind === "document") && isTelegramFileId(row.file_id);
  return Number.isInteger(row.chat_id) &&
    Boolean(row.content) && row.content.length <= 1_000 &&
    (row.url === null || normalizeHttpUrl(row.url) !== null) &&
    (hasNoAttachment || hasAttachment) &&
    Boolean(row.requested_folder_name) && row.requested_folder_name.length <= 80 &&
    Number.isSafeInteger(row.existing_folder_id) && row.existing_folder_id > 0 &&
    Boolean(row.existing_folder_name) && row.existing_folder_name.length <= 80 &&
    Number.isFinite(expiresAt);
}

function isValidPendingListContext(row: StoredPendingListContext): row is StoredPendingListContext & { resource_type: PendingListResource } {
  const expiresAt = new Date(row.expires_at).getTime();
  return (row.resource_type === "task" || row.resource_type === "reminder") && Number.isInteger(row.chat_id) && Number.isFinite(expiresAt);
}

function isConversationDraftFlow(value: string): value is ConversationDraftFlow {
  return value === "task" || value === "reminder" || value === "expense";
}

function isConversationDraftMissing(value: string): value is ConversationDraftMissing {
  return value === "title" || value === "time" || value === "amount" || value === "category";
}

function isValidConversationDraft(row: StoredConversationDraft): row is StoredConversationDraft & {
  flow: ConversationDraftFlow;
  missing: ConversationDraftMissing;
} {
  return (
    Number.isInteger(row.chat_id) &&
    isConversationDraftFlow(row.flow) &&
    isConversationDraftMissing(row.missing) &&
    Boolean(row.base_text) &&
    row.base_text.length <= 4_000 &&
    Number.isFinite(new Date(row.expires_at).getTime())
  );
}
