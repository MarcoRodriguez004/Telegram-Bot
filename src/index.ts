import { ensureUser } from "./db/users";
import { interpretMessage } from "./ai/openai";
import { claimUpdate } from "./db/repository";
import { deleteUserData } from "./modules/privacy/repository";
import {
  cancelReminder,
  completeReminder,
  createReminder,
  getReminder,
  listReminders,
  updateReminder,
} from "./modules/reminders/repository";
import type { ReminderListItem } from "./modules/reminders/repository";
import { processDueReminders } from "./modules/reminders/scheduler";
import { createExpense, getExpenseHistory } from "./modules/expenses/repository";
import type { ExpenseHistoryResult } from "./modules/expenses/repository";
import { createNote, getNote, listNotes } from "./modules/notes/repository";
import { saveMedia } from "./modules/notes/media";
import { getSummary } from "./modules/summary/repository";
import type { SummaryResult } from "./modules/summary/repository";
import {
  cancelTask,
  completeTask,
  createTask,
  getTask,
  listTasks,
  updateTaskTitle,
} from "./modules/tasks/repository";
import type { TaskListItem } from "./modules/tasks/repository";
import { clearEditSession, getActiveEditSession, startEditSession } from "./modules/edit-sessions/repository";
import { getSavedNotesContext, saveSavedNotesContext } from "./modules/conversation/repository";
import { parseIntent } from "./router/parser";
import { getSummaryDateRange, getZonedDateTime } from "./shared/dates";
import { hasValidWebhookSecret, isAuthorizedUpdate } from "./telegram/auth";
import { answerCallbackQuery, sendAttachment, sendMessage } from "./telegram/client";
import type { InlineKeyboardMarkup } from "./telegram/client";
import {
  buildEditCancelKeyboard,
  buildFilterKeyboard,
  buildItemKeyboard,
  buildListKeyboard,
  parseCallbackData,
} from "./telegram/keyboards";
import type { QueryFilter, QueryResource } from "./telegram/keyboards";
import { parseTelegramUpdate } from "./telegram/types";
import type { TelegramCallbackQuery, TelegramUpdate } from "./telegram/types";
import type { Env } from "./types";

const MAX_UPDATE_BYTES = 64 * 1024;

type BotReply = {
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
};

type Reply = string | BotReply;

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
  aiFetch: typeof fetch = fetch,
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

    const actorId = update.message?.from?.id ?? update.callback_query?.from.id;
    if (actorId === undefined || !(await claimUpdate(env.PERSONAL_ASSISTANT_DB, update.update_id, actorId))) {
      return new Response(null, { status: 200 });
    }

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, env, telegramFetch);
      await answerCallbackQuery(env, update.callback_query.id, telegramFetch);
      return new Response(null, { status: 200 });
    }

    if (update.message?.photo || update.message?.document) {
      const reply = await saveMedia(update.message, env);
      await sendMessage(env, update.message.chat.id, reply, telegramFetch);
      return new Response(null, { status: 200 });
    }

    const text = update.message?.text?.trim();
    if (!text || !update.message) {
      return new Response(null, { status: 200 });
    }

    let reply: Reply | null;
    if (text.startsWith("/")) {
      reply = await getReply(text, update, env, telegramFetch, aiFetch);
    } else {
      const telegramUserId = update.message.from?.id;
      if (telegramUserId === undefined) return new Response(null, { status: 200 });
      const userId = await ensureUser(env.PERSONAL_ASSISTANT_DB, {
        telegramUserId,
        telegramChatId: update.message.chat.id,
        timezone: env.APP_TIMEZONE,
        currency: env.DEFAULT_CURRENCY,
      });
      const editReply = await handleEditInput(text, userId, update.message.chat.id, env);
      reply = editReply ?? await getReply(text, update, env, telegramFetch, aiFetch);
    }
    if (reply !== null) await sendBotReply(env, update.message.chat.id, reply, telegramFetch);
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Webhook processing failed", error instanceof Error ? error.message : "unknown error");
    return new Response("Internal error", { status: 500 });
  }
}

