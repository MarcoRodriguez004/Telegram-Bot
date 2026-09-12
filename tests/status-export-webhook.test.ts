import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

function createEnv(db: D1Database) {
  const calls: Array<{ method: string; body: unknown }> = [];
  const env: Env = {
    PERSONAL_ASSISTANT_DB: db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    TELEGRAM_ALLOWED_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
  const telegramFetch: typeof fetch = async (input, init) => {
    const body = init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body));
    calls.push({ method: String(input).split("/").at(-1) ?? "", body });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  return { env, calls, telegramFetch };
}

function update(updateId: number, text: string): string {
  return JSON.stringify({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_757_000_000,
      chat: { id: 42, type: "private" },
      from: { id: 42, is_bot: false, first_name: "Marco" },
      text,
    },
  });
}

async function post(body: string, env: Env, telegramFetch: typeof fetch): Promise<Response> {
  return handleRequest(new Request("https://bot.test/telegram/webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
    body,
  }), env, telegramFetch);
}

describe("status and export webhook flow", () => {
  it("answers status, search and export commands", async () => {
    const { db, sqlite } = createSqliteDb();
    const { env, calls, telegramFetch } = createEnv(db);
    sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(42, 42, env.APP_TIMEZONE, env.DEFAULT_CURRENCY, "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "comprar tornillos", "2026-09-10T15:00:00.000Z");

    await post(update(1, "/estado"), env, telegramFetch);
    expect(String(calls.at(-1)?.body && (calls.at(-1)?.body as Record<string, unknown>).text)).toContain("Tareas pendientes: 1");

    await post(update(2, "/buscar tornillos"), env, telegramFetch);
    expect(String(calls.at(-1)?.body && (calls.at(-1)?.body as Record<string, unknown>).text)).toContain("Tarea 1");

    await post(update(3, "/exportar"), env, telegramFetch);
    const exportCall = calls.at(-1);
    expect(exportCall?.method).toBe("sendDocument");
    expect(exportCall?.body).toBeInstanceOf(FormData);
    const document = (exportCall?.body as FormData).get("document");
    expect(document).toBeInstanceOf(File);
    expect(await (document as File).text()).toContain("comprar tornillos");
  });
});
