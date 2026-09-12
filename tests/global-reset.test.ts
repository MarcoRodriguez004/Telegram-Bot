import { afterEach, describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

const databases: ReturnType<typeof createSqliteDb>[] = [];
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); });

function setup() {
  const database = createSqliteDb();
  databases.push(database);
  const env: Env = {
    PERSONAL_ASSISTANT_DB: database.db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_ALLOWED_USER_ID: "42",
    TELEGRAM_ADMIN_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
  const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
  const telegramFetch: typeof fetch = async (url, init) => {
    sent.push({ method: String(url).split("/").pop()!, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true });
  };
  let updateId = 1;
  async function send(text: string, userId = 42) {
    return handleRequest(new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: updateId++, message: {
        message_id: updateId, date: 1_757_000_000,
        chat: { id: userId, type: "private" }, from: { id: userId, is_bot: false }, text,
      } }),
    }), env, telegramFetch);
  }
  return { database, sent, send };
}

describe("global database reset", () => {
  it("requires three exact confirmations before deleting every application row", async () => {
    const { database, sent, send } = setup();
    database.sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, created_at) VALUES (42, 42, '2026-09-12T00:00:00.000Z'), (99, 99, '2026-09-12T00:00:00.000Z')").run();
    database.sqlite.prepare("INSERT INTO tasks (user_id, title, created_at) VALUES (1, 'admin task', '2026-09-12T00:00:00.000Z'), (2, 'other task', '2026-09-12T00:00:00.000Z')").run();
    database.sqlite.prepare("INSERT INTO storage_status (id, size_bytes, over_limit, updated_at) VALUES (1, 123, 0, '2026-09-12T00:00:00.000Z')").run();

    await send("/borrar_bd");
    expect(sent.at(-1)?.body.text).toContain("Confirmación 1 de 3");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks").get()).toMatchObject({ count: 2 });

    await send("CONFIRMO BORRADO GLOBAL 1/3");
    expect(sent.at(-1)?.body.text).toContain("Confirmación 2 de 3");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()).toMatchObject({ count: 2 });

    await send("CONFIRMO BORRADO GLOBAL 2/3");
    expect(sent.at(-1)?.body.text).toContain("Confirmación 3 de 3");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks").get()).toMatchObject({ count: 2 });

    await send("CONFIRMO BORRADO GLOBAL 3/3");
    expect(sent.at(-1)?.body.text).toContain("base de datos fue vaciada");
    for (const table of ["users", "tasks", "reminders", "expenses", "notes", "saved_folders", "persistent_notifications", "notification_preferences", "edit_sessions", "conversation_context", "pending_conversation", "conversation_confirmations", "pending_folder_saves", "storage_status", "processed_updates", "database_reset_confirmations"]) {
      expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toMatchObject({ count: 0 });
    }
  });

  it("does not allow another user to start the global reset", async () => {
    const { database, sent, send } = setup();
    database.sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, created_at) VALUES (99, 99, '2026-09-12T00:00:00.000Z')").run();

    await send("/borrar_bd", 99);

    expect(sent.at(-1)?.body.text).toContain("solo está disponible para el administrador");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()).toMatchObject({ count: 1 });
  });

  it("cancels the sequence when a confirmation is wrong", async () => {
    const { database, sent, send } = setup();

    await send("/borrar_bd");
    await send("CONFIRMO BORRADO GLOBAL 2/3");

    expect(sent.at(-1)?.body.text).toContain("proceso se canceló");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM database_reset_confirmations").get()).toMatchObject({ count: 0 });
  });
});
