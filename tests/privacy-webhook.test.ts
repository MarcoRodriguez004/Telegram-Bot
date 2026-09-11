import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { handleRequest } from "../src/index";

function createPrivacyDb(existingUserId: number | null) {
  const processedUpdates = new Set<number>();
  const batchedStatements: Array<{ query: string; values: unknown[] }> = [];

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
              return { success: true, meta: { changes: 1, last_row_id: 0 } };
            },
            async first<T>() {
              if (query.startsWith("SELECT id FROM users")) {
                return existingUserId === null ? null : ({ id: existingUserId } as T);
              }
              return null;
            },
          };
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

function createRequest(text: string, updateId: number, secret: string): Request {
  return new Request("https://bot.test/telegram/webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify({
      update_id: updateId,
      message: {
        message_id: updateId,
        date: 1_757_000_000,
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false, first_name: "Marco" },
        text,
      },
    }),
  });
}

describe("privacy webhook flow", () => {
  it("deletes the authorized user's data after exact confirmation", async () => {
    const { db, batchedStatements } = createPrivacyDb(7);
    const { env, sentMessages, telegramFetch } = createEnv(db);

    const response = await handleRequest(createRequest("/borrar_datos CONFIRMAR", 60, env.TELEGRAM_WEBHOOK_SECRET), env, telegramFetch);

    expect(response.status).toBe(200);
    expect(sentMessages[0].text).toContain("eliminados");
    expect(batchedStatements).toHaveLength(9);
  });

  it("does not delete anything without exact confirmation", async () => {
    const { db, batchedStatements } = createPrivacyDb(7);
    const { env, sentMessages, telegramFetch } = createEnv(db);

    const response = await handleRequest(createRequest("/borrar_datos", 61, env.TELEGRAM_WEBHOOK_SECRET), env, telegramFetch);

    expect(response.status).toBe(200);
    expect(sentMessages[0].text).toContain("/borrar_datos CONFIRMAR");
    expect(batchedStatements).toEqual([]);
  });
});
