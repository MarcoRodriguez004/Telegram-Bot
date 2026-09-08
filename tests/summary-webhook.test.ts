import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { handleRequest } from "../src/index";

function createSummaryDb() {
  const processedUpdates = new Set<number>();
  const users = new Map<number, number>();
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
              }
              return { success: true, meta: { changes: 1, last_row_id: 0 } };
            },
            async first<T>() {
              if (query.startsWith("SELECT id FROM users")) {
                return { id: users.get(Number(values[0])) } as T;
              }
              if (query.startsWith("SELECT COUNT(*)")) return { count: 2 } as T;
              if (query.startsWith("SELECT COALESCE")) return { totalCents: 12_345 } as T;
              return null;
            },
            async all<T>() {
              if (query.startsWith("SELECT title")) {
                return { results: [{ title: "pagar internet", remindAt: "2099-09-08T15:00:00.000Z" }] } as D1Result<T>;
              }
              return { results: [{ content: "renovar seguro", url: null, createdAt: "2026-09-07T20:00:00.000Z" }] } as D1Result<T>;
            },
          };
        },
      };
    },
  };

  return db as unknown as D1Database;
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

describe("summary webhook flow", () => {
  it("returns a scoped summary for the authorized user", async () => {
    const db = createSummaryDb();
    const { env, sentMessages, telegramFetch } = createEnv(db);
    const request = new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        update_id: 50,
        message: {
          message_id: 1,
          date: 1_757_000_000,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Marco" },
          text: "/resumen",
        },
      }),
    });

    const response = await handleRequest(request, env, telegramFetch);

    expect(response.status).toBe(200);
    expect(sentMessages[0].text).toContain("📋 Resumen");
    expect(sentMessages[0].text).toContain("Tareas pendientes: 2");
    expect(sentMessages[0].text).toContain("$123.45 MXN");
    expect(sentMessages[0].text).toContain("pagar internet");
    expect(sentMessages[0].text).toContain("renovar seguro");
  });
});