async function getReply(
  text: string,
  update: TelegramUpdate,
  env: Env,
  telegramFetch: typeof fetch,
  aiFetch: typeof fetch,
): Promise<Reply | null> {
  const commandReply = getCommandReply(text);
  if (commandReply) {
    return commandReply;
  }

  const message = update.message;
  const telegramUserId = message?.from?.id;
  let userId: number | undefined;
  let savedNotesContext = undefined;
  if (message && telegramUserId !== undefined) {
    userId = await ensureUser(env.PERSONAL_ASSISTANT_DB, {
      telegramUserId,
      telegramChatId: message.chat.id,
      timezone: env.APP_TIMEZONE,
      currency: env.DEFAULT_CURRENCY,
    });
    savedNotesContext = await getSavedNotesContext(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: message.chat.id,
    });
  }

  let intent = parseIntent(text, {
    timezone: env.APP_TIMEZONE,
    currency: env.DEFAULT_CURRENCY,
    savedNotesContext: savedNotesContext ?? undefined,
  });
  if (intent.action === "unknown" && intent.reason === "unsupported_message") {
    if (looksLikeDataDeletion(text)) {
      return "Para borrar tus datos escribe exactamente: /borrar_datos CONFIRMAR";
    }

    const aiIntent = await interpretMessage(text, {
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      timezone: env.APP_TIMEZONE,
      currency: env.DEFAULT_CURRENCY,
      fetcher: aiFetch,
    });
    if (aiIntent) intent = aiIntent;
  }

  if (intent.action === "delete_data") {
    const telegramUserId = update.message?.from?.id;
    if (telegramUserId === undefined) {
      return "No pude identificar al usuario de Telegram.";
    }

    await deleteUserData(env.PERSONAL_ASSISTANT_DB, telegramUserId);
    return "🗑️ Tus datos personales fueron eliminados.";
  }

  if (intent.action === "reply") return intent.message;
  if (intent.action === "clarify") return intent.question;

  if (
    intent.action === "summary" ||
    intent.action === "list_tasks" ||
    intent.action === "list_reminders" ||
    intent.action === "list_expenses" ||
    intent.action === "list_notes" ||
    intent.action === "get_note" ||
    intent.action === "create_task" ||
    intent.action === "create_reminder" ||
    intent.action === "create_expense" ||
    intent.action === "save_note"
  ) {
    if (!message || telegramUserId === undefined || userId === undefined) {
      return "No pude identificar al usuario de Telegram.";
    }

    if (intent.action === "list_tasks") {
      if (!intent.filter) {
        return { text: "¿Qué tareas quieres consultar?", replyMarkup: buildFilterKeyboard("task") };
      }
      const result = await listTasks(env.PERSONAL_ASSISTANT_DB, { userId, filter: intent.filter, limit: 10 });
      return formatTaskListReply(result.tasks, result.nextBeforeId, intent.filter, env.APP_TIMEZONE);
    }
    if (intent.action === "list_reminders") {
      if (!intent.filter) {
        return { text: "¿Qué recordatorios quieres consultar?", replyMarkup: buildFilterKeyboard("reminder") };
      }
      const result = await listReminders(env.PERSONAL_ASSISTANT_DB, { userId, filter: intent.filter, limit: 10 });
      return formatReminderListReply(result.reminders, result.nextBeforeId, intent.filter, env.APP_TIMEZONE);
    }
    if (intent.action === "list_notes") {
      const kind = intent.kind ?? "all";
      const { notes, nextBeforeId } = await listNotes(env.PERSONAL_ASSISTANT_DB, userId, intent.beforeId, kind);
      await saveSavedNotesContext(env.PERSONAL_ASSISTANT_DB, {
        userId,
        chatId: message.chat.id,
        kind,
        nextBeforeId,
      });
      if (!notes.length) {
        if (intent.beforeId) return kind === "photos" ? "No hay más imágenes guardadas." : kind === "documents" ? "No hay más documentos guardados." : "No hay más guardados. Volver: /guardados";
        return kind === "photos" ? "No tienes imágenes guardadas. Envía una foto con la descripción «Guarda»." : kind === "documents" ? "No tienes documentos guardados. Envía un documento con la descripción «Guarda»." : "No tienes guardados. Envía una foto o documento con la descripción «Guarda».";
      }
      const lines = notes.map((note) => {
        const kind = note.file_kind === "photo" ? "Foto" : note.file_kind === "document" ? "Documento" : note.url ? "Enlace" : "Nota";
        const preview = note.content.replace(/\s+/g, " ");
        return `/guardado_${note.id} · ${kind} · ${preview.length > 160 ? preview.slice(0, 159) + "…" : preview}`;
      });
      const title = kind === "photos" ? "📷 Imágenes guardadas · más recientes primero" : kind === "documents" ? "📄 Documentos guardados · más recientes primero" : "📎 Mis guardados · más recientes primero";
      return [title, "", ...lines, "", "Toca un comando para ver el guardado.",
        ...(nextBeforeId ? [`Más: /guardados_${nextBeforeId}`] : []),
      ].join("\n");
    }

    if (intent.action === "get_note") {
      const note = await getNote(env.PERSONAL_ASSISTANT_DB, userId, intent.noteId);
      if (!note) return "No encontré ese guardado. Consulta /guardados.";
      if (note.file_kind && note.file_id) {
        try {
          await sendAttachment(env, message.chat.id, { kind: note.file_kind, fileId: note.file_id }, note.content, telegramFetch);
          return null;
        } catch {
          console.error("Saved attachment delivery failed");
          return `No pude enviar el archivo. Sigue guardado; intenta de nuevo con /guardado_${note.id}.`;
        }
      }
      return note.url && note.content !== note.url ? `${note.content}\n${note.url}` : note.content;
    }
    if (intent.action === "summary") {
      const dateRange = getSummaryDateRange(intent.range, new Date(), env.APP_TIMEZONE);
      const summary = await getSummary(env.PERSONAL_ASSISTANT_DB, { userId, ...dateRange });
      return formatSummary(summary, intent.range, env.APP_TIMEZONE, env.DEFAULT_CURRENCY);
    }

    if (intent.action === "list_expenses") {
      const history = await getExpenseHistory(env.PERSONAL_ASSISTANT_DB, { userId, category: intent.category });
      return formatExpenseHistory(history, intent.category, env.APP_TIMEZONE);
    }

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
      const description = intent.description ? `\nDescripción: ${intent.description}` : "";
      return `💰 Gasto registrado\n\n${formatExpenseAmount(intent.amountCents, intent.currency)}\nCategoría: ${intent.category}${description}`;
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

  if (intent.action === "unknown" && intent.reason === "missing_expense_amount") {
    return "Para registrarlo necesito el monto. Ejemplo: gasté 450 en carro por compra de radiador";
  }

  if (intent.action === "unknown" && intent.reason === "expense_description_too_long") {
    return "La descripción del gasto es demasiado larga.";
  }

  if (intent.action === "unknown" && intent.reason === "missing_expense_history_category") {
    return "Dime la categoría. Ejemplo: historial de gastos de carro";
  }

  if (intent.action === "unknown" && intent.reason === "missing_note_content") {
    return "Escribe el contenido de la nota. Ejemplo: /nota recordar renovar seguro";
  }

  if (intent.action === "unknown" && intent.reason === "invalid_saved_id") {
    return "Usa el comando que aparece junto al archivo en /guardados.";
  }

  if (intent.action === "unknown" && intent.reason === "missing_note_url") {
    return "No encontré el link. Usa una URL http o https, por ejemplo: guardar https://ejemplo.com";
  }

  if (intent.action === "unknown" && intent.reason === "invalid_note_url") {
    return "Solo guardo URLs http o https; no descargo ni ejecuto el contenido.";
  }

  if (intent.action === "unknown" && intent.reason === "invalid_summary_range") {
    return "El resumen acepta: hoy, semana o mes. Ejemplo: /resumen semana";
  }

  if (intent.action === "unknown" && intent.reason === "delete_confirmation_required") {
    return "Para borrar tus datos escribe exactamente: /borrar_datos CONFIRMAR";
  }

  return "No entendí ese mensaje. Puedes consultar /guardados o ver ejemplos en /help.";
}

