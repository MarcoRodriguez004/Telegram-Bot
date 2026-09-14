import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function createEnv() {
  const { db, sqlite } = createSqliteDb();
  sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(42, 42, "America/Mexico_City", "MXN", new Date().toISOString());
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const env: Env = {
    PERSONAL_ASSISTANT_DB: db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
    TELEGRAM_ADMIN_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
    WHATSAPP_APP_SECRET: "app-secret",
    WHATSAPP_ACCESS_TOKEN: "access-token",
    WHATSAPP_PHONE_NUMBER_ID: "phone-1",
    WHATSAPP_ALLOWED_USER_ID: "525500000000",
    WHATSAPP_API_VERSION: "v26.0",
  };
  const whatsappFetch: typeof fetch = async (input, init) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 });
  };
  return { db, sqlite, env, sent, whatsappFetch };
}

function notification(messageId: string, from = "525500000000", text = "/help"): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{
      field: "messages",
      value: {
        metadata: { phone_number_id: "phone-1" },
        messages: [{ from, id: messageId, timestamp: "1", type: "text", text: { body: text } }],
      },
    }] }],
  });
}

async function post(body: string, env: Env, whatsappFetch: typeof fetch) {
  return handleRequest(new Request("https://bot.test/whatsapp/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": await sign(body, env.WHATSAPP_APP_SECRET ?? ""),
    },
    body,
  }), env, fetch, fetch, whatsappFetch);
}

describe("WhatsApp conversational flow", () => {
  it("processes an authorized text and sends a response through Cloud API", async () => {
    const { env, sent, whatsappFetch, sqlite } = createEnv();

    const response = await post(notification("wamid.in"), env, whatsappFetch);

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({ to: "525500000000", type: "text" });
    expect(String((sent[0]?.body.text as Record<string, unknown>).body)).toContain("Puedo ayudarte");
    expect(sqlite.prepare("SELECT whatsapp_user_id FROM users WHERE id = 1").get()).toEqual({ whatsapp_user_id: "525500000000" });
  });

  it("does not process the same WhatsApp message twice", async () => {
    const { env, sent, whatsappFetch } = createEnv();

    await post(notification("wamid.duplicate"), env, whatsappFetch);
    await post(notification("wamid.duplicate"), env, whatsappFetch);

    expect(sent).toHaveLength(1);
  });

  it("ignores a sender that is not allowlisted", async () => {
    const { env, sent, whatsappFetch, sqlite } = createEnv();

    await post(notification("wamid.unauthorized", "525511111111"), env, whatsappFetch);

    expect(sent).toHaveLength(0);
    expect(sqlite.prepare("SELECT whatsapp_user_id FROM users WHERE id = 1").get()).toEqual({ whatsapp_user_id: null });
  });
});
