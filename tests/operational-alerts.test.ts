import { describe, expect, it } from "vitest";
import { describeOperationalFailure, reportOperationalFailure } from "../src/modules/operations/alerts";
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
  it("notifies the admin once per cooldown window and tracks repeated failures", async () => {
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
    await reportOperationalFailure(db, env, {
      component: "scheduler",
      operation: "reminders",
      detail: "telegram_delivery",
      now: new Date("2026-09-10T15:16:00.000Z"),
    }, telegramFetch);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ chatId: 142 });
    expect(messages[0].text).toContain("Componente: scheduler");
    expect(sqlite.prepare("SELECT failure_count, last_alerted_at FROM operational_alerts WHERE alert_key = 'scheduler:reminders'").get())
      .toEqual({ failure_count: 3, last_alerted_at: "2026-09-10T15:16:00.000Z" });
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

    await reportOperationalFailure(db, createEnv(db), {
      component: "scheduler",
      operation: "contingency_monitor",
      detail: "Official contingency bulletin could not be parsed",
      now: new Date("2026-09-10T15:00:00.000Z"),
    }, telegramFetch);

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
