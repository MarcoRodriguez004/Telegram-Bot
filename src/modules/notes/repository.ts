import { normalizeHttpUrl } from "../../shared/urls";
import { isTelegramFileId } from "../../telegram/types";
import type { TelegramAttachment } from "../../telegram/types";

export interface SavedNote {
  id: number;
  content: string;
  url: string | null;
  file_kind: "photo" | "document" | null;
  file_id: string | null;
}

const SAVED_PAGE_SIZE = 10;
export type SavedNoteKind = "all" | "photos" | "documents";

export async function listNotes(db: D1Database, userId: number, beforeId?: number, kind: SavedNoteKind = "all") {
  if (kind !== "all" && kind !== "photos" && kind !== "documents") throw new Error("Saved note kind is invalid");
  const kindCondition = kind === "photos" ? " AND file_kind = 'photo'" : kind === "documents" ? " AND file_kind = 'document'" : "";
  const result = await db.prepare(
    `SELECT id, content, url, file_kind, file_id FROM notes WHERE user_id = ? AND id < ?${kindCondition} ORDER BY id DESC LIMIT ?`,
  ).bind(userId, beforeId ?? Number.MAX_SAFE_INTEGER, SAVED_PAGE_SIZE + 1).all<SavedNote>();
  const notes = result.results.slice(0, SAVED_PAGE_SIZE);
  return { notes, nextBeforeId: result.results.length > SAVED_PAGE_SIZE ? notes.at(-1)?.id : undefined };
}

export async function getNote(db: D1Database, userId: number, noteId: number): Promise<SavedNote | null> {
  return db.prepare(
    "SELECT id, content, url, file_kind, file_id FROM notes WHERE user_id = ? AND id = ?",
  ).bind(userId, noteId).first<SavedNote>();
}

export interface CreateNoteInput {
  userId: number;
  content: string;
  url?: string;
  createdAt?: string;
  attachment?: TelegramAttachment;
}

export async function createNote(db: D1Database, input: CreateNoteInput): Promise<number> {
  if (!Number.isInteger(input.userId) || input.userId < 1) {
    throw new Error("User id is invalid");
  }

  const content = input.content.trim().replace(/\s+/g, " ");
  if (!content) {
    throw new Error("Note content is required");
  }
  if (content.length > 1_000) {
    throw new Error("Note content is too long");
  }

  const url = input.url === undefined ? null : normalizeHttpUrl(input.url);
  if (input.url !== undefined && url === null) {
    throw new Error("Note URL is invalid");
  }

  if (input.attachment) {
    const { kind, fileId } = input.attachment;
    if ((kind !== "photo" && kind !== "document") || !isTelegramFileId(fileId)) {
      throw new Error("Note attachment is invalid");
    }
    const result = await db.prepare(
      "INSERT INTO notes (user_id, content, url, created_at, file_kind, file_id) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(input.userId, content, url, input.createdAt ?? new Date().toISOString(), kind, fileId).run();
    return result.meta.last_row_id;
  }

  const result = await db
    .prepare("INSERT INTO notes (user_id, content, url, created_at) VALUES (?, ?, ?, ?)")
    .bind(input.userId, content, url, input.createdAt ?? new Date().toISOString())
    .run();

  return result.meta.last_row_id;
}
