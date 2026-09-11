import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

const databases: ReturnType<typeof createSqliteDb>[] = [];
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); });

const photo = [
  { file_id: "photo_large", file_unique_id: "unique_large", width: 1280, height: 960 },
  { file_id: "photo_small", file_unique_id: "unique_small", width: 320, height: 240 },
];
const document = { file_id: "document_pdf", file_unique_id: "unique_pdf", file_name: "recibo.pdf" };

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
  const delivery = { fail: false };
  const telegramFetch: typeof fetch = async (url, init) => {
    sent.push({ method: String(url).split("/").pop()!, body: JSON.parse(String(init?.body)) });
    if (delivery.fail && !String(url).endsWith("/sendMessage")) return Response.json({ ok: false });
    return Response.json({ ok: true });
  };
  let nextUpdate = 1;
  async function send(message: Record<string, unknown>, updateId = nextUpdate++, secret = env.TELEGRAM_WEBHOOK_SECRET) {
    return handleRequest(new Request("https://bot.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify({ update_id: updateId, message: {
        message_id: updateId, date: 1_757_000_000,
        chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false }, ...message,
      } }),
    }), env, telegramFetch);
  }
  return { ...database, env, send, sent, delivery };
}

describe("saved attachments", () => {
  it("saves the largest photo once when its caption is Guarda", async () => {
    const { send, sent, sqlite } = setup();
    expect((await send({ photo, caption: "Guarda" }, 10)).status).toBe(200);
    await send({ photo, caption: "Guarda" }, 10);
    const notes = sqlite.prepare("SELECT * FROM notes").all();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ content: "Foto", file_id: "photo_large", file_kind: "photo" });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.text).toContain("Foto guardada");
  });

  it("saves a named PDF and returns it from mis guardados", async () => {
    const { send, sent } = setup();
    await send({ document, caption: "Guarda recibo de luz" });
    await send({ text: "Mis guardados" });
    expect(sent.at(-1)?.body.text).toContain("recibo de luz");
    expect(sent.at(-1)?.body.text).toContain("/guardado_1");
    await send({ text: "/guardado_1" });
    expect(sent.at(-1)).toMatchObject({ method: "sendDocument", body: {
      chat_id: 42, document: "document_pdf", caption: "recibo de luz",
    } });
  });

  it("returns a saved photo using sendPhoto", async () => {
    const { send, sent } = setup();
    await send({ photo, caption: "guardar recibo CFE" });
    await send({ text: "ver guardado 1" });
    expect(sent.at(-1)).toMatchObject({ method: "sendPhoto", body: { photo: "photo_large", caption: "recibo CFE" } });
  });

  it("lists saved images from a natural-language request without mixing documents", async () => {
    const { send, sent } = setup();
    await send({ photo, caption: "Guarda logo" });
    await send({ document, caption: "Guarda recibo" });
    await send({ text: "Muestrame las imagenes guardadas" });
    expect(sent.at(-1)?.body.text).toContain("🖼️ Imágenes");
    expect(sent.at(-1)?.body.text).toContain("Sin carpeta (1)");
    expect(sent.at(-1)?.body.text).not.toContain("recibo");
  });

  it("explains how to save media without treating another caption as a command", async () => {
    const { send, sent, sqlite } = setup();
    await send({ photo });
    await send({ document, caption: "/borrar_datos CONFIRMAR" });
    expect(sqlite.prepare("SELECT * FROM notes").all()).toHaveLength(0);
    expect(sent).toHaveLength(2);
    expect(sent[0].body.text).toContain("Guarda");
  });

  it("lists and retrieves existing text notes and links", async () => {
    const { send, sent } = setup();
    await send({ text: "nota póliza pendiente" });
    await send({ text: "guardar https://example.com" });
    await send({ text: "mis guardados" });
    expect(sent.at(-1)?.body.text).toContain("póliza pendiente");
    expect(sent.at(-1)?.body.text).toContain("https://example.com");
    await send({ text: "/guardado 1" });
    expect(sent.at(-1)?.body.text).toContain("póliza pendiente");
  });

  it("does not expose another user's saved file", async () => {
    const { send, sent } = setup();
    await send({ from: { id: 99, is_bot: false }, chat: { id: 99, type: "private" }, document, caption: "Guarda privado" });
    await send({ text: "mis guardados" });
    expect(sent.at(-1)?.body.text).toContain("No tienes guardados");
    await send({ text: "/guardado_1" });
    expect(sent.at(-1)?.body.text).toContain("No encontré ese guardado");
    expect(sent.every((item) => item.method === "sendMessage")).toBe(true);
  });

  it("accepts private users but rejects groups and invalid webhook secrets", async () => {
    const { send, sent, sqlite } = setup();
    await send({ photo, caption: "Guarda", from: { id: 99, is_bot: false }, chat: { id: 99, type: "private" } });
    await send({ document, caption: "Guarda", chat: { id: -123, type: "group" } });
    expect((await send({ photo, caption: "Guarda" }, 5, "wrong")).status).toBe(401);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.text).toContain("Foto guardada");
    expect(sqlite.prepare("SELECT * FROM notes").all()).toHaveLength(1);
  });

  it("removes saved attachments with the existing privacy command", async () => {
    const { send, sent, sqlite } = setup();
    await send({ document, caption: "Guarda" });
    expect(sqlite.prepare("SELECT * FROM notes").all()).toHaveLength(1);
    await send({ text: "/borrar_datos CONFIRMAR" });
    expect(sqlite.prepare("SELECT * FROM notes").all()).toHaveLength(0);
    expect(sqlite.prepare("SELECT * FROM users").all()).toHaveLength(0);
    await send({ text: "/guardado_1" });
    expect(sent.at(-1)?.body.text).toContain("No encontré ese guardado");
  });

  it("paginates saved notes without duplicates or losing older items", async () => {
    const { send, sent } = setup();
    for (let i = 1; i <= 12; i++) await send({ text: `nota nota ${i} ${"x".repeat(900)}` });
    await send({ text: "mis guardados" });
    const firstPage = String(sent.at(-1)?.body.text);
    expect(firstPage.match(/\/guardado_\d+/g)).toHaveLength(10);
    expect(firstPage).toContain("/guardado_12");
    expect(firstPage).toContain("Más: /guardados_3");
    expect(firstPage.length).toBeLessThan(4096);
    // New arrivals should not shift the cursor into a repeated page.
    await send({ text: "nota nueva" });
    await send({ text: "/guardados_3" });
    expect(String(sent.at(-1)?.body.text).match(/\/guardado_\d+/g)).toEqual(["/guardado_2", "/guardado_1"]);
    expect(sent.at(-1)?.body.text).not.toContain("Más:");
  });

  it.each([
    { photo: [] },
    { photo: [{ ...photo[0], width: -1 }] },
    { photo: [{ ...photo[0], file_id: "https://example.com/image.jpg" }] },
    { document: { ...document, file_name: 42 } },
    { document: { ...document, file_id: "attach://local" } },
    { document, caption: { text: "Guarda" } },
  ])("rejects malformed attachment metadata: %j", async (message) => {
    const { send, sent, sqlite } = setup();
    expect((await send({ caption: "Guarda", ...message })).status).toBe(400);
    expect(sent).toHaveLength(0);
    expect(sqlite.prepare("SELECT * FROM notes").all()).toHaveLength(0);
  });

  it("rejects descriptions that exceed the note limit without storing a file", async () => {
    const { send, sent, sqlite } = setup();
    await send({ photo, caption: `Guarda ${"x".repeat(1001)}` });
    expect(sent.at(-1)?.body.text).toContain("demasiado largo");
    expect(sqlite.prepare("SELECT * FROM notes").all()).toHaveLength(0);
  });

  it("normalizes a document filename used as the saved title", async () => {
    const { send, sent, sqlite } = setup();
    await send({ document: { ...document, file_name: "recibo\n\tluz.pdf" }, caption: "Guarda" });
    expect(sqlite.prepare("SELECT content FROM notes").get()).toMatchObject({ content: "recibo luz.pdf" });
    expect(sent[0].body.text).toContain("recibo luz.pdf");
  });

  it("rejects incomplete attachment references in the database", async () => {
    const { send, sqlite } = setup();
    await send({ document, caption: "Guarda" });
    expect(() => sqlite.prepare("UPDATE notes SET file_id = NULL WHERE id = 1").run()).toThrow();
    expect(() => sqlite.prepare("UPDATE notes SET file_kind = NULL WHERE id = 1").run()).toThrow();
  });

  it("keeps the saved file when Telegram cannot deliver it and allows a new request", async () => {
    const { send, sent, delivery, sqlite } = setup();
    await send({ document, caption: "Guarda" });
    delivery.fail = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await send({ text: "/guardado_1" })).status).toBe(200);
      expect(sent.at(-1)?.body.text).toContain("Sigue guardado");
      expect(sqlite.prepare("SELECT * FROM notes").all()).toHaveLength(1);
      expect(JSON.stringify(errors.mock.calls)).not.toContain("test-token");
      delivery.fail = false;
      await send({ text: "/guardado_1" });
      expect(sent.at(-1)?.method).toBe("sendDocument");
    } finally {
      errors.mockRestore();
    }
  });
});
