const MAX_TEXT_LENGTH = 4_096;
const MAX_MESSAGES_PER_NOTIFICATION = 100;

export interface WhatsAppTextMessage {
  id: string;
  from: string;
  text: string;
  phoneNumberId: string;
}

export function parseWhatsAppTextMessages(input: unknown): WhatsAppTextMessage[] {
  if (!isRecord(input) || input.object !== "whatsapp_business_account" || !Array.isArray(input.entry)) return [];

  const messages: WhatsAppTextMessage[] = [];
  for (const entry of input.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== "messages" || !isRecord(change.value)) continue;
      const metadata = isRecord(change.value.metadata) ? change.value.metadata : null;
      const phoneNumberId = metadata && asBoundedString(metadata.phone_number_id, 64);
      if (!phoneNumberId || !Array.isArray(change.value.messages)) continue;

      for (const message of change.value.messages) {
        if (messages.length >= MAX_MESSAGES_PER_NOTIFICATION) return messages;
        if (!isRecord(message) || message.type !== "text") continue;
        const id = asBoundedString(message.id, 512);
        const from = asPhoneId(message.from);
        const text = isRecord(message.text) ? asBoundedString(message.text.body, MAX_TEXT_LENGTH) : null;
        if (!id || !from || !text || text.trim().length === 0) continue;
        messages.push({ id, from, text: text.trim(), phoneNumberId });
      }
    }
  }
  return messages;
}

function asPhoneId(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{7,20}$/u.test(value)) return null;
  return value;
}

function asBoundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
