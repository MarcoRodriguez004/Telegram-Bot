import { describe, expect, it } from "vitest";
import { ensureUser } from "../src/db/users";
import { createNote, deleteNote, getNote, updateNote } from "../src/modules/notes/repository";
import { createSqliteDb } from "./helpers/sqlite-db";

function createDb() {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          calls.push({ query, values });
          return {
            async run() {
              return { success: true, meta: { changes: 1, last_row_id: 31 } };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

describe("note repository", () => {
  it("stores note content and an optional HTTP URL", async () => {
    const { db, calls } = createDb();

    const noteId = await createNote(db, {
      userId: 3,
      content: "para leer luego",
      url: "https://example.com",
      createdAt: "2026-09-07T20:00:00.000Z",
    });

    expect(noteId).toBe(31);
    expect(calls[0]).toEqual({
      query: "INSERT INTO notes (user_id, content, url, created_at) VALUES (?, ?, ?, ?)",
      values: [3, "para leer luego", "https://example.com", "2026-09-07T20:00:00.000Z"],
    });
  });

  it("rejects empty content and unsafe URLs", async () => {
    const { db, calls } = createDb();

    await expect(createNote(db, { userId: 3, content: " " })).rejects.toThrow("Note content is required");
    await expect(createNote(db, { userId: 3, content: "nota", url: "javascript:alert(1)" })).rejects.toThrow(
      "Note URL is invalid",
    );
    expect(calls).toHaveLength(0);
  });

  it("updates and deletes notes only for their owner", async () => {
    const { db } = createSqliteDb();
    const firstUser = await ensureUser(db, {
      telegramUserId: 101,
      telegramChatId: 1001,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });
    const secondUser = await ensureUser(db, {
      telegramUserId: 202,
      telegramChatId: 2002,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });
    const firstNoteId = await createNote(db, { userId: firstUser, content: "original" });
    const secondNoteId = await createNote(db, { userId: secondUser, content: "privada" });

    expect(await updateNote(db, { userId: secondUser, noteId: firstNoteId, content: "intrusa" })).toBe(false);
    expect(await updateNote(db, { userId: firstUser, noteId: firstNoteId, content: "actualizada" })).toBe(true);
    expect((await getNote(db, firstUser, firstNoteId))?.content).toBe("actualizada");
    expect(await deleteNote(db, { userId: firstUser, noteId: secondNoteId })).toBe(false);
    expect(await deleteNote(db, { userId: firstUser, noteId: firstNoteId })).toBe(true);
    expect(await getNote(db, firstUser, firstNoteId)).toBeNull();
  });
});
