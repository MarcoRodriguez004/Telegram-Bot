import { describe, expect, it } from "vitest";
import { handleWhatsAppWebhook } from "../src/whatsapp/webhook";
import type { WhatsAppWebhookEnv } from "../src/whatsapp/webhook";

const env: WhatsAppWebhookEnv = {
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
  WHATSAPP_APP_SECRET: "app-secret",
};

async function sign(body: string, secret = env.WHATSAPP_APP_SECRET ?? "") {
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

describe("WhatsApp webhook", () => {
  it("returns Meta's challenge when the verification token matches", async () => {
    const response = await handleWhatsAppWebhook(new Request(
      "https://bot.test/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-123",
    ), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-123");
  });

  it("rejects an invalid verification token", async () => {
    const response = await handleWhatsAppWebhook(new Request(
      "https://bot.test/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123",
    ), env);

    expect(response.status).toBe(403);
  });

  it("rejects verification when the secret is not configured", async () => {
    const response = await handleWhatsAppWebhook(new Request(
      "https://bot.test/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-123",
    ), {});

    expect(response.status).toBe(503);
  });

  it("accepts a signed WhatsApp notification without logging the payload", async () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "waba-1", changes: [{ field: "messages", value: {} }] }],
    });
    const logs: unknown[][] = [];
    const response = await handleWhatsAppWebhook(new Request("https://bot.test/whatsapp/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": await sign(body) },
      body,
    }), env, { info: (...args: unknown[]) => logs.push(args) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(JSON.stringify(logs)).not.toContain("waba-1");
  });

  it("rejects an invalid notification signature", async () => {
    const response = await handleWhatsAppWebhook(new Request("https://bot.test/whatsapp/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=invalid" },
      body: "{}",
    }), env);

    expect(response.status).toBe(401);
  });

  it("rejects malformed notifications", async () => {
    const body = "not-json";
    const response = await handleWhatsAppWebhook(new Request("https://bot.test/whatsapp/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": await sign(body) },
      body,
    }), env);

    expect(response.status).toBe(400);
  });

  it("does not accept notifications until the app secret is configured", async () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    const response = await handleWhatsAppWebhook(new Request("https://bot.test/whatsapp/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }), { WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token" });

    expect(response.status).toBe(503);
  });
});
