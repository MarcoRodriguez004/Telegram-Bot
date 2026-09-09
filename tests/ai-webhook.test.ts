import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { handleRequest } from "../src/index";

type StoredTask = { userId: number; title: string };

function createTaskDb() {
  const processedUpdates = new Set<number>();
  const users = new Map<number, number>();
  const tasks: StoredTask[] = [];
  let nextUserId = 1;

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
                tasks.push({ userId: Number(values[0]), title: String(values[1]) });
              }
              return { success: true, meta: { changes: 1, last_row_id: 1 } };
            },
            async first<T>() {
              if (query.startsWith("SELECT id FROM users")) {
                return (users.get(Number(values[0])) === undefined ? null : { id: users.get(Number(values[0])) }) as T | null;
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
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-5.6-luna",
  };
  const telegramFetch: typeof fetch = async (_input, init) => {
    sentMessages.push(JSON.parse(String(init?.body)) as { chat_id: number; text: string });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  return { env, sentMessages, telegramFetch };
}

function update(text: string) {
  return JSON.stringify({
    update_id: 900,
    message: {
      message_id: 1,
      date: 1_757_000_000,
      chat: { id: 42, type: "private" },
      from: { id: 42, is_bot: false, first_name: "Marco" },
      text,
    },
  });
}

describe("AI webhook fallback", () => {
  it("keeps using deterministic parsing without calling OpenAI", async () => {
    const { db, tasks } = createTaskDb();
    const { env, sentMessages, telegramFetch } = createEnv(db);
    let aiCalls = 0;
    const aiFetch: typeof fetch = async () => {
      aiCalls += 1;
      return new Response("unexpected", { status: 500 });
    };
    const request = new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: update("tarea comprar medicina"),
    });

    await handleRequest(request, env, telegramFetch, aiFetch);

    expect(aiCalls).toBe(0);
    expect(tasks).toEqual([{ userId: 1, title: "comprar medicina" }]);
    expect(sentMessages[0].text).toContain("Tarea creada");
  });

  it("interprets an unrecognized message and executes only the returned task intent", async () => {
    const { db, tasks } = createTaskDb();
    const { env, sentMessages, telegramFetch } = createEnv(db);
    let aiCalls = 0;
    const aiFetch: typeof fetch = async (_input, init) => {
      aiCalls += 1;
      const body = JSON.parse(String(init?.body)) as { text: { format: { type: string } } };
      expect(body.text.format.type).toBe("json_schema");
      return new Response(JSON.stringify({
        status: "completed",
        output_text: JSON.stringify({
          action: "create_task",
          title: "comprar medicina",
          when: null,
          amount: null,
          currency: null,
          category: null,
          description: null,
          content: null,
          url: null,
          beforeId: null,
          noteId: null,
          range: null,
          message: null,
          missing: [],
        }),
      }), { status: 200 });
    };
    const request = new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: update("por favor anota comprar medicina"),
    });

    const response = await handleRequest(request, env, telegramFetch, aiFetch);

    expect(response.status).toBe(200);
    expect(aiCalls).toBe(1);
    expect(tasks).toEqual([{ userId: 1, title: "comprar medicina" }]);
    expect(sentMessages[0].text).toBe("✅ Tarea creada\n\ncomprar medicina");
  });

  it("keeps the deterministic deletion confirmation outside the model", async () => {
    const { db } = createTaskDb();
    const { env, sentMessages, telegramFetch } = createEnv(db);
    let aiCalls = 0;
    const aiFetch: typeof fetch = async () => {
      aiCalls += 1;
      return new Response("unexpected", { status: 500 });
    };
    const request = new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: update("elimina todos mis datos"),
    });

    await handleRequest(request, env, telegramFetch, aiFetch);

    expect(aiCalls).toBe(0);
    expect(sentMessages[0].text).toContain("/borrar_datos CONFIRMAR");
  });
});
