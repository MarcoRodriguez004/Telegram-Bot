import { describe, expect, it } from "vitest";
import { sendWhatsAppText } from "../src/whatsapp/client";

const env = {
  WHATSAPP_ACCESS_TOKEN: "access-token",
  WHATSAPP_PHONE_NUMBER_ID: "phone-number-id",
  WHATSAPP_API_VERSION: "v26.0",
};

describe("WhatsApp Cloud API client", () => {
  it("sends a text message to the configured phone number ID", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const response = await sendWhatsAppText(env, "525500000000", "Hola", async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 });
    });

    expect(response).toEqual({ messageId: "wamid.out" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://graph.facebook.com/v26.0/phone-number-id/messages");
    expect(calls[0]?.init.headers).toEqual({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "525500000000",
      type: "text",
      text: { preview_url: false, body: "Hola" },
    });
  });

  it("rejects missing configuration before making a request", async () => {
    await expect(sendWhatsAppText({ ...env, WHATSAPP_ACCESS_TOKEN: undefined }, "525500000000", "Hola", fetch))
      .rejects.toThrow("WhatsApp access token is not configured");
  });

  it("does not include Meta's response body in API errors", async () => {
    await expect(sendWhatsAppText(env, "525500000000", "Hola", async () => new Response(
      JSON.stringify({ error: { message: "private token-adjacent detail" } }),
      { status: 401 },
    ))).rejects.toMatchObject({ status: 401 });
    await expect(sendWhatsAppText(env, "525500000000", "Hola", async () => new Response(
      JSON.stringify({ error: { message: "private token-adjacent detail" } }),
      { status: 401 },
    ))).rejects.not.toThrow("private token-adjacent detail");
  });
});
