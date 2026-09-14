export interface WhatsAppClientEnv {
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_API_VERSION?: string;
}

export interface WhatsAppSendResult {
  messageId?: string;
}

export class WhatsAppApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`WhatsApp API request failed with status ${status}`);
    this.name = "WhatsAppApiError";
    this.status = status;
  }
}

const MAX_TEXT_LENGTH = 4_096;
const REQUEST_TIMEOUT_MS = 10_000;

export async function sendWhatsAppText(
  env: WhatsAppClientEnv,
  recipient: string,
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<WhatsAppSendResult> {
  const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const version = env.WHATSAPP_API_VERSION?.trim() || "v26.0";
  if (!token) throw new Error("WhatsApp access token is not configured");
  if (!phoneNumberId) throw new Error("WhatsApp phone number ID is not configured");
  if (!/^v\d+\.\d+$/u.test(version)) throw new Error("WhatsApp API version is invalid");
  if (!/^\d{7,20}$/u.test(recipient)) throw new Error("WhatsApp recipient is invalid");
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) throw new Error("WhatsApp text length is invalid");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { preview_url: false, body: text },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new WhatsAppApiError(response.status);

    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      return {};
    }
    const messageId = isRecord(payload) && Array.isArray(payload.messages) && isRecord(payload.messages[0]) &&
      typeof payload.messages[0].id === "string"
      ? payload.messages[0].id
      : undefined;
    return messageId ? { messageId } : {};
  } catch (error) {
    if (error instanceof WhatsAppApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("WhatsApp API request timed out");
    }
    throw new Error("WhatsApp API request failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendWhatsAppTextChunks(
  env: WhatsAppClientEnv,
  recipient: string,
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const chunks = splitText(text, MAX_TEXT_LENGTH);
  for (const chunk of chunks) await sendWhatsAppText(env, recipient, chunk, fetcher);
}

function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const lineBreak = remaining.lastIndexOf("\n", maxLength);
    const splitAt = lineBreak > Math.floor(maxLength * 0.6) ? lineBreak : maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
