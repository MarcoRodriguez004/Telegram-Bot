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
  let updateId = 1;
  async function send(message: Record<string, unknown>, userId = 42) {
    return handleRequest(new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: updateId++, message: {
        message_id: updateId, date: 1_757_000_000,
        chat: { id: userId, type: "private" }, from: { id: userId, is_bot: false }, ...message,
      } }),
    }), env, telegramFetch);
  }
  async function callback(data: string, userId = 42) {
    return handleRequest(new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: updateId++, callback_query: {
        id: `callback-${updateId}`,
        from: { id: userId, is_bot: false }, data,
        message: { message_id: updateId, date: 1_757_000_000, chat: { id: 42, type: "private" } },
      } }),
    }), env, telegramFetch);
  }
  return { database, env, sent, send, callback };
}

describe("saved folders webhook flow", () => {
  it("creates a missing folder when a media caption assigns it", async () => {
    const { send, sent, database } = setup();
    await send({
      photo: [{ file_id: "photo_large", file_unique_id: "unique-new-folder", width: 100, height: 100 }],
      caption: "Guarda INE en docs personales",
    });

    expect(sent.at(-1)?.body.text).toContain("Carpeta creada: docs personales");
    expect(database.sqlite.prepare("SELECT name FROM saved_folders WHERE user_id = 1").get()).toMatchObject({ name: "docs personales" });
    expect(database.sqlite.prepare("SELECT folder_id FROM notes WHERE user_id = 1").get()).toMatchObject({ folder_id: 1 });
  });

  it("groups folders by type and lists only the selected folder", async () => {
    const { send, callback, sent } = setup();
    await send({ text: "Crea la carpeta Familia" });
    await send({ photo: [{ file_id: "photo_large", file_unique_id: "unique", width: 100, height: 100 }], caption: "Guarda logo en Familia" });
    await send({ document: { file_id: "document_pdf", file_unique_id: "unique-doc", file_name: "recibo.pdf" }, caption: "Guarda recibo en Familia" });
    await send({ text: "Mis carpetas" });

    const folderReply = sent.at(-1)?.body;
    expect(folderReply?.text).toContain("🖼️ Imágenes");
    expect(folderReply?.text).toContain("📄 Archivos");
    expect(folderReply?.text).toContain("Familia (1)");
    const photoButton = (folderReply?.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard
      .flat().find((button) => button.callback_data.startsWith("pa:f:i:p:"));
    expect(photoButton?.callback_data).toBe("pa:f:i:p:1");

    await callback(photoButton!.callback_data);
    const savedPhotos = sent.at(-2)?.body;
    expect(savedPhotos?.text).toContain("1.- Foto");
    expect(savedPhotos?.text).not.toContain("recibo");
    const photoSelector = (savedPhotos?.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard
      .flat().find((button) => button.text === "1.-");
    expect(photoSelector?.callback_data).toBe("pa:s:i:1");

    await callback(photoSelector!.callback_data);
    expect(sent.at(-2)).toMatchObject({ method: "sendPhoto", body: { photo: "photo_large", caption: "logo" } });
  });

  it("creates a missing folder while saving and blocks another user's callback", async () => {
    const { send, callback, sent, database } = setup();
    await send({ text: "Nota una nota en Errata" });
    expect(sent.at(-1)?.body.text).toContain("Nota guardada");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM notes").get()).toMatchObject({ count: 1 });
    const folderId = database.sqlite.prepare("SELECT id FROM saved_folders WHERE user_id = 1 AND name = 'Errata'").get() as { id: number };
    expect(database.sqlite.prepare("SELECT folder_id FROM notes WHERE user_id = 1").get()).toMatchObject({ folder_id: folderId.id });
    const response = await callback(`pa:f:i:l:${folderId.id}`, 99);
    expect(response.status).toBe(200);
    expect(sent.at(-2)?.body.text).toContain("Esta carpeta ya no está disponible");
  });

  it("asks before using a similar folder and can reuse the existing one", async () => {
    const { send, callback, sent, database } = setup();
    await send({ text: "Crea la carpeta Documentos personales" });
    await send({ text: "Nota INE en Documentos personles" });

    const prompt = sent.at(-1)?.body;
    expect(prompt?.text).toContain("Solicitada: Documentos personles");
    expect(prompt?.text).toContain("Existente: Documentos personales");
    const buttons = (prompt?.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard.flat();
    expect(buttons.map((button) => button.text)).toEqual([
      'Usar "Documentos personales"',
      'Crear "Documentos personles"',
    ]);
    await callback("pa:f:u");

    expect(sent.at(-2)?.body.text).toContain("Nota guardada");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM saved_folders WHERE user_id = 1").get()).toMatchObject({ count: 1 });
    expect(database.sqlite.prepare("SELECT folder_id FROM notes WHERE user_id = 1").get()).toMatchObject({ folder_id: 1 });
  });

  it("keeps a media save pending until the user chooses to create the new folder", async () => {
    const { send, callback, sent, database } = setup();
    await send({ text: "Crea la carpeta Documentos personales" });
    await send({
      photo: [{ file_id: "photo_similar", file_unique_id: "unique-similar", width: 100, height: 100 }],
      caption: "Guarda INE en Documentos personles",
    });

    expect(sent.at(-1)?.body.text).toContain("Solicitada: Documentos personles");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM notes").get()).toMatchObject({ count: 0 });
    await callback("pa:f:c");

    expect(sent.at(-2)?.body.text).toContain("Carpeta creada: Documentos personles");
    expect(database.sqlite.prepare("SELECT name FROM saved_folders WHERE user_id = 1 ORDER BY id DESC LIMIT 1").get()).toMatchObject({ name: "Documentos personles" });
    expect(database.sqlite.prepare("SELECT folder_id FROM notes WHERE user_id = 1").get()).toMatchObject({ folder_id: 2 });
  });
});
