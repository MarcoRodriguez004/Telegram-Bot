import { describe, expect, it } from "vitest";
import { deleteUserData } from "../src/modules/privacy/repository";

function createDatabase(existingUserId: number | null) {
  const batchedStatements: Array<{ query: string; values: unknown[] }> = [];

  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          const statement = {
            query,
            values,
            async first<T>() {
              if (query.startsWith("SELECT id FROM users")) {
                return existingUserId === null ? null : ({ id: existingUserId } as T);
              }
              return null;
            },
          };
          return statement;
        },
      };
    },
    async batch(statements: unknown[]) {
      batchedStatements.push(...(statements as Array<{ query: string; values: unknown[] }>));
      return [];
    },
  };

  return { db: db as unknown as D1Database, batchedStatements };
}

describe("deleteUserData", () => {
  it("deletes personal records before the user in one batch", async () => {
    const { db, batchedStatements } = createDatabase(7);

    await deleteUserData(db, 42);

    expect(batchedStatements.map(({ query, values }) => ({ query, values }))).toEqual([
      { query: "DELETE FROM tasks WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM reminders WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM expenses WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM notes WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM saved_folders WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM persistent_notifications WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM notification_preferences WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM edit_sessions WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM conversation_context WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM pending_conversation WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM conversation_confirmations WHERE user_id = ?", values: [7] },
      { query: "DELETE FROM users WHERE id = ?", values: [7] },
    ]);
    expect(batchedStatements.some((statement) => statement.query.includes("processed_updates"))).toBe(false);
  });

  it("does nothing when the Telegram user does not exist", async () => {
    const { db, batchedStatements } = createDatabase(null);

    await deleteUserData(db, 42);

    expect(batchedStatements).toEqual([]);
  });
});
