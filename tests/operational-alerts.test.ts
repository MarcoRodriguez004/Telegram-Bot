import { describe, expect, it } from "vitest";
import {
  describeOperationalFailure,
  reportOperationalFailure,
  reportOperationalSuccess,
} from "../src/modules/operations/alerts";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

function createEnv(db: D1Database): Env {
  return {
    PERSONAL_ASSISTANT_DB: db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_ADMIN_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
}

describe("operational alerts", () => {
  it("alerts on the third consecutive failure and only once per failure episode", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(42, 142, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    const messages: Array<{ chatId: number; text: string }> = [];
    const telegramFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string };
      messages.push({ chatId: body.chat_id, text: body.text });
      return Response.json({ ok: true });
    };
    const env = createEnv(db);

    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "reminders",
      detail: "telegram_delivery",
      now: new Date("2026-09-10T15:00:00.000Z"),
    }, telegramFetch);
    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "reminders",
      detail: "telegram_delivery",
      now: new Date("2026-09-10T15:05:00.000Z"),
    }, telegramFetch);
    expect(messages).toHaveLength(0);

    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "reminders",
      detail: "telegram_delivery",
      now: new Date("2026-09-10T15:16:00.000Z"),
    }, telegramFetch);
    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "reminders",
      detail: "telegram_delivery",
      now: new Date("2026-09-10T15:20:00.000Z"),
    }, telegramFetch);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ chatId: 142 });
    expect(messages[0].text).toContain("Componente: scheduler");
    expect(messages[0].text).toContain("Hora local (America/Mexico_City): 10/09/2026, 09:16:00");
    expect(messages[0].text).toContain("Fallos acumulados: 3");
    expect(sqlite.prepare("SELECT failure_count, last_alerted_at FROM operational_alerts WHERE alert_key = 'scheduler:reminders'").get())
      .toEqual({ failure_count: 4, last_alerted_at: "2026-09-10T15:16:00.000Z" });
  });

  it("resets the failure episode after a successful operation", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(42, 142, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    const messages: Array<{ chatId: number; text: string }> = [];
    const telegramFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string };
      messages.push({ chatId: body.chat_id, text: body.text });
      return Response.json({ ok: true });
    };
    const env = createEnv(db);

    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "contingency_monitor",
      now: new Date("2026-09-10T15:00:00.000Z"),
    }, telegramFetch);
    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "contingency_monitor",
      now: new Date("2026-09-10T15:05:00.000Z"),
    }, telegramFetch);
    await reportOperationalSuccess(db, {
      component: "scheduler",
      operation: "contingency_monitor",
      now: new Date("2026-09-10T15:10:00.000Z"),
    });

    expect(sqlite.prepare("SELECT failure_count, last_alerted_at FROM operational_alerts WHERE alert_key = 'scheduler:contingency_monitor'").get())
      .toEqual({ failure_count: 0, last_alerted_at: null });

    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "contingency_monitor",
      now: new Date("2026-09-10T15:15:00.000Z"),
    }, telegramFetch);
    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "contingency_monitor",
      now: new Date("2026-09-10T15:20:00.000Z"),
    }, telegramFetch);
    expect(messages).toHaveLength(0);

    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "contingency_monitor",
      now: new Date("2026-09-10T15:25:00.000Z"),
    }, telegramFetch);

    expect(messages).toHaveLength(1);
  });

  it("sends operational alerts only to the configured admin when other users exist", async () => {
    const { db, sqlite } = createSqliteDb();
    const insertUser = sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertUser.run(42, 142, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    insertUser.run(99, 199, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    const messages: Array<{ chatId: number; text: string }> = [];
    const telegramFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string };
      messages.push({ chatId: body.chat_id, text: body.text });
      return Response.json({ ok: true });
    };

    for (const minute of [0, 5, 10]) {
      await reportOperationalFailure(db, createEnv(db), {
        component: "scheduler",
        operation: "contingency_monitor",
        detail: "Official contingency bulletin could not be parsed",
        now: new Date(`2026-09-10T15:${String(minute).padStart(2, "0")}:00.000Z`),
      }, telegramFetch);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ chatId: 142 });
    expect(messages[0]?.text).toContain("Official contingency bulletin could not be parsed");
  });

  it("describes the original error without exposing URLs or Telegram tokens", () => {
    expect(describeOperationalFailure(new Error("fetch failed at https://example.test/private?token=secret")))
      .toBe("Error: fetch failed at [url]");
    expect(describeOperationalFailure(new Error("Telegram bot 123456:secret-token failed")))
      .toBe("Error: Telegram bot [telegram-token] failed");
  });
});
