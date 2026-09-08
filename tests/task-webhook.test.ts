import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { handleRequest } from "../src/index";

type StoredTask = { userId: number; title: string; status: string };

function createTaskDb() {
  const processedUpdates = new Set<number>();
  const users = new Map<number, number>();
  const tasks: StoredTask[] = [];
  let nextUserId = 1;
  let nextTaskId = 1;

  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (query.startsWith("INSERT OR IGNORE INTO processed_updates")) {
                const updateId = Number(values[0]);
                const inserted = !processedUpdates.has(updateId);
                if (inserted) processedUpdates.add(updateId);
                return { success: true, meta: { changes: inserted ? 1 : 0, last_row_id: 0 } };
              }

              if (query.startsWith("INSERT OR IGNORE INTO users")) {
                const telegramUserId = Number(values[0]);
                if (!users.has(telegramUserId)) users.set(telegramUserId, nextUserId++);
                return { success: true, meta: { changes: 1, last_row_id: 0 } };
              }

              if (query.startsWith("INSERT INTO tasks")) {
                tasks.push({ userId: Number(values[0]), title: String(values[1]), status: "pending" });
                return { success: true, meta: { changes: 1, last_row_id: nextTaskId++ } };
              }

              return { success: true, meta: { changes: 1, last_row_id: 0 } };
            },
            async first<T>() {
              if (query.startsWith("SELECT id FROM users")) {
                const userId = users.get(Number(values[0]));
                return (userId === undefined ? null : { id: userId }) as T | null;
              }
              return null;
            },
          };
        },
      };
    },
  };

  return { db: db as unknown as D1Database, tasks };
}

function createEnv(db: D1Database) {
  const sentMessages: Array<{ chat_id: number; text: string }> = [];
  const env: Env = {
    PERSONAL_ASSISTANT_DB: db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    TELEGRAM_ALLOWED_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
  const telegramFetch: typeof fetch = async (_input, init) => {
    sentMessages.push(JSON.parse(String(init?.body)) as { chat_id: number; text: string });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  return { env, sentMessages, telegramFetch };
}

function taskUpdate(text: string) {
  return JSON.stringify({
    update_id: 10,
    message: {
      message_id: 1,
      date: 1_757_000_000,
      chat: { id: 42, type: "private" },
      from: { id: 42, is_bot: false, first_name: "Marco" },
      text,
    },
  });
}

describe("task webhook flow", () => {
  it("persists an authorized task and confirms it in Telegram", async () => {
    const { db, tasks } = createTaskDb();
    const { env, sentMessages, telegramFetch } = createEnv(db);
    const request = () =>
      new Request("https://bot.test/telegram/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
        body: taskUpdate("tarea comprar medicina"),
      });

    const response = await handleRequest(request(), env, telegramFetch);
    const retryResponse = await handleRequest(request(), env, telegramFetch);

    expect(response.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    expect(tasks).toEqual([{ userId: 1, title: "comprar medicina", status: "pending" }]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      chat_id: 42,
      text: "✅ Tarea creada\n\ncomprar medicina",
    });
  });
});
