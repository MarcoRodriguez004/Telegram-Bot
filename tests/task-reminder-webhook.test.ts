import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

function createEnv(db: D1Database) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const env: Env = {
    PERSONAL_ASSISTANT_DB: db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    TELEGRAM_ALLOWED_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
  const telegramFetch: typeof fetch = async (input, init) => {
    calls.push({
      method: String(input).split("/").at(-1) ?? "",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  return { env, calls, telegramFetch };
}

function messageUpdate(updateId: number, text: string): string {
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

function callbackUpdate(updateId: number, data: string): string {
  return JSON.stringify({
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: { id: 42, is_bot: false, first_name: "Marco" },
      data,
      message: {
        message_id: updateId,
        date: 1_757_000_000,
        chat: { id: 42, type: "private" },
      },
    },
  });
}

function unauthorizedCallbackUpdate(updateId: number, data: string): string {
  return callbackUpdate(updateId, data).replace(/"id":42/g, '"id":99');
}

async function post(body: string, env: Env, telegramFetch: typeof fetch): Promise<Response> {
  return handleRequest(new Request("https://bot.test/telegram/webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
    body,
  }), env, telegramFetch);
}

describe("task and reminder query webhook flow", () => {
  it("ignores callbacks from another Telegram account", async () => {
    const { db, sqlite } = createSqliteDb();
    const { env, calls, telegramFetch } = createEnv(db);
    await db.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(42, 42, env.APP_TIMEZONE, env.DEFAULT_CURRENCY, new Date().toISOString()).run();
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "no tocar", new Date().toISOString());

    const response = await post(unauthorizedCallbackUpdate(50, "pa:t:a:c:1"), env, telegramFetch);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(sqlite.prepare("SELECT status FROM tasks WHERE id = 1").get()).toEqual({ status: "pending" });
  });

  it("asks for a task status, lists ten items, and exposes the next page", async () => {
    const { db, sqlite } = createSqliteDb();
    const { env, calls, telegramFetch } = createEnv(db);

    await post(messageUpdate(1, "tareas"), env, telegramFetch);
    expect(calls[0].body.text).toBe("¿Qué tareas quieres consultar?");
    expect(JSON.stringify(calls[0].body.reply_markup)).toContain("Pendientes");

    await db.prepare("INSERT OR IGNORE INTO users (telegram_user_id, telegram_chat_id, timezone, currency) VALUES (?, ?, ?, ?)")
      .bind(42, 42, env.APP_TIMEZONE, env.DEFAULT_CURRENCY).run();
    for (let index = 1; index <= 11; index += 1) {
      sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
        .run(1, `tarea ${index}`, new Date(1_757_000_000_000 + index * 1_000).toISOString());
    }

    await post(callbackUpdate(2, "pa:t:f:p"), env, telegramFetch);
    const firstList = calls.find((call) => call.method === "sendMessage" && String(call.body.text).includes("tarea 11"));
    expect(firstList).toBeDefined();
    expect(String(firstList?.body.text)).toContain("🟡 tarea 11");
    expect(String(firstList?.body.text)).toContain("tarea 2");
    expect(String(firstList?.body.text)).not.toContain("tarea 1\n");
    expect(JSON.stringify(firstList?.body.reply_markup)).toContain("Consultar más");
    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
  });

  it("completes a task and edits a reminder through callback buttons", async () => {
    const { db, sqlite } = createSqliteDb();
    const { env, calls, telegramFetch } = createEnv(db);
    await db.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(42, 42, env.APP_TIMEZONE, env.DEFAULT_CURRENCY, new Date().toISOString()).run();
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "revisar contrato", new Date().toISOString());
    sqlite.prepare("INSERT INTO reminders (user_id, title, remind_at, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(1, "renovar póliza", new Date(Date.now() + 86_400_000).toISOString(), new Date().toISOString());

    await post(callbackUpdate(10, "pa:t:i:1"), env, telegramFetch);
    expect(String(calls.at(-2)?.body.text)).toContain("revisar contrato");
    expect(JSON.stringify(calls.at(-2)?.body.reply_markup)).toContain("Completar");

    await post(callbackUpdate(11, "pa:t:a:c:1"), env, telegramFetch);
    expect(sqlite.prepare("SELECT status FROM tasks WHERE id = 1").get()).toEqual({ status: "done" });

    await post(callbackUpdate(12, "pa:r:a:e:1"), env, telegramFetch);
    expect(String(calls.at(-2)?.body.text)).toContain("nuevo nombre y horario");
    await post(messageUpdate(13, "renovar póliza mañana a las 19:00"), env, telegramFetch);
    expect(sqlite.prepare("SELECT title, status FROM reminders WHERE id = 1").get()).toMatchObject({
      title: "renovar póliza",
      status: "pending",
    });
    expect(String(calls.at(-1)?.body.text)).toContain("Recordatorio actualizado");
  });

  it("configures an item alert and stops it while keeping the task pending", async () => {
    const { db, sqlite } = createSqliteDb();
    const { env, calls, telegramFetch } = createEnv(db);

    await post(messageUpdate(20, "tarea revisar contrato"), env, telegramFetch);
    expect(JSON.stringify(calls[0].body.reply_markup)).toContain("Cada 10 minutos");

    await post(callbackUpdate(21, "pa:t:n:10:1"), env, telegramFetch);
    expect(sqlite.prepare("SELECT enabled, interval_minutes FROM persistent_notifications WHERE resource_type = 'task' AND resource_id = 1").get())
      .toEqual({ enabled: 1, interval_minutes: 10 });

    await post(callbackUpdate(22, "pa:t:a:n:1"), env, telegramFetch);
    expect(sqlite.prepare("SELECT enabled FROM persistent_notifications WHERE resource_type = 'task' AND resource_id = 1").get())
      .toEqual({ enabled: 0 });
    expect(String(calls.at(-2)?.body.text)).toContain("¿Se completó?");

    await post(callbackUpdate(23, "pa:t:a:z:1"), env, telegramFetch);
    expect(sqlite.prepare("SELECT status, cancelled_at FROM tasks WHERE id = 1").get()).toEqual({ status: "pending", cancelled_at: null });
    expect(String(calls.at(-2)?.body.text)).toContain("Queda pendiente");
  });

  it("offers global alert configuration and applies it to both resource types", async () => {
    const { db, sqlite } = createSqliteDb();
    const { env, calls, telegramFetch } = createEnv(db);

    await post(messageUpdate(30, "/configuracion"), env, telegramFetch);
    expect(String(calls[0].body.text)).toContain("Configuración de avisos persistentes");
    expect(JSON.stringify(calls[0].body.reply_markup)).toContain("Tareas y recordatorios");

    await post(callbackUpdate(31, "pa:g:s:a"), env, telegramFetch);
    expect(String(calls.at(-2)?.body.text)).toContain("tareas y recordatorios");
    expect(JSON.stringify(calls.at(-2)?.body.reply_markup)).toContain("Activar cada 20 minutos");

    await post(callbackUpdate(32, "pa:g:n:a:20"), env, telegramFetch);
    expect(sqlite.prepare("SELECT tasks_enabled, tasks_interval_minutes, reminders_enabled, reminders_interval_minutes FROM notification_preferences WHERE user_id = 1").get())
      .toEqual({ tasks_enabled: 1, tasks_interval_minutes: 20, reminders_enabled: 1, reminders_interval_minutes: 20 });
  });
});
