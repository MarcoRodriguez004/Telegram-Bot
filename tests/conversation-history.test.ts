import { afterEach, describe, expect, it } from "vitest";
import {
  clearConversationHistory,
  getConversationHistory,
  saveConversationTurn,
} from "../src/modules/conversation/history";
import { clearConversationState } from "../src/modules/conversation/repository";
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

  it("clears conversational state without deleting persistent data", async () => {
    const { db, sqlite } = setup();
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "tarea persistente", "2026-09-13T12:00:00.000Z");
    sqlite.prepare("INSERT INTO conversation_context (user_id, chat_id, context_type, note_kind, updated_at, expires_at) VALUES (?, ?, 'saved_notes', 'photos', ?, ?)")
      .run(1, 42, "2026-09-13T12:00:00.000Z", "2026-09-13T13:00:00.000Z");
    sqlite.prepare("INSERT INTO pending_conversation (user_id, chat_id, resource_type, updated_at, expires_at) VALUES (?, ?, 'task', ?, ?)")
      .run(1, 42, "2026-09-13T12:00:00.000Z", "2026-09-13T13:00:00.000Z");
    sqlite.prepare("INSERT INTO conversation_confirmations (user_id, chat_id, question, suggested_text, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(1, 42, "¿Confirmas?", "tarea persistente", "2026-09-13T12:00:00.000Z", "2026-09-13T13:00:00.000Z");
    sqlite.prepare("INSERT INTO conversation_drafts (user_id, chat_id, flow, missing, base_text, updated_at, expires_at) VALUES (?, ?, 'task', 'title', ?, ?, ?)")
      .run(1, 42, "tarea", "2026-09-13T12:00:00.000Z", "2026-09-13T13:00:00.000Z");
    sqlite.prepare("INSERT INTO edit_sessions (user_id, chat_id, resource_type, resource_id, expires_at, created_at) VALUES (?, ?, 'task', 1, ?, ?)")
      .run(1, 42, "2026-09-13T13:00:00.000Z", "2026-09-13T12:00:00.000Z");
    await saveConversationTurn(db, { userId: 1, chatId: 42, role: "user", content: "contexto temporal" });
    await clearConversationState(db, { userId: 1, chatId: 42 });

    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id = 1").get() as { count: number } | undefined)?.count).toBe(1);
    for (const table of ["conversation_history", "conversation_context", "pending_conversation", "conversation_confirmations", "conversation_drafts", "edit_sessions"]) {
      expect((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = 1`).get() as { count: number } | undefined)?.count).toBe(0);
    }
  });
});
