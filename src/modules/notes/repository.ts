import { normalizeHttpUrl } from "../../shared/urls";

export interface CreateNoteInput {
  userId: number;
  content: string;
  url?: string;
  createdAt?: string;
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

  const result = await db
    .prepare("INSERT INTO notes (user_id, content, url, created_at) VALUES (?, ?, ?, ?)")
    .bind(input.userId, content, url, input.createdAt ?? new Date().toISOString())
    .run();

  return result.meta.last_row_id;
}
