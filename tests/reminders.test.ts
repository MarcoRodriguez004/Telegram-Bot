import { describe, expect, it } from "vitest";
import { createReminder } from "../src/modules/reminders/repository";

function createDb() {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          calls.push({ query, values });
          return {
            async run() {
              return { success: true, meta: { changes: 1, last_row_id: 11 } };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

describe("reminder repository", () => {
  it("creates a pending reminder in UTC and returns its id", async () => {
    const { db, calls } = createDb();

    const reminderId = await createReminder(db, {
      userId: 3,
      title: "pagar internet",
      remindAt: "2026-09-08T15:00:00.000Z",
      createdAt: "2026-09-07T20:00:00.000Z",
    });

    expect(reminderId).toBe(11);
    expect(calls[0]).toEqual({
      query: "INSERT INTO reminders (user_id, title, remind_at, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
      values: [3, "pagar internet", "2026-09-08T15:00:00.000Z", "2026-09-07T20:00:00.000Z"],
    });
  });

  it("rejects invalid reminder data before touching the database", async () => {
    const { db, calls } = createDb();

    await expect(createReminder(db, { userId: 3, title: " ", remindAt: "2026-09-08T15:00:00.000Z" })).rejects.toThrow(
      "Reminder title is required",
    );
    await expect(createReminder(db, { userId: 3, title: "pagar", remindAt: "not-a-date" })).rejects.toThrow(
      "Reminder time is invalid",
    );
    expect(calls).toHaveLength(0);
  });
});
