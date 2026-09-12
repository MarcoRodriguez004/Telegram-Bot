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
const MAX_FOLDER_NAME_LENGTH = 80;
export type SavedNoteKind = "all" | "photos" | "documents" | "links";

export interface SavedFolder {
  id: number;
  name: string;
}

export interface SimilarFolderMatch {
  folder: SavedFolder;
  similarity: number;
}

export interface SavedFolderListItem {
  id: number | null;
  name: string;
  count: number;
}

export function normalizeFolderName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizedFolderKey(value: string): string {
  return normalizeFolderName(value).toLocaleLowerCase("es-MX");
}

function assertFolderName(value: string): { name: string; normalizedName: string } {
  const name = normalizeFolderName(value);
  if (!name) throw new Error("Folder name is required");
  if (name.length > MAX_FOLDER_NAME_LENGTH) throw new Error("Folder name is too long");
  return { name, normalizedName: normalizedFolderKey(name) };
}

function assertUserId(userId: number): void {
  if (!Number.isInteger(userId) || userId < 1) throw new Error("User id is invalid");
}

function assertFolderId(folderId: number): void {
  if (!Number.isSafeInteger(folderId) || folderId < 1) throw new Error("Folder id is invalid");
}

export async function createFolder(
  db: D1Database,
  input: { userId: number; name: string; createdAt?: string },
): Promise<SavedFolder & { created: boolean }> {
  assertUserId(input.userId);
  const { name, normalizedName } = assertFolderName(input.name);
  const existing = await db.prepare(
    "SELECT id, name FROM saved_folders WHERE user_id = ? AND normalized_name = ?",
  ).bind(input.userId, normalizedName).first<SavedFolder>();
  if (existing) return { ...existing, created: false };

  await db.prepare(
    "INSERT OR IGNORE INTO saved_folders (user_id, name, normalized_name, created_at) VALUES (?, ?, ?, ?)",
  ).bind(input.userId, name, normalizedName, input.createdAt ?? new Date().toISOString()).run();

  const folder = await db.prepare(
    "SELECT id, name FROM saved_folders WHERE user_id = ? AND normalized_name = ?",
  ).bind(input.userId, normalizedName).first<SavedFolder>();
  if (!folder) throw new Error("Folder could not be created");
  return { ...folder, created: true };
}

export async function getFolderByName(db: D1Database, userId: number, name: string): Promise<SavedFolder | null> {
  assertUserId(userId);
  const { normalizedName } = assertFolderName(name);
  return db.prepare(
    "SELECT id, name FROM saved_folders WHERE user_id = ? AND normalized_name = ?",
  ).bind(userId, normalizedName).first<SavedFolder>();
}

export async function getFolderById(db: D1Database, userId: number, folderId: number): Promise<SavedFolder | null> {
  assertUserId(userId);
  assertFolderId(folderId);
  return db.prepare("SELECT id, name FROM saved_folders WHERE user_id = ? AND id = ?")
    .bind(userId, folderId).first<SavedFolder>();
}

export async function findSimilarFolder(
  db: D1Database,
  userId: number,
  name: string,
  threshold = 0.7,
): Promise<SimilarFolderMatch | null> {
  assertUserId(userId);
  const { normalizedName } = assertFolderName(name);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Folder similarity threshold is invalid");
  }

  const folders = await db.prepare(
    "SELECT id, name, normalized_name FROM saved_folders WHERE user_id = ? ORDER BY id",
  ).bind(userId).all<{ id: number; name: string; normalized_name: string }>();

  let best: SimilarFolderMatch | null = null;
  for (const folder of folders.results) {
    const similarity = stringSimilarity(normalizedName, folder.normalized_name);
    if (similarity < threshold || (best && similarity <= best.similarity)) continue;
    best = {
      folder: { id: folder.id, name: folder.name },
      similarity,
    };
  }
  return best;
}

