import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { handleRequest } from "../src/index";

type SentMessage = { chat_id: number; text: string };

function createFakeDb() {
  const processedUpdates = new Set<number>();

  return {
    processedUpdates,
    prepare(_query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              const updateId = Number(values[0]);
              const inserted = !processedUpdates.has(updateId);
              if (inserted) processedUpdates.add(updateId);
              return { success: true, meta: { changes: inserted ? 1 : 0 } };
            },
          };
        },
      };
    },
  };
}

function createEnv() {
  const db = createFakeDb();
  const sentMessages: SentMessage[] = [];
  const env: Env = {
    PERSONAL_ASSISTANT_DB: db as unknown as D1Database,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    TELEGRAM_ALLOWED_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
  const telegramFetch: typeof fetch = async (_input, init) => {
    sentMessages.push(JSON.parse(String(init?.body)) as SentMessage);
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  return { db, env, sentMessages, telegramFetch };
}

function telegramUpdate(updateId: number, userId = 42) {
  return JSON.stringify({
    update_id: updateId,
    message: {
      message_id: 1,
      date: 1_757_000_000,
      chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false, first_name: "Marco" },
      text: "/start",
    },
  });
}

describe("Personal Assistant Worker", () => {
  it("returns a healthy JSON response", async () => {
    const { env } = createEnv();

    const response = await handleRequest(new Request("https://bot.test/health"), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "personal-assistant-bot" });
  });

  it("rejects a webhook with an invalid secret without calling Telegram", async () => {
    const { env, sentMessages, telegramFetch } = createEnv();
    const request = new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "wrong" },
      body: telegramUpdate(1),
    });

    const response = await handleRequest(request, env, telegramFetch);

    expect(response.status).toBe(401);
    expect(sentMessages).toHaveLength(0);
  });

  it("ignores an unauthorized Telegram user", async () => {
    const { env, db, sentMessages, telegramFetch } = createEnv();
    const request = new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: telegramUpdate(2, 99),
    });

    const response = await handleRequest(request, env, telegramFetch);

    expect(response.status).toBe(200);
    expect(sentMessages).toHaveLength(0);
    expect(db.processedUpdates.size).toBe(0);
  });

  it("answers /start and does not process the same update twice", async () => {
    const { env, db, sentMessages, telegramFetch } = createEnv();
    const request = () =>
      new Request("https://bot.test/telegram/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
        body: telegramUpdate(3),
      });

    expect((await handleRequest(request(), env, telegramFetch)).status).toBe(200);
    expect((await handleRequest(request(), env, telegramFetch)).status).toBe(200);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({ chat_id: 42 });
    expect(sentMessages[0].text).toContain("Personal Assistant");
    expect(db.processedUpdates.size).toBe(1);
  });

  it("returns bad request for malformed JSON", async () => {
    const { env } = createEnv();
    const request = new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: "not-json",
    });

    const response = await handleRequest(request, env);

    expect(response.status).toBe(400);
  });
});
