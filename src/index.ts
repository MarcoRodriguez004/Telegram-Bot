import { claimUpdate } from "./db/repository";
import { hasValidWebhookSecret, isAuthorizedUpdate } from "./telegram/auth";
import { sendMessage } from "./telegram/client";
import { parseTelegramUpdate } from "./telegram/types";
import type { Env } from "./types";

const MAX_UPDATE_BYTES = 64 * 1024;

const worker: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};

export default worker;

export async function handleRequest(
  request: Request,
  env: Env,
  telegramFetch: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "personal-assistant-bot" });
  }

  if (url.pathname !== "/telegram/webhook") {
    return new Response("Not found", { status: 404 });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!hasValidWebhookSecret(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_UPDATE_BYTES) {
      return new Response("Payload too large", { status: 413 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const update = parseTelegramUpdate(parsedBody);
    if (!update) {
      return new Response("Invalid Telegram update", { status: 400 });
    }

    if (!isAuthorizedUpdate(update, env)) {
      return new Response(null, { status: 200 });
    }

    const userId = update.message?.from?.id;
    if (userId === undefined || !(await claimUpdate(env.PERSONAL_ASSISTANT_DB, update.update_id, userId))) {
      return new Response(null, { status: 200 });
    }

    const text = update.message?.text?.trim();
    if (!text || !update.message) {
      return new Response(null, { status: 200 });
    }

    const reply = getCommandReply(text);
    await sendMessage(env, update.message.chat.id, reply, telegramFetch);
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Webhook processing failed", error instanceof Error ? error.message : "unknown error");
    return new Response("Internal error", { status: 500 });
  }
}

function getCommandReply(text: string): string {
  const command = text.split(/\s+/, 1)[0].toLowerCase().split("@")[0];

  if (command === "/start") {
    return "👋 Bienvenido a Personal Assistant.\n\nEscribe una tarea, gasto o recordatorio en lenguaje natural.";
  }

  if (command === "/help") {
    return "Puedo ayudarte con tareas, recordatorios, gastos y enlaces.\n\nEjemplos:\n• tarea comprar medicina\n• recuérdame pagar internet mañana\n• gasto 450 gasolina\n• guardar https://ejemplo.com";
  }

  return "Todavía estoy construyendo mis módulos. Por ahora prueba /start o /help.";
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
