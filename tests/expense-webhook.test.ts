import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { handleRequest } from "../src/index";

type StoredExpense = { userId: number; amountCents: number; currency: string; category: string };

function createExpenseDb() {
  const processedUpdates = new Set<number>();
  const users = new Map<number, number>();
  const expenses: StoredExpense[] = [];
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

              if (query.startsWith("INSERT INTO expenses")) {
                expenses.push({
                  userId: Number(values[0]),
                  amountCents: Number(values[1]),
                  currency: String(values[2]),
                  category: String(values[3]),
                });
                return { success: true, meta: { changes: 1, last_row_id: 1 } };
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

  return { db: db as unknown as D1Database, expenses };
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

describe("expense webhook flow", () => {
  it("persists an authorized expense and confirms the amount", async () => {
    const { db, expenses } = createExpenseDb();
    const { env, sentMessages, telegramFetch } = createEnv(db);
    const request = new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        update_id: 30,
        message: {
          message_id: 1,
          date: 1_757_000_000,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Marco" },
          text: "/gasto 450 gasolina",
        },
      }),
    });

    const response = await handleRequest(request, env, telegramFetch);

    expect(response.status).toBe(200);
    expect(expenses).toEqual([{ userId: 1, amountCents: 45_000, currency: "MXN", category: "gasolina" }]);
    expect(sentMessages[0]).toMatchObject({ chat_id: 42 });
    expect(sentMessages[0].text).toContain("450");
    expect(sentMessages[0].text).toContain("gasolina");
  });
});
