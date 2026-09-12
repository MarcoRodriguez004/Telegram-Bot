import { describe, expect, it } from "vitest";
import { sendDocumentContent, sendMessage } from "../src/telegram/client";
import type { Env } from "../src/types";

const env = {
  TELEGRAM_BOT_TOKEN: "test-token",
} as Env;

describe("Telegram client", () => {
  it("sends an exported JSON file as a document", async () => {
    let capturedBody: BodyInit | null | undefined;
    const telegramFetch: typeof fetch = async (_input, init) => {
      capturedBody = init?.body;
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };

    await sendDocumentContent(env, 42, "mis-datos.json", "{\"ok\":true}", telegramFetch);

    expect(capturedBody).toBeInstanceOf(FormData);
    const form = capturedBody as FormData;
    expect(form.get("chat_id")).toBe("42");
    expect(form.get("document")).toBeInstanceOf(File);
    expect((form.get("document") as File).name).toBe("mis-datos.json");
    await expect((form.get("document") as File).text()).resolves.toBe("{\"ok\":true}");
  });

  it("retries a transient Telegram failure once", async () => {
    let attempts = 0;
    const telegramFetch: typeof fetch = async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ ok: false }), { status: 503 })
        : new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };

    await sendMessage(env, 42, "hola", telegramFetch);

    expect(attempts).toBe(2);
  });

  it("splits long messages and keeps the keyboard on the last chunk", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const telegramFetch: typeof fetch = async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };

    await sendMessage(env, 42, "a".repeat(4_100) + "\n" + "b".repeat(4_100), telegramFetch, {
      replyMarkup: { inline_keyboard: [[{ text: "OK", callback_data: "ok" }]] },
    });

    expect(calls.length).toBe(3);
    expect(String(calls[0].text).length).toBeLessThanOrEqual(4_096);
    expect(calls[0].reply_markup).toBeUndefined();
    expect(calls.at(-1)?.reply_markup).toBeDefined();
  });
});
