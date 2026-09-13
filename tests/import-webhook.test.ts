import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

describe("Telegram JSON import", () => {
  it("imports a document sent with the /importar caption", async () => {
    const { db, sqlite } = createSqliteDb();
    const env: Env = {
      PERSONAL_ASSISTANT_DB: db,
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_WEBHOOK_SECRET: "test-secret",
      TELEGRAM_ADMIN_USER_ID: "42",
      APP_TIMEZONE: "America/Mexico_City",
      DEFAULT_CURRENCY: "MXN",
    };
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const exportJson = JSON.stringify({
      exportedAt: "2026-09-10T16:00:00.000Z",
      user: { telegramUserId: 42, timezone: "America/Mexico_City", currency: "MXN", createdAt: "2026-09-01T00:00:00.000Z" },
      folders: [], tasks: [], reminders: [], expenses: [], notes: [], notificationDefaults: null, persistentNotifications: [],
    });
    const telegramFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined });
      if (url.includes("/getFile?")) return Response.json({ ok: true, result: { file_path: "documents/backup.json" } });
      if (url.includes("/file/")) return new Response(exportJson, { status: 200 });
      return Response.json({ ok: true, result: {} });
    };
    const response = await handleRequest(new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        update_id: 30,
        message: {
          message_id: 1,
          date: 1_757_000_000,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Marco" },
          document: { file_id: "Ag123_file", file_unique_id: "unique-1", file_name: "backup.json" },
          caption: "/importar",
        },
      }),
    }), env, telegramFetch);

    expect(response.status).toBe(200);
    expect(calls.find((call) => call.url.endsWith("/sendMessage"))?.body?.text).toContain("Restauración completada");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM data_imports").get()).toEqual({ count: 1 });
  });
});
