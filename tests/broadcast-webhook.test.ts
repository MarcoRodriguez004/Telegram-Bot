import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

function setup() {
  const database = createSqliteDb();
  database.sqlite.prepare(
    "INSERT INTO users (telegram_user_id, telegram_chat_id, created_at) VALUES (42, 42, '2026-09-13T20:00:00.000Z'), (99, 990, '2026-09-13T20:00:00.000Z')",
  ).run();
  const env: Env = {
    PERSONAL_ASSISTANT_DB: database.db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_ADMIN_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
  const sent: Array<{ chatId: number; text: string }> = [];
  const telegramFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string };
    sent.push({ chatId: body.chat_id, text: body.text });
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

describe("broadcast webhook", () => {
  it("requires three confirmations and broadcasts to all known chats", async () => {
    const { database, sent, send } = setup();

    await send("/difundir Aviso de prueba");
    expect(sent.at(-1)?.text).toContain("Destinatarios conocidos: 2");
    expect(sent.at(-1)?.text).toContain("CONFIRMAR DIFUSIÓN 1/3");
    expect(sent).toHaveLength(1);

    await send("CONFIRMAR DIFUSIÓN 1/3");
    expect(sent.at(-1)?.text).toContain("CONFIRMAR DIFUSIÓN 2/3");
    await send("CONFIRMAR DIFUSIÓN 2/3");
    expect(sent.at(-1)?.text).toContain("CONFIRMAR DIFUSIÓN 3/3");
    await send("CONFIRMAR DIFUSIÓN 3/3");

    expect(sent.filter((item) => item.text === "Aviso de prueba").map((item) => item.chatId)).toEqual([42, 990]);
    expect(sent.at(-1)?.text).toContain("Entregados: 2");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM broadcast_confirmations").get()).toMatchObject({ count: 0 });
  });

  it("does not allow another user to start a broadcast", async () => {
    const { sent, send } = setup();

    await send("/difundir aviso privado", 99);

    expect(sent.at(-1)?.text).toContain("solo está disponible para el administrador");
    expect(sent).toHaveLength(1);
  });
});
