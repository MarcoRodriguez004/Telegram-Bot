import { parseWhatsAppTextMessages, type WhatsAppTextMessage } from "./types";

export interface WhatsAppWebhookEnv {
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
}

export interface WhatsAppWebhookLogger {
  info(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

export type WhatsAppTextMessageHandler = (message: WhatsAppTextMessage) => Promise<void>;

const MAX_WEBHOOK_BYTES = 256 * 1024;

export async function handleWhatsAppWebhook(
  request: Request,
  env: WhatsAppWebhookEnv,
  logger: WhatsAppWebhookLogger = console,
  onTextMessage?: WhatsAppTextMessageHandler,
): Promise<Response> {
  if (request.method === "GET") return verifyWebhook(request, env);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!env.WHATSAPP_APP_SECRET) {
    return new Response("WhatsApp webhook app secret is not configured", { status: 503 });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  const signature = request.headers.get("x-hub-signature-256");
  if (!signature || !(await hasValidSignature(rawBody, signature, env.WHATSAPP_APP_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!isRecord(payload)) return new Response("Invalid WhatsApp notification", { status: 400 });

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const changes = entries.reduce((total, entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) return total;
    return total + entry.changes.length;
  }, 0);

  logger.info(JSON.stringify({
    event: "whatsapp_webhook_received",
    object: typeof payload.object === "string" ? payload.object : "unknown",
    entryCount: entries.length,
    changeCount: changes,
  }));

  if (onTextMessage) {
    const configuredPhoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    for (const message of parseWhatsAppTextMessages(payload)) {
      if (configuredPhoneNumberId && message.phoneNumberId !== configuredPhoneNumberId) continue;
      try {
        await onTextMessage(message);
      } catch (error) {
        logger.error?.(JSON.stringify({
          event: "whatsapp_message_processing_failed",
          reason: error instanceof Error ? error.name : "unknown_error",
        }));
      }
    }
  }

  return Response.json({ ok: true });
}

async function verifyWebhook(request: Request, env: WhatsAppWebhookEnv): Promise<Response> {
  if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new Response("WhatsApp webhook verification is not configured", { status: 503 });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || challenge === null || !constantTimeEqual(token ?? "", env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)) {
    return new Response("Forbidden", { status: 403 });
  }

  return new Response(challenge, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function hasValidSignature(body: string, header: string, secret: string): Promise<boolean> {
  if (!header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(provided.toLowerCase(), expected);
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
