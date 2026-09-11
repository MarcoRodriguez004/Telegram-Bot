import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { processDueNotifications } from "../src/modules/notifications/scheduler";
import { processDueReminders } from "../src/modules/reminders/scheduler";
import { completeReminder } from "../src/modules/reminders/repository";
import { setPersistentNotification } from "../src/modules/notifications/repository";
import { createSqliteDb } from "./helpers/sqlite-db";

function createEnv(db: D1Database) {
  const env: Env = {
    PERSONAL_ASSISTANT_DB: db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    TELEGRAM_ALLOWED_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
  return env;
}

describe("persistent notification scheduler", () => {
  it("sends a due task with dynamic actions and advances its next notification", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "pagar la luz", "2026-09-10T15:00:00.000Z");
    await setPersistentNotification(db, {
      userId: 1,
      resourceType: "task",
      resourceId: 1,
      intervalMinutes: 10,
      nextNotifyAt: "2026-09-10T15:10:00.000Z",
      now: "2026-09-10T15:00:00.000Z",
    });
    const calls: Array<{ text: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string }>> } }> = [];
    const telegramFetch: typeof fetch = async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)) as (typeof calls)[number]);
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };

    const sent = await processDueNotifications(db, createEnv(db), new Date("2026-09-10T15:11:00.000Z"), telegramFetch);

    expect(sent).toBe(1);
    expect(calls[0].text).toBe("📋 Tarea pendiente\n\npagar la luz");
    expect(calls[0].reply_markup?.inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Parar avisos de esta tarea", "✅ Completar", "❌ Cancelar",
    ]);
    expect(sqlite.prepare("SELECT enabled, next_notify_at, processing_until, last_notified_at FROM persistent_notifications WHERE id = 1").get())
      .toEqual({ enabled: 1, next_notify_at: "2026-09-10T15:20:00.000Z", processing_until: null, last_notified_at: "2026-09-10T15:11:00.000Z" });
  });

  it("does not send a notification after the task is completed", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at, completed_at) VALUES (?, ?, 'done', ?, ?)")
      .run(1, "ya pagada", "2026-09-10T15:00:00.000Z", "2026-09-10T15:05:00.000Z");
    sqlite.prepare(
      "INSERT INTO persistent_notifications (user_id, resource_type, resource_id, enabled, interval_minutes, next_notify_at, created_at) VALUES (?, 'task', ?, 1, ?, ?, ?)",
    ).run(1, 1, 5, "2026-09-10T15:10:00.000Z", "2026-09-10T15:00:00.000Z");
    const telegramFetch: typeof fetch = async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });

    expect(await processDueNotifications(db, createEnv(db), new Date("2026-09-10T15:11:00.000Z"), telegramFetch)).toBe(0);
  });

  it("adds persistent actions to the first reminder and repeats it later", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO reminders (user_id, title, remind_at, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(1, "llamar al banco", "2026-09-10T15:10:00.000Z", "2026-09-10T15:00:00.000Z");
    await setPersistentNotification(db, {
      userId: 1,
      resourceType: "reminder",
      resourceId: 1,
      intervalMinutes: 5,
      nextNotifyAt: "2026-09-10T15:10:00.000Z",
      now: "2026-09-10T15:00:00.000Z",
    });
    const calls: Array<{ text: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string }>> } }> = [];
    const telegramFetch: typeof fetch = async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)) as (typeof calls)[number]);
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };

    expect(await processDueReminders(db, createEnv(db), new Date("2026-09-10T15:10:00.000Z"), telegramFetch)).toBe(1);
    expect(calls[0].reply_markup?.inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Parar avisos de este recordatorio", "✅ Completar", "❌ Cancelar",
    ]);
    expect(sqlite.prepare("SELECT status, next_notify_at FROM reminders INNER JOIN persistent_notifications ON persistent_notifications.resource_id = reminders.id AND persistent_notifications.resource_type = 'reminder'").get())
      .toEqual({ status: "pending", next_notify_at: "2026-09-10T15:15:00.000Z" });

    expect(await processDueNotifications(db, createEnv(db), new Date("2026-09-10T15:16:00.000Z"), telegramFetch)).toBe(1);
    expect(calls).toHaveLength(2);

    expect(await completeReminder(db, { userId: 1, reminderId: 1, completedAt: "2026-09-10T15:17:00.000Z" })).toBe(true);
    expect(await processDueNotifications(db, createEnv(db), new Date("2026-09-10T15:21:00.000Z"), telegramFetch)).toBe(0);
  });
});
