import { describe, expect, it } from "vitest";
import { parseWhatsAppTextMessages } from "../src/whatsapp/types";

describe("WhatsApp notification payload", () => {
  it("extracts only valid inbound text messages and their phone number ID", () => {
    const messages = parseWhatsAppTextMessages({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-1" },
            messages: [
              { from: "525500000000", id: "wamid.in", timestamp: "1", type: "text", text: { body: "Hola" } },
              { from: "525500000000", id: "wamid.image", timestamp: "1", type: "image", image: { id: "media-1" } },
            ],
          },
        }],
      }],
    });

    expect(messages).toEqual([{
      id: "wamid.in",
      from: "525500000000",
      text: "Hola",
      phoneNumberId: "phone-1",
    }]);
  });

  it("ignores malformed payloads and oversized text", () => {
    expect(parseWhatsAppTextMessages(null)).toEqual([]);
    expect(parseWhatsAppTextMessages({
      object: "other",
      entry: [{ changes: [{ field: "messages", value: {} }] }],
    })).toEqual([]);
    expect(parseWhatsAppTextMessages({
      object: "whatsapp_business_account",
      entry: [{ changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "phone-1" },
          messages: [{ from: "not-a-phone", id: "bad", type: "text", text: { body: "x" } }],
        },
      }] }],
    })).toEqual([]);
  });
});