async function sendBotReply(
  env: Env,
  chatId: number,
  reply: Reply,
  telegramFetch: typeof fetch,
): Promise<void> {
  if (typeof reply === "string") {
    await sendMessage(env, chatId, reply, telegramFetch);
    return;
  }
  await sendMessage(env, chatId, reply.text, telegramFetch, { replyMarkup: reply.replyMarkup });
}

async function handleCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  env: Env,
  telegramFetch: typeof fetch,
): Promise<void> {
  const source = callbackQuery.message;
  const action = parseCallbackData(callbackQuery.data);
  if (!source || !action) {
    if (source) await sendMessage(env, source.chat.id, "Esta acción ya no está disponible.", telegramFetch);
    return;
  }

  const userId = await ensureUser(env.PERSONAL_ASSISTANT_DB, {
    telegramUserId: callbackQuery.from.id,
    telegramChatId: source.chat.id,
    timezone: env.APP_TIMEZONE,
    currency: env.DEFAULT_CURRENCY,
  });

  if (action.kind === "edit_cancel") {
    await clearEditSession(env.PERSONAL_ASSISTANT_DB, userId);
    await sendMessage(env, source.chat.id, "Edición cancelada.", telegramFetch);
    return;
  }

  if (action.kind === "filter" || action.kind === "page") {
    const reply = await getListReply(env, userId, action.resource, action.filter, action.kind === "page" ? action.beforeId : undefined);
    await sendBotReply(env, source.chat.id, reply, telegramFetch);
    return;
  }

  if (action.kind === "item") {
    const item = action.resource === "task"
      ? await getTask(env.PERSONAL_ASSISTANT_DB, userId, action.id)
      : await getReminder(env.PERSONAL_ASSISTANT_DB, userId, action.id);
    if (!item) {
      await sendMessage(env, source.chat.id, "No encontré ese elemento o ya no está disponible.", telegramFetch);
      return;
    }
    const reply: BotReply = {
      text: formatItemDetail(action.resource, item, env.APP_TIMEZONE),
      replyMarkup: buildItemKeyboard(action.resource, action.id, item.status, "all"),
    };
    await sendBotReply(env, source.chat.id, reply, telegramFetch);
    return;
  }

  const item = action.resource === "task"
    ? await getTask(env.PERSONAL_ASSISTANT_DB, userId, action.id)
    : await getReminder(env.PERSONAL_ASSISTANT_DB, userId, action.id);
  if (!item) {
    await sendMessage(env, source.chat.id, "No encontré ese elemento o ya no está disponible.", telegramFetch);
    return;
  }

  if (action.action === "edit") {
    if (item.status !== "pending") {
      await sendMessage(env, source.chat.id, "Solo puedes editar elementos pendientes.", telegramFetch);
      return;
    }
    await startEditSession(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: source.chat.id,
      resourceType: action.resource,
      resourceId: action.id,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    const prompt = action.resource === "task"
      ? "✏️ Escribe el nuevo nombre de la tarea."
      : "✏️ Escribe el nuevo nombre y horario del recordatorio.\nEjemplo: renovar póliza mañana a las 18:00";
    await sendBotReply(env, source.chat.id, { text: prompt, replyMarkup: buildEditCancelKeyboard(action.resource) }, telegramFetch);
    return;
  }

  const changed = action.resource === "task"
    ? action.action === "complete"
      ? await completeTask(env.PERSONAL_ASSISTANT_DB, { userId, taskId: action.id })
      : await cancelTask(env.PERSONAL_ASSISTANT_DB, { userId, taskId: action.id })
    : action.action === "complete"
      ? await completeReminder(env.PERSONAL_ASSISTANT_DB, { userId, reminderId: action.id })
      : await cancelReminder(env.PERSONAL_ASSISTANT_DB, { userId, reminderId: action.id });

  if (!changed) {
    await sendMessage(env, source.chat.id, "Ese elemento ya no está pendiente.", telegramFetch);
    return;
  }

  const verb = action.action === "complete"
    ? action.resource === "task" ? "completada" : "completado"
    : action.resource === "task" ? "cancelada" : "cancelado";
  await sendMessage(env, source.chat.id, `✅ ${action.resource === "task" ? "Tarea" : "Recordatorio"} ${verb}.\n\n${item.title}`, telegramFetch);
}

async function handleEditInput(text: string, userId: number, chatId: number, env: Env): Promise<Reply | null> {
  const session = await getActiveEditSession(env.PERSONAL_ASSISTANT_DB, userId);
  if (!session || session.chatId !== chatId) return null;

  if (/^(?:cancelar|cancelar\s+edici[oó]n|salir)$/iu.test(text.trim())) {
    await clearEditSession(env.PERSONAL_ASSISTANT_DB, userId);
    return "Edición cancelada.";
  }

  if (session.resourceType === "task") {
    try {
      const changed = await updateTaskTitle(env.PERSONAL_ASSISTANT_DB, {
        userId,
        taskId: session.resourceId,
        title: text,
      });
      await clearEditSession(env.PERSONAL_ASSISTANT_DB, userId);
      return changed ? `✅ Tarea actualizada\n\n${text.trim().replace(/\s+/g, " ")}` : "La tarea ya no está pendiente o no existe.";
    } catch {
      return "No pude usar ese nombre. Escribe un nombre de tarea de hasta 500 caracteres.";
    }
  }

  const intent = parseIntent(`recordar ${text}`, {
    timezone: env.APP_TIMEZONE,
    currency: env.DEFAULT_CURRENCY,
  });
  if (intent.action !== "create_reminder") {
    return "Indica el nombre y horario. Ejemplo: renovar póliza mañana a las 18:00";
  }

  try {
    const changed = await updateReminder(env.PERSONAL_ASSISTANT_DB, {
      userId,
      reminderId: session.resourceId,
      title: intent.title,
      remindAt: intent.remindAt,
    });
    await clearEditSession(env.PERSONAL_ASSISTANT_DB, userId);
    return changed
      ? `✅ Recordatorio actualizado\n\n${intent.title}\n${formatReminderAt(intent.remindAt, env.APP_TIMEZONE)}`
      : "El recordatorio ya no está pendiente o no existe.";
  } catch {
    return "No pude actualizar el recordatorio. Indica un nombre y una fecha futura válidos.";
  }
}

async function getListReply(
  env: Env,
  userId: number,
  resource: QueryResource,
  filter: QueryFilter,
  beforeId?: number,
): Promise<BotReply> {
  if (resource === "task") {
    const result = await listTasks(env.PERSONAL_ASSISTANT_DB, { userId, filter, beforeId, limit: beforeId ? 20 : 10 });
    return formatTaskListReply(result.tasks, result.nextBeforeId, filter, env.APP_TIMEZONE);
  }
  const result = await listReminders(env.PERSONAL_ASSISTANT_DB, { userId, filter, beforeId, limit: beforeId ? 20 : 10 });
  return formatReminderListReply(result.reminders, result.nextBeforeId, filter, env.APP_TIMEZONE);
}

function formatTaskListReply(
  tasks: TaskListItem[],
  nextBeforeId: number | undefined,
  filter: QueryFilter,
  timezone: string,
): BotReply {
  const label = filterLabel("task", filter);
  const text = tasks.length
    ? [`📋 Tareas · ${label}`, "", ...tasks.map((task) => `${statusBullet(task.status)} ${task.title}\n  ${formatTaskDate(task, timezone)}`)].join("\n")
    : `📋 Tareas · ${label}\n\nNo hay tareas en este estado.`;
  return { text, replyMarkup: tasks.length ? buildListKeyboard("task", tasks, nextBeforeId, filter, timezone) : buildFilterKeyboard("task") };
}

function formatReminderListReply(
  reminders: ReminderListItem[],
  nextBeforeId: number | undefined,
  filter: QueryFilter,
  timezone: string,
): BotReply {
  const label = filterLabel("reminder", filter);
  const text = reminders.length
    ? [`⏰ Recordatorios · ${label}`, "", ...reminders.map((reminder) => `${statusBullet(reminder.status)} ${reminder.title}\n  ${formatDate(reminder.remindAt, timezone)}`)].join("\n")
    : `⏰ Recordatorios · ${label}\n\nNo hay recordatorios en este estado.`;
  return { text, replyMarkup: reminders.length ? buildListKeyboard("reminder", reminders, nextBeforeId, filter, timezone) : buildFilterKeyboard("reminder") };
}

function formatItemDetail(resource: QueryResource, item: TaskListItem | ReminderListItem, timezone: string): string {
  const status = item.status === "pending" ? "Pendiente" : item.status === "completed" ? "Completado" : "Cancelado";
  const date = resource === "task" ? formatTaskDate(item as TaskListItem, timezone) : formatDate((item as ReminderListItem).remindAt, timezone);
  return `${resource === "task" ? "📋 Tarea" : "⏰ Recordatorio"}\n\n${item.title}\nEstado: ${status}\nFecha: ${date}`;
}

function formatTaskDate(task: TaskListItem, timezone: string): string {
  return task.dueAt ? `Vence: ${formatDate(task.dueAt, timezone)}` : `Creada: ${formatDate(task.createdAt, timezone)}`;
}

function formatDate(value: string, timezone: string): string {
  const local = getZonedDateTime(new Date(value), timezone);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${local.year}-${pad(local.month)}-${pad(local.day)} ${pad(local.hour)}:${pad(local.minute)}`;
}

function filterLabel(resource: QueryResource, filter: QueryFilter): string {
  if (resource === "task") return filter === "pending" ? "Pendientes" : filter === "completed" ? "Completadas" : filter === "cancelled" ? "Canceladas" : "Todas";
  return filter === "pending" ? "Pendientes" : filter === "completed" ? "Completados" : filter === "cancelled" ? "Cancelados" : "Todos";
}

function statusBullet(status: "pending" | "completed" | "cancelled"): string {
  return status === "completed" ? "🟢" : status === "cancelled" ? "🔴" : "🟡";
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

function formatSummary(summary: SummaryResult, range: "today" | "week" | "month", timezone: string, currency: string): string {
  const rangeLabel = range === "today" ? "Hoy" : range === "week" ? "Esta semana" : "Este mes";
  const lines = [
    `📋 Resumen · ${rangeLabel}`,
    "",
    `✅ Tareas pendientes: ${summary.pendingTaskCount}`,
    `💰 Gastos: ${formatExpenseAmount(summary.totalExpenseCents, currency)}`,
    "",
    "⏰ Recordatorios",
  ];

  if (summary.upcomingReminders.length === 0) {
    lines.push("Ninguno");
  } else {
    lines.push(...summary.upcomingReminders.map((reminder) => `• ${formatReminderAt(reminder.remindAt, timezone)} · ${reminder.title}`));
  }

  lines.push("", "🔖 Notas recientes");
  if (summary.recentNotes.length === 0) {
    lines.push("Ninguna");
  } else {
    lines.push(...summary.recentNotes.map((note) => `• ${note.content}`));
  }

  return lines.join("\n");
}

function formatExpenseHistory(history: ExpenseHistoryResult, category: string | undefined, timezone: string): string {
  const title = category ? `📊 Historial de gastos · ${category}` : "📊 Historial de gastos";
  const lines = [title, ""];

  if (history.expenses.length === 0) {
    lines.push(category ? `No encontré gastos en “${category}”.` : "No encontré gastos registrados.");
    return lines.join("\n");
  }

  lines.push("Totales:");
  lines.push(...history.totals.map((total) => `• ${formatExpenseAmount(total.totalCents, total.currency)}`));
  lines.push("", "Últimos gastos:");
  lines.push(
    ...history.expenses.map((expense) => {
      const local = getZonedDateTime(new Date(expense.occurredAt), timezone);
      const date = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
      const detail = expense.description ? ` · ${expense.description}` : "";
      return `• ${date} · ${formatExpenseAmount(expense.amountCents, expense.currency)}${detail}`;
    }),
  );
  return lines.join("\n");
}

function getCommandReply(text: string): string | null {
  const command = text.split(/\s+/, 1)[0].toLowerCase().split("@")[0];

  if (command === "/start") {
    return "👋 Bienvenido a Personal Assistant.\n\nEscribe una tarea, gasto o recordatorio en lenguaje natural. También puedes enviar una foto o documento con la descripción «Guarda» y consultar /guardados.";
  }

  if (command === "/help") {
    return "Puedo ayudarte con tareas, recordatorios, gastos, notas, enlaces y archivos.\n\nEjemplos:\n• tarea comprar medicina\n• recuérdame pagar internet mañana\n• quiero que me recuerdes a las 2pm tomarme mi medicamento\n• gasté 450 en carro por compra de radiador\n• historial de gastos de carro\n• guardar https://ejemplo.com\n• nota póliza pendiente\n• Envía una foto o documento con la descripción «Guarda recibo de luz» (uno por mensaje).\n• mis guardados o /guardados\n• /guardado_123 para recibir un guardado de la lista";
  }

  return null;
}

function looksLikeDataDeletion(text: string): boolean {
  return /\b(?:borr(?:a|ar)|elimin(?:a|ar))\b[\s\S]*\b(?:datos|todo|informaci[oó]n|tareas?|gastos?|notas?|recordatorios?)\b/iu.test(text);
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
