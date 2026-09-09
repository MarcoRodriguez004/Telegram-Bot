import { describe, expect, it } from "vitest";
import { answerCallbackQuery, sendMessage } from "../src/telegram/client";
import { parseTelegramUpdate } from "../src/telegram/types";
import type { Env } from "../src/types";

const env: Env = {
  PERSONAL_ASSISTANT_DB: {} as D1Database,
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  TELEGRAM_ALLOWED_USER_ID: "42",
  APP_TIMEZONE: "America/Mexico_City",
  DEFAULT_CURRENCY: "MXN",
};

describe("Telegram callback support", () => {
  it("parses an authorized callback query with its source message", () => {
    const update = parseTelegramUpdate({
      update_id: 9,
      callback_query: {
        id: "callback-1",
        from: { id: 42, is_bot: false, first_name: "Marco" },
        data: "pa:tasks:filter:pending",
        message: {
          message_id: 3,
          date: 1_757_000_000,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Marco" },
        },
      },
    });

    expect(update?.callback_query?.data).toBe("pa:tasks:filter:pending");
    expect(update?.callback_query?.message?.chat.id).toBe(42);
  });

  it("rejects callback data beyond Telegram's limit", () => {
    expect(parseTelegramUpdate({
      update_id: 9,
      callback_query: {
        id: "callback-1",
        from: { id: 42, is_bot: false },
        data: "x".repeat(65),
      },
    })).toBeNull();
  });

  it("sends inline keyboards and acknowledges callbacks", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const telegramFetch: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };

    await sendMessage(env, 42, "Selecciona", telegramFetch, {
      replyMarkup: { inline_keyboard: [[{ text: "Pendientes", callback_data: "pa:tasks:filter:pending" }]] },
    });
    await answerCallbackQuery(env, "callback-1", telegramFetch);

    expect(requests).toEqual([
      {
        url: "https://api.telegram.org/bottest-token/sendMessage",
        body: {
          chat_id: 42,
          text: "Selecciona",
          reply_markup: { inline_keyboard: [[{ text: "Pendientes", callback_data: "pa:tasks:filter:pending" }]] },
        },
      },
      {
        url: "https://api.telegram.org/bottest-token/answerCallbackQuery",
        body: { callback_query_id: "callback-1" },
      },
    ]);
  });
});
