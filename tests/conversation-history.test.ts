import { afterEach, describe, expect, it } from "vitest";
import {
  clearConversationHistory,
  getConversationHistory,
  saveConversationTurn,
} from "../src/modules/conversation/history";
import { createSqliteDb } from "./helpers/sqlite-db";

const databases: ReturnType<typeof createSqliteDb>[] = [];
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); });

function setup() {
  const database = createSqliteDb();
  databases.push(database);
  database.sqlite.prepare(
    "INSERT INTO users (telegram_user_id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  ).run(42, 42, "2026-09-13T12:00:00.000Z");
  database.sqlite.prepare(
    "INSERT INTO users (telegram_user_id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  ).run(99, 99, "2026-09-13T12:00:00.000Z");
  return database;
}

describe("conversation history", () => {
  it("keeps the latest twelve turns in chronological order", async () => {
    const { db } = setup();
    const base = new Date("2026-09-13T12:00:00.000Z");

    for (let index = 1; index <= 13; index += 1) {
      await saveConversationTurn(db, {
        userId: 1,
        chatId: 42,
        role: index % 2 === 0 ? "assistant" : "user",
        content: `turno ${index}`,
        now: new Date(base.getTime() + index * 1_000),
      });
    }

    await expect(getConversationHistory(db, {
      userId: 1,
      chatId: 42,
      now: new Date(base.getTime() + 14_000),
    })).resolves.toEqual(
      Array.from({ length: 12 }, (_, index) => ({
        role: (index + 2) % 2 === 0 ? "assistant" : "user",
        content: `turno ${index + 2}`,
        createdAt: new Date(base.getTime() + (index + 2) * 1_000).toISOString(),
      })),
    );
  });

  it("expires old turns and isolates history by user and chat", async () => {
    const { db } = setup();
    const now = new Date("2026-09-13T15:00:00.000Z");
    await saveConversationTurn(db, { userId: 1, chatId: 42, role: "user", content: "viejo", now: new Date("2026-09-13T12:59:00.000Z") });
    await saveConversationTurn(db, { userId: 1, chatId: 99, role: "user", content: "otro chat", now });

    await expect(getConversationHistory(db, { userId: 1, chatId: 42, now })).resolves.toEqual([]);
    await expect(getConversationHistory(db, { userId: 1, chatId: 99, now })).resolves.toEqual([
      { role: "user", content: "otro chat", createdAt: now.toISOString() },
    ]);
  });

  it("deletes only the requested user's history", async () => {
    const { db } = setup();
    await saveConversationTurn(db, { userId: 1, chatId: 42, role: "user", content: "propio" });
    await saveConversationTurn(db, { userId: 2, chatId: 42, role: "user", content: "otro usuario" });

    await clearConversationHistory(db, 1);

    await expect(getConversationHistory(db, { userId: 1, chatId: 42 })).resolves.toEqual([]);
    await expect(getConversationHistory(db, { userId: 2, chatId: 42 })).resolves.toHaveLength(1);
  });
});
