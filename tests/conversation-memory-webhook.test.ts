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
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
  const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
  const telegramFetch: typeof fetch = async (url, init) => {
    sent.push({ method: String(url).split("/").pop()!, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true });
  };
  let nextUpdate = 1;
  async function send(message: Record<string, unknown>) {
    return handleRequest(new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: nextUpdate++, message: {
        message_id: nextUpdate, date: 1_757_000_000,
        chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false }, ...message,
      } }),
    }), env, telegramFetch);
  }
  return { env, send, sent };
}

describe("conversation memory", () => {
  it("answers a saved-photo follow-up using the previous query context", async () => {
    const { send, sent } = setup();
    await send({
      photo: [{ file_id: "photo_large", file_unique_id: "unique_large", width: 1280, height: 960 }],
      caption: "Guarda logo",
    });
    await send({ text: "Mis fotos" });
    await send({ text: "Muestramelas" });

    expect(sent.at(-1)?.body.text).toContain("📷 Imágenes guardadas");
    expect(sent.at(-1)?.body.text).toContain("logo");
  });
});