export async function listFolders(
  db: D1Database,
  userId: number,
  kind: SavedNoteKind = "all",
): Promise<SavedFolderListItem[]> {
  assertUserId(userId);
  assertSavedNoteKind(kind);
  const condition = savedNoteKindCondition(kind, "n");
  const folders = await db.prepare(
    `SELECT f.id, f.name, COUNT(n.id) AS count
       FROM saved_folders f
       INNER JOIN notes n ON n.folder_id = f.id AND n.user_id = f.user_id
      WHERE f.user_id = ?${condition}
      GROUP BY f.id, f.name
      ORDER BY LOWER(f.name), f.id`,
  ).bind(userId).all<{ id: number; name: string; count: number }>();
  const unfiled = await db.prepare(
    `SELECT COUNT(*) AS count FROM notes n WHERE n.user_id = ? AND n.folder_id IS NULL${savedNoteKindCondition(kind, "n")}`,
  ).bind(userId).first<{ count: number }>();

  const result: SavedFolderListItem[] = folders.results.map((folder) => ({
    id: folder.id,
    name: folder.name,
    count: Number(folder.count),
  }));
  const unfiledCount = Number(unfiled?.count ?? 0);
  if (unfiledCount > 0) result.push({ id: null, name: "Sin carpeta", count: unfiledCount });
  return result;
}

export async function listNotes(
  db: D1Database,
  userId: number,
  beforeId?: number,
  kind: SavedNoteKind = "all",
  folderId?: number | null,
) {
  assertUserId(userId);
  assertSavedNoteKind(kind);
  if (folderId !== undefined && folderId !== null) {
    const folder = await getFolderById(db, userId, folderId);
    if (!folder) throw new Error("Folder not found");
  }
  if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId < 1)) throw new Error("Saved note cursor is invalid");
  const conditions = ["user_id = ?"];
  const values: Array<number | string> = [userId];
  if (folderId === null) conditions.push("folder_id IS NULL");
  if (folderId !== undefined && folderId !== null) {
    conditions.push("folder_id = ?");
    values.push(folderId);
  }
  const kindCondition = savedNoteKindCondition(kind);
  const query = `SELECT id, content, url, file_kind, file_id FROM notes WHERE ${conditions.join(" AND ")}${kindCondition} AND id < ? ORDER BY id DESC LIMIT ?`;
  values.push(beforeId ?? Number.MAX_SAFE_INTEGER, SAVED_PAGE_SIZE + 1);
  const result = await db.prepare(
    query,
  ).bind(...values).all<SavedNote>();
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
  folderId?: number | null;
}

export async function createNote(db: D1Database, input: CreateNoteInput): Promise<number> {
  assertUserId(input.userId);

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

  if (input.folderId !== undefined && input.folderId !== null) {
    const folder = await getFolderById(db, input.userId, input.folderId);
    if (!folder) throw new Error("Folder not found");
  }

  if (input.attachment) {
    const { kind, fileId } = input.attachment;
    if ((kind !== "photo" && kind !== "document") || !isTelegramFileId(fileId)) {
      throw new Error("Note attachment is invalid");
    }
    const result = input.folderId === undefined || input.folderId === null
      ? await db.prepare(
        "INSERT INTO notes (user_id, content, url, created_at, file_kind, file_id) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(input.userId, content, url, input.createdAt ?? new Date().toISOString(), kind, fileId).run()
      : await db.prepare(
        "INSERT INTO notes (user_id, content, url, created_at, file_kind, file_id, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(input.userId, content, url, input.createdAt ?? new Date().toISOString(), kind, fileId, input.folderId).run();
    return result.meta.last_row_id;
  }

  const result = input.folderId === undefined || input.folderId === null
    ? await db.prepare("INSERT INTO notes (user_id, content, url, created_at) VALUES (?, ?, ?, ?)")
      .bind(input.userId, content, url, input.createdAt ?? new Date().toISOString()).run()
    : await db.prepare("INSERT INTO notes (user_id, content, url, created_at, folder_id) VALUES (?, ?, ?, ?, ?)")
      .bind(input.userId, content, url, input.createdAt ?? new Date().toISOString(), input.folderId).run();

  return result.meta.last_row_id;
}

function assertSavedNoteKind(kind: string): asserts kind is SavedNoteKind {
  if (kind !== "all" && kind !== "photos" && kind !== "documents" && kind !== "links") {
    throw new Error("Saved note kind is invalid");
  }
}

function savedNoteKindCondition(kind: SavedNoteKind, alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return kind === "photos"
    ? ` AND ${prefix}file_kind = 'photo'`
    : kind === "documents"
      ? ` AND ${prefix}file_kind = 'document'`
      : kind === "links"
        ? ` AND ${prefix}file_kind IS NULL`
        : "";
}

function stringSimilarity(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(left, right) / maxLength;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previousDiagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const current = previous[rightIndex];
      previous[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previousDiagonal
        : Math.min(previous[rightIndex - 1] + 1, previous[rightIndex] + 1, previousDiagonal + 1);
      previousDiagonal = current;
    }
  }
  return previous[right.length];
}
