import { describe, expect, it } from "vitest";
import { createNote } from "../src/modules/notes/repository";

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
});
