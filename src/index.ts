import { ensureUser } from "./db/users";
import { claimUpdate } from "./db/repository";
import { createReminder } from "./modules/reminders/repository";
import { processDueReminders } from "./modules/reminders/scheduler";
import { createExpense } from "./modules/expenses/repository";
import { createNote } from "./modules/notes/repository";
import { createTask } from "./modules/tasks/repository";
import { parseIntent } from "./router/parser";
import { getZonedDateTime } from "./shared/dates";
import { hasValidWebhookSecret, isAuthorizedUpdate } from "./telegram/auth";
import { sendMessage } from "./telegram/client";
import { parseTelegramUpdate } from "./telegram/types";
import type { TelegramUpdate } from "./telegram/types";
import type { Env } from "./types";

const MAX_UPDATE_BYTES = 64 * 1024;

const worker: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
  async scheduled(controller, env) {
    await processDueReminders(env.PERSONAL_ASSISTANT_DB, env, new Date(controller.scheduledTime));
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

    const reply = await getReply(text, update, env);
    await sendMessage(env, update.message.chat.id, reply, telegramFetch);
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Webhook processing failed", error instanceof Error ? error.message : "unknown error");
    return new Response("Internal error", { status: 500 });
  }
}

async function getReply(text: string, update: TelegramUpdate, env: Env): Promise<string> {
  const commandReply = getCommandReply(text);
  if (commandReply) {
    return commandReply;
  }

  const intent = parseIntent(text, { timezone: env.APP_TIMEZONE, currency: env.DEFAULT_CURRENCY });
  if (
    intent.action === "create_task" ||
    intent.action === "create_reminder" ||
    intent.action === "create_expense" ||
    intent.action === "save_note"
  ) {
    const message = update.message;
    const telegramUserId = message?.from?.id;
    if (!message || telegramUserId === undefined) {
      return "No pude identificar al usuario de Telegram.";
    }

    const userId = await ensureUser(env.PERSONAL_ASSISTANT_DB, {
      telegramUserId,
      telegramChatId: message.chat.id,
      timezone: env.APP_TIMEZONE,
      currency: env.DEFAULT_CURRENCY,
    });
    if (intent.action === "create_task") {
      await createTask(env.PERSONAL_ASSISTANT_DB, { userId, title: intent.title });
      return `✅ Tarea creada\n\n${intent.title}`;
    }

    if (intent.action === "create_expense") {
      await createExpense(env.PERSONAL_ASSISTANT_DB, {
        userId,
        amountCents: intent.amountCents,
        currency: intent.currency,
        category: intent.category,
        description: intent.description,
      });
      return `💰 Gasto registrado\n\n${formatExpenseAmount(intent.amountCents, intent.currency)}\nCategoría: ${intent.category}`;
    }

    if (intent.action === "save_note") {
      await createNote(env.PERSONAL_ASSISTANT_DB, {
        userId,
        content: intent.content,
        url: intent.url,
      });
      const savedContent = intent.url && intent.content !== intent.url ? `${intent.content}\n${intent.url}` : intent.content;
      return `🔖 Nota guardada\n\n${savedContent}`;
    }

    await createReminder(env.PERSONAL_ASSISTANT_DB, {
      userId,
      title: intent.title,
      remindAt: intent.remindAt,
    });
    return `⏰ Recordatorio creado\n\n${intent.title}\n${formatReminderAt(intent.remindAt, env.APP_TIMEZONE)}`;
  }

  if (intent.action === "unknown" && intent.reason === "missing_task_title") {
    return "Me falta el título de la tarea. Ejemplo: /tarea comprar medicina";
  }

  if (intent.action === "unknown" && intent.reason === "missing_reminder_time") {
    return "Indica cuándo recordarlo. Ejemplo: /recordar pagar internet mañana a las 18:00";
  }

  if (intent.action === "unknown" && intent.reason === "reminder_time_in_past") {
    return "Esa hora ya pasó. Usa una hora futura o escribe ‘mañana’.";
  }

  if (intent.action === "unknown" && intent.reason === "invalid_expense_amount") {
    return "No pude leer el monto. Ejemplo: /gasto 450 gasolina";
  }

  if (intent.action === "unknown" && intent.reason === "missing_expense_category") {
    return "Indica qué fue el gasto. Ejemplo: /gasto 450 gasolina";
  }

  if (intent.action === "unknown" && intent.reason === "missing_note_content") {
    return "Escribe el contenido de la nota. Ejemplo: /nota recordar renovar seguro";
  }

  if (intent.action === "unknown" && intent.reason === "missing_note_url") {
    return "No encontré el link. Usa una URL http o https, por ejemplo: guardar https://ejemplo.com";
  }

  if (intent.action === "unknown" && intent.reason === "invalid_note_url") {
    return "Solo guardo URLs http o https; no descargo ni ejecuto el contenido.";
  }

  return "Todavía estoy construyendo mis módulos. Por ahora prueba /start, /help o /tarea comprar medicina.";
}

function formatReminderAt(remindAt: string, timezone: string): string {
  const local = getZonedDateTime(new Date(remindAt), timezone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${local.year}-${pad(local.month)}-${pad(local.day)} ${pad(local.hour)}:${pad(local.minute)}`;
}

function formatExpenseAmount(amountCents: number, currency: string): string {
  const major = Math.floor(amountCents / 100).toLocaleString("es-MX");
  const minor = String(amountCents % 100).padStart(2, "0");
  return minor === "00" ? `$${major} ${currency}` : `$${major}.${minor} ${currency}`;
}

function getCommandReply(text: string): string | null {
  const command = text.split(/\s+/, 1)[0].toLowerCase().split("@")[0];

  if (command === "/start") {
    return "👋 Bienvenido a Personal Assistant.\n\nEscribe una tarea, gasto o recordatorio en lenguaje natural.";
  }

  if (command === "/help") {
    return "Puedo ayudarte con tareas, recordatorios, gastos y enlaces.\n\nEjemplos:\n• tarea comprar medicina\n• recuérdame pagar internet mañana\n• gasto 450 gasolina\n• guardar https://ejemplo.com";
  }

  return null;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
