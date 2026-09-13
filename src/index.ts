import { ensureUser } from "./db/users";
import { interpretMessage } from "./ai/openai";
import { claimUpdate } from "./db/repository";
import { deleteUserData } from "./modules/privacy/repository";
import {
  advanceGlobalResetConfirmation,
  clearGlobalResetConfirmation,
  deleteAllData,
  getGlobalResetConfirmation,
  startGlobalResetConfirmation,
} from "./modules/privacy/global-reset";
import {
  cancelReminder,
  completeReminder,
  createReminder,
  getReminder,
  listReminders,
  setReminderRecurrence,
  updateReminder,
} from "./modules/reminders/repository";
import type { ReminderListItem } from "./modules/reminders/repository";
import { processDueReminders } from "./modules/reminders/scheduler";
import { processDueNotifications } from "./modules/notifications/scheduler";
import { monitorDatabaseStorage } from "./modules/storage/monitor";
import { formatCombinedContingencyCheck, monitorContingency } from "./modules/contingency/monitor";
import { fetchCombinedContingencyBulletin } from "./modules/contingency/combined";
import {
  advanceBroadcastConfirmation,
  clearBroadcastConfirmation,
  getBroadcastConfirmation,
  listBroadcastDestinations,
  startBroadcastConfirmation,
  validateBroadcastMessage,
} from "./modules/broadcast/repository";
import {
  getContingencyPreferences,
  listVehicles,
  registerVehicle,
  removeVehicle,
  setContingencyMode,
} from "./modules/contingency/repository";
import type { ContingencyMode } from "./modules/contingency/repository";
import { reportOperationalFailure } from "./modules/operations/alerts";
import {
  disablePersistentNotification,
  initializePersistentNotification,
  getPersistentNotification,
  reschedulePersistentNotification,
  scheduleNotificationSnooze,
  setNotificationDefaults,
  setPersistentNotification,
} from "./modules/notifications/repository";
import type { NotificationIntervalMinutes, NotificationScope } from "./modules/notifications/repository";
import { createExpense, getExpenseHistory } from "./modules/expenses/repository";
import type { ExpenseHistoryResult } from "./modules/expenses/repository";
import {
  createFolder,
  createNote,
  deleteNote,
  deleteFolder,
  findSimilarFolder,
  getFolderById,
  getFolderByName,
  getNote,
  listEmptyFolders,
  listFolders,
  listNotes,
  moveNoteToFolder,
  renameFolder,
  updateNote,
} from "./modules/notes/repository";
import type { SavedNote, SavedNoteKind } from "./modules/notes/repository";
import { saveMedia } from "./modules/notes/media";
import { getSummary } from "./modules/summary/repository";
import type { SummaryResult } from "./modules/summary/repository";
import { exportUserData } from "./modules/export/repository";
import { importUserData } from "./modules/export/import";
import { getBotStatus, searchUserDataPage } from "./modules/status/repository";
import {
  cancelTask,
  completeTask,
  createTask,
  getTask,
  listTasks,
  setTaskRecurrence,
  updateTask,
} from "./modules/tasks/repository";
import type { TaskListItem } from "./modules/tasks/repository";
import { clearEditSession, getActiveEditSession, startEditSession } from "./modules/edit-sessions/repository";
import {
  clearConversationDraft,
  clearPendingConfirmation,
  clearPendingFolderSave,
  clearPendingListContext,
  getConversationDraft,
  getPendingConfirmation,
  getPendingFolderSave,
  getPendingListContext,
  getSavedNotesContext,
  savePendingConfirmation,
  savePendingFolderSave,
  savePendingListContext,
  saveConversationDraft,
  saveSavedNotesContext,
} from "./modules/conversation/repository";
import type {
  ConversationDraft,
  PendingConfirmationContext,
  PendingListContext,
} from "./modules/conversation/repository";
import {
  getConversationHistory,
  saveConversationTurn,
} from "./modules/conversation/history";
import type { ConversationTurn } from "./modules/conversation/history";
import { buildFolderConflictReply } from "./modules/notes/folder-conflict";
import { parseIntent } from "./router/parser";
import type { Intent } from "./router/intent";
import { getSummaryDateRange, getZonedDateTime } from "./shared/dates";
import { hasValidWebhookSecret, isAuthorizedUpdate } from "./telegram/auth";
import { answerCallbackQuery, downloadTelegramDocument, sendAttachment, sendDocumentContent, sendMessage, setMyCommands } from "./telegram/client";
import type { InlineKeyboardMarkup } from "./telegram/client";
import {
  buildEditCancelKeyboard,
  buildFilterKeyboard,
  buildFolderKeyboard,
  buildFolderPageKeyboard,
  buildItemKeyboard,
  buildListKeyboard,
  buildGlobalNotificationIntervalKeyboard,
  buildConfigurationKeyboard,
  buildNotificationChoiceKeyboard,
  buildContingencyModeKeyboard,
  buildContingencyVehiclesKeyboard,
  buildSavedNoteActionKeyboard,
  buildSavedNoteDeleteKeyboard,
  buildSavedNoteEditCancelKeyboard,
  buildSavedNoteMoveKeyboard,
  buildSavedNoteKeyboard,
  buildStopConfirmationKeyboard,
  parseCallbackData,
} from "./telegram/keyboards";
import type { QueryFilter, QueryResource, SavedFolderKind } from "./telegram/keyboards";
import { parseTelegramUpdate } from "./telegram/types";
import type { TelegramCallbackQuery, TelegramUpdate } from "./telegram/types";
import type { Env } from "./types";
import type { RecurrenceRule } from "./modules/recurrence";

const MAX_UPDATE_BYTES = 64 * 1024;

const TELEGRAM_COMMANDS = [
  { command: "start", description: "Iniciar el bot" },
  { command: "help", description: "Ver ayuda y ejemplos" },
  { command: "comandos", description: "Ver todos los comandos y ejemplos" },
  { command: "tarea", description: "Crear una tarea" },
  { command: "recordar", description: "Crear un recordatorio" },
  { command: "estado", description: "Ver tu estado" },
  { command: "resumen", description: "Ver un resumen" },
  { command: "buscar", description: "Buscar en tus datos" },
  { command: "guardados", description: "Ver fotos, archivos y enlaces" },
  { command: "configuraciones", description: "Configurar avisos y alertas" },
  { command: "configuracion", description: "Configurar avisos" },
  { command: "contingencia", description: "Configurar avisos de contingencia" },
  { command: "hoy_no_circula", description: "Consultar alertas actuales de CAMe" },
  { command: "difundir", description: "Enviar un aviso a todos los chats conocidos (administrador)" },
  { command: "difundir_estado", description: "Difundir el estado actual de CAMe (administrador)" },
  { command: "vehiculo", description: "Registrar un vehículo" },
  { command: "vehiculos", description: "Ver tus vehículos" },
  { command: "exportar", description: "Exportar tus datos" },
  { command: "importar", description: "Restaurar un JSON exportado" },
] as const;

const COMMAND_GUIDE = [
  { command: "/start", description: "Inicia el bot y activa el menú de Telegram.", example: "/start", natural: "Hola, quiero empezar" },
  { command: "/help", description: "Muestra una ayuda breve con ejemplos.", example: "/help", natural: "¿Cómo puedes ayudarme?" },
  { command: "/comandos", description: "Muestra este catálogo completo.", example: "/comandos", natural: "¿Qué comandos hay?" },
  { command: "/tarea <texto>", description: "Crea una tarea, opcionalmente con fecha y hora.", example: "/tarea pagar la luz mañana a las 18:00", natural: "Necesito una tarea para pagar la luz mañana a las 18:00" },
  { command: "/recordar <cuándo> <texto>", description: "Crea un recordatorio para una fecha u hora.", example: "/recordar mañana a las 09:00 llamar al banco", natural: "Recuérdame llamar al banco mañana a las 9" },
  { command: "/tareas [estado]", description: "Lista tus tareas pendientes, completadas, canceladas o todas.", example: "/tareas pendientes", natural: "Muéstrame mis tareas pendientes" },
  { command: "/recordatorios [estado]", description: "Lista tus recordatorios por estado.", example: "/recordatorios todos", natural: "¿Qué recordatorios tengo?" },
  { command: "/estado", description: "Muestra pendientes, avisos y almacenamiento lógico.", example: "/estado", natural: "¿Cómo va mi organización?" },
  { command: "/resumen [hoy|semana|mes]", description: "Resume tu actividad y tus guardados.", example: "/resumen semana", natural: "Dame un resumen de esta semana" },
  { command: "/buscar <texto>", description: "Busca coincidencias entre tus datos.", example: "/buscar tornillos", natural: "Busca tornillos entre mis datos" },
  { command: "/gasto <monto> <categoría>", description: "Registra un gasto.", example: "/gasto 450 gasolina", natural: "Gasté 450 en gasolina" },
  { command: "/nota <texto>", description: "Guarda una nota o un enlace.", example: "/nota renovar póliza en diciembre", natural: "Anota que debo renovar la póliza en diciembre" },
  { command: "/guardar <enlace>", description: "Guarda un enlace; las fotos y documentos se envían con la descripción «Guarda».", example: "/guardar https://ejemplo.com", natural: "Guarda este enlace https://ejemplo.com" },
  { command: "/guardados", description: "Muestra tus fotos, archivos, enlaces y notas guardados.", example: "/guardados", natural: "Muéstrame mis fotos" },
  { command: "/guardado_<id>", description: "Abre un guardado específico.", example: "/guardado_123", natural: "Abre el guardado 123" },
  { command: "/configuraciones", description: "Configura avisos persistentes y alertas CAMe.", example: "/configuraciones", natural: "Quiero configurar mis avisos y alertas" },
  { command: "/contingencia", description: "Configura avisos de Fase I y vehículos registrados.", example: "/contingencia", natural: "Avísame solo si la contingencia afecta a mi coche" },
  { command: "/hoy_no_circula", description: "Consulta el boletín actual de CAMe aunque ya se haya enviado una alerta.", example: "/hoy_no_circula", natural: "Revisa en CAMe si hay alertas" },
  { command: "/difundir <mensaje>", description: "Prepara un aviso para todos los chats conocidos; solo administrador y requiere tres confirmaciones.", example: "/difundir Mantenimiento a las 22:00", natural: "Envía este aviso a todos" },
  { command: "/difundir_estado", description: "Prepara una difusión del estado actual de CAMe; solo administrador y requiere tres confirmaciones.", example: "/difundir_estado", natural: "Difunde el estado actual de contingencia" },
  { command: "/vehiculo <nombre> holograma <0|00> y placa terminada en <dígito>", description: "Registra un vehículo usando solo el último dígito de la placa.", example: "/vehiculo familiar holograma 0 y placa terminada en 6", natural: "Registra mi vehículo, holograma 0 y placa terminada en 6" },
  { command: "/vehiculos", description: "Lista tus vehículos registrados.", example: "/vehiculos", natural: "¿Qué vehículos tengo?" },
  { command: "/repite ...", description: "Configura una repetición diaria, semanal o mensual.", example: "/repite tarea 1 cada semana", natural: "Repite la tarea 1 cada semana" },
  { command: "/exportar", description: "Envía una copia JSON de tus datos.", example: "/exportar", natural: "Quiero una copia de mis datos" },
  { command: "/importar", description: "Indica cómo restaurar un JSON exportado; el archivo se envía como documento con esta descripción.", example: "/importar", natural: "Quiero restaurar una copia de mis datos" },
  { command: "/borrar_datos CONFIRMAR", description: "Elimina tus datos personales después de escribir la confirmación exacta.", example: "/borrar_datos CONFIRMAR", natural: "Quiero borrar mis datos" },
  { command: "/borrar_bd", description: "Inicia el borrado de toda la base de datos; solo administrador y requiere tres confirmaciones.", example: "/borrar_bd", natural: "Necesito iniciar el borrado global con el comando exacto" },
  { command: "/health", description: "Comprueba el estado de producción; solo administrador.", example: "/health", natural: "¿Está funcionando el bot?" },
] as const;

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
    const now = new Date(controller.scheduledTime);
    const db = env.PERSONAL_ASSISTANT_DB;
    try {
      await processDueReminders(db, env, now);
    } catch (error) {
      await reportOperationalFailure(db, env, { component: "scheduler", operation: "scheduled_reminders", detail: "runtime_failure", now });
    }
    try {
      await processDueNotifications(db, env, now);
    } catch (error) {
      await reportOperationalFailure(db, env, { component: "scheduler", operation: "scheduled_notifications", detail: "runtime_failure", now });
    }
    try {
      await monitorDatabaseStorage(db, env, now);
    } catch (error) {
      await reportOperationalFailure(db, env, { component: "storage", operation: "database_monitor", detail: "runtime_failure", now });
    }
    try {
      await monitorContingency(db, env, now);
    } catch (error) {
      await reportOperationalFailure(db, env, { component: "scheduler", operation: "contingency_monitor", detail: "runtime_failure", now });
    }
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

    if (!isAuthorizedUpdate(update)) {
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
      const reply = update.message.document && isImportCaption(update.message.caption)
        ? await restoreTelegramDocument(update.message, env, telegramFetch)
        : await saveMedia(update.message, env);
      await sendBotReply(env, update.message.chat.id, reply, telegramFetch);
      return new Response(null, { status: 200 });
    }

    const text = update.message?.text?.trim();
    if (!text || !update.message) {
      return new Response(null, { status: 200 });
    }

    const telegramUserId = update.message.from?.id;
    if (telegramUserId === undefined) return new Response(null, { status: 200 });
    const userId = await ensureUser(env.PERSONAL_ASSISTANT_DB, {
      telegramUserId,
      telegramChatId: update.message.chat.id,
      timezone: env.APP_TIMEZONE,
      currency: env.DEFAULT_CURRENCY,
    });
    const conversationHistory = await getConversationHistory(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: update.message.chat.id,
    });

    let reply: Reply | null;
    if (text.startsWith("/")) {
      reply = await getReply(text, update, env, telegramFetch, aiFetch, conversationHistory);
    } else {
      const editReply = await handleEditInput(text, userId, update.message.chat.id, env);
      reply = editReply ?? await getReply(text, update, env, telegramFetch, aiFetch, conversationHistory);
    }
    if (reply !== null) await sendBotReply(env, update.message.chat.id, reply, telegramFetch);
    const userStillExists = await env.PERSONAL_ASSISTANT_DB.prepare(
      "SELECT id FROM users WHERE id = ?",
    ).bind(userId).first<{ id: number }>();
    if (!text.startsWith("/") && userStillExists) {
      await saveConversationTurn(env.PERSONAL_ASSISTANT_DB, {
        userId,
        chatId: update.message.chat.id,
        role: "user",
        content: text,
      });
      const assistantText = typeof reply === "string" ? reply : reply?.text;
      if (assistantText) {
        await saveConversationTurn(env.PERSONAL_ASSISTANT_DB, {
          userId,
          chatId: update.message.chat.id,
          role: "assistant",
          content: assistantText,
        });
      }
    }
    if (getCommandToken(text) === "/start") await configureTelegramCommands(env, telegramFetch);
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Webhook processing failed", error instanceof Error ? error.message : "unknown error");
    await reportOperationalFailure(env.PERSONAL_ASSISTANT_DB, env, {
      component: "webhook",
      operation: "update_processing",
      detail: "runtime_failure",
    }, telegramFetch);
    return new Response("Internal error", { status: 500 });
  }
}

async function getReply(
  text: string,
  update: TelegramUpdate,
  env: Env,
  telegramFetch: typeof fetch,
  aiFetch: typeof fetch,
  conversationHistory: ReadonlyArray<ConversationTurn> = [],
): Promise<Reply | null> {
  const globalResetAction = parseGlobalResetAction(text);
  if (globalResetAction) return handleGlobalResetAction(globalResetAction, update, env);

  if (getCommandToken(text) === "/health") return getTelegramHealthReply(update, env);

  const broadcastAction = parseBroadcastAction(text);
  if (broadcastAction) return handleBroadcastAction(broadcastAction, update, env, telegramFetch);

  if (isNaturalCommandsRequest(text)) return formatCommandsGuide();

  const commandReply = getCommandReply(text);
  if (commandReply) return commandReply;

  const message = update.message;
  const telegramUserId = message?.from?.id;
  let userId: number | undefined;
  let savedNotesContext = undefined;
  let pendingListContext: PendingListContext | null = null;
  let pendingConfirmation: PendingConfirmationContext | null = null;
  let conversationDraft: ConversationDraft | null = null;
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
    pendingListContext = await getPendingListContext(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: message.chat.id,
    });
    pendingConfirmation = await getPendingConfirmation(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: message.chat.id,
    });
    conversationDraft = await getConversationDraft(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: message.chat.id,
    });
  }

  const pendingConfirmationResolution = pendingConfirmation
    ? resolvePendingConfirmationResponse(text, pendingConfirmation)
    : null;
  if (pendingConfirmation && userId !== undefined) {
    await clearPendingConfirmation(env.PERSONAL_ASSISTANT_DB, userId);
  }
  if (pendingConfirmationResolution?.kind === "reply") return pendingConfirmationResolution.text;

  const pendingResolution = pendingListContext
    ? resolvePendingListResponse(text, pendingListContext)
    : null;
  if (pendingListContext && userId !== undefined) {
    await clearPendingListContext(env.PERSONAL_ASSISTANT_DB, userId);
  }
  if (pendingResolution?.kind === "reply") return pendingResolution.text;

  const parseOptions = {
    timezone: env.APP_TIMEZONE,
    currency: env.DEFAULT_CURRENCY,
    savedNotesContext: savedNotesContext ?? undefined,
  };
  const directIntent = parseIntent(text, parseOptions);
  let conversationText = text;
  let conversationDraftConsumed = false;
  let draftIntent: Intent | null = null;
  if (conversationDraft) {
    if (/^(?:cancelar|salir|ahora no)$/iu.test(text.trim())) {
      await clearConversationDraft(env.PERSONAL_ASSISTANT_DB, userId!);
      return "Entendido. Cancelé esa captura.";
    }
    if (isAffirmativeResponse(text.trim()) || isNegativeResponse(text.trim())) {
      return conversationDraftPrompt(conversationDraft);
    }
    if (directIntent.action === "unknown") {
      conversationText = mergeConversationDraft(conversationDraft, text);
      draftIntent = parseIntent(conversationText, parseOptions);
      if (draftIntent.action !== "unknown") {
        conversationDraftConsumed = true;
      }
    } else {
      conversationDraftConsumed = true;
    }
  }

  if (conversationDraftConsumed && userId !== undefined) {
    await clearConversationDraft(env.PERSONAL_ASSISTANT_DB, userId);
  }

  const clarificationText = pendingConfirmationResolution?.kind === "intent"
    ? pendingConfirmationResolution.suggestedText
    : text;
  let intent = pendingConfirmationResolution?.kind === "intent"
    ? parseIntent(clarificationText, parseOptions)
    : pendingResolution?.kind === "intent"
      ? pendingResolution.intent
      : draftIntent ?? directIntent;
  const resolvedText = conversationDraft && conversationText !== text ? conversationText : clarificationText;
  if (draftIntent && conversationDraftConsumed) {
    intent = draftIntent;
  }
  if (intent.action === "unknown" && intent.reason === "unsupported_message") {
    if (looksLikeDataDeletion(text)) {
      return "Para borrar tus datos escribe exactamente: /borrar_datos CONFIRMAR";
    }

    const aiIntent = await interpretMessage(resolvedText, {
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      timezone: env.APP_TIMEZONE,
      currency: env.DEFAULT_CURRENCY,
      conversationHistory,
      fetcher: aiFetch,
      onFailure: (failure) => reportOperationalFailure(env.PERSONAL_ASSISTANT_DB, env, {
        component: "openai",
        operation: "intent_interpretation",
        detail: failure.status ? `http_status_${failure.status}` : failure.kind,
      }, telegramFetch),
    });
    if (aiIntent) intent = aiIntent;
  }

  if (pendingConfirmationResolution?.kind === "intent") {
    intent = applyClarificationDefaults(intent);
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
  if (intent.action === "clarify") {
    if (intent.suggestedText && message && userId !== undefined) {
      await savePendingConfirmation(env.PERSONAL_ASSISTANT_DB, {
        userId,
        chatId: message.chat.id,
        question: intent.question,
        suggestedText: intent.suggestedText,
      });
    }
    return intent.question;
  }

  if (
    intent.action === "summary" ||
    intent.action === "list_tasks" ||
    intent.action === "list_reminders" ||
    intent.action === "list_expenses" ||
    intent.action === "list_notes" ||
    intent.action === "list_folders" ||
    intent.action === "create_folder" ||
    intent.action === "rename_folder" ||
    intent.action === "delete_folder" ||
    intent.action === "move_note" ||
    intent.action === "get_note" ||
    intent.action === "status" ||
    intent.action === "search" ||
    intent.action === "export_data" ||
    intent.action === "register_vehicle" ||
    intent.action === "list_vehicles" ||
    intent.action === "remove_vehicle" ||
    intent.action === "configure_contingency" ||
    intent.action === "show_contingency" ||
    intent.action === "check_contingency" ||
    intent.action === "create_task" ||
    intent.action === "set_recurrence" ||
    intent.action === "create_reminder" ||
    intent.action === "create_expense" ||
    intent.action === "save_note"
  ) {
    if (!message || telegramUserId === undefined || userId === undefined) {
      return "No pude identificar al usuario de Telegram.";
    }

    if (intent.action === "set_recurrence") {
      const item = intent.resource === "task"
        ? await getTask(env.PERSONAL_ASSISTANT_DB, userId, intent.resourceId)
        : await getReminder(env.PERSONAL_ASSISTANT_DB, userId, intent.resourceId);
      if (!item || item.status !== "pending") {
        return "Solo puedes configurar repeticiones en elementos pendientes de tu cuenta.";
      }
      const changed = intent.resource === "task"
        ? await setTaskRecurrence(env.PERSONAL_ASSISTANT_DB, { userId, taskId: intent.resourceId, recurrenceRule: intent.recurrenceRule })
        : await setReminderRecurrence(env.PERSONAL_ASSISTANT_DB, { userId, reminderId: intent.resourceId, recurrenceRule: intent.recurrenceRule });
      if (!changed) return "El elemento ya no está pendiente o no existe.";
      return intent.recurrenceRule
        ? `🔁 Repetición ${recurrenceLabel(intent.recurrenceRule)} configurada para ${intent.resource === "task" ? "la tarea" : "el recordatorio"} ${intent.resourceId}.`
        : `🔁 Repetición desactivada para ${intent.resource === "task" ? "la tarea" : "el recordatorio"} ${intent.resourceId}.`;
    }

    if (intent.action === "status") {
      const status = await getBotStatus(env.PERSONAL_ASSISTANT_DB, { userId });
      return formatBotStatus(status, env.APP_TIMEZONE);
    }

    if (intent.action === "search") {
      try {
        const page = await searchUserDataPage(env.PERSONAL_ASSISTANT_DB, {
          userId,
          query: intent.query,
          kind: intent.kind,
          status: intent.status,
          folderName: intent.folderName,
          from: intent.from,
          to: intent.to,
          page: intent.page,
        });
        return formatSearchResults(page.results, env.APP_TIMEZONE, {
          page: page.page,
          hasMore: page.hasMore,
          nextCommand: buildSearchContinuation(intent, page.page + 1),
        });
      } catch (error) {
        if (error instanceof Error && error.message === "Search query is too long") {
          return "La búsqueda no puede superar 200 caracteres.";
        }
        if (error instanceof Error && error.message.includes("Search date")) {
          return "Usa fechas válidas con formato AAAA-MM-DD y un rango coherente.";
        }
        return "Escribe qué quieres buscar. Ejemplo: /buscar tornillos";
      }
    }

    if (intent.action === "export_data") {
      try {
        const exported = await exportUserData(env.PERSONAL_ASSISTANT_DB, { userId });
        const content = JSON.stringify(exported, null, 2);
        const date = new Date().toISOString().slice(0, 10);
        await sendDocumentContent(env, message.chat.id, `mis-datos-${date}.json`, content, telegramFetch);
        return null;
      } catch (error) {
        console.error(JSON.stringify({ event: "data_export_failed", userId, reason: error instanceof Error ? error.message : "unknown" }));
        return "No pude preparar la exportación. Inténtalo de nuevo más tarde.";
      }
    }

    if (intent.action === "register_vehicle") {
      try {
        const vehicle = await registerVehicle(env.PERSONAL_ASSISTANT_DB, {
          userId,
          label: intent.label,
          hologram: intent.hologram,
          plateLastDigit: intent.plateLastDigit,
        });
        const preferences = await getContingencyPreferences(env.PERSONAL_ASSISTANT_DB, userId);
        return {
          text: `🚗 Vehículo registrado\n\n${vehicle.label}\nHolograma: ${vehicle.hologram}\nÚltimo dígito de placa: ${vehicle.plateLastDigit}\n\n${preferences.enabled ? `Modo actual: ${contingencyModeLabel(preferences.mode)}` : "Las alertas CAMe están apagadas. Elige una configuración si deseas activarlas."}`,
          replyMarkup: buildContingencyModeKeyboard(),
        };
      } catch {
        return "No pude registrar el vehículo. Usa holograma 0 o 00 y un último dígito de placa del 0 al 9.";
      }
    }

    if (intent.action === "list_vehicles") {
      return formatContingencySettingsReply(env.PERSONAL_ASSISTANT_DB, userId);
    }

    if (intent.action === "remove_vehicle") {
      const removed = await removeVehicle(env.PERSONAL_ASSISTANT_DB, { userId, vehicleId: intent.vehicleId });
      return removed ? "✅ Vehículo eliminado de tus alertas CAMe." : "No encontré ese vehículo en tu cuenta.";
    }

    if (intent.action === "configure_contingency") {
      if (intent.mode === "vehicle" && (await listVehicles(env.PERSONAL_ASSISTANT_DB, userId)).length === 0) {
        return { text: "Para avisarte solo cuando afecte a tu vehículo, primero registra uno. Ejemplo:\n\nRegistra mi vehículo, holograma 0 y placa terminada en 6", replyMarkup: buildContingencyModeKeyboard() };
      }
      await setContingencyMode(env.PERSONAL_ASSISTANT_DB, { userId, mode: intent.mode });
      return intent.mode
        ? `✅ Alertas CAMe configuradas: ${contingencyModeLabel(intent.mode)}.`
        : "✅ Alertas CAMe desactivadas.";
    }

    if (intent.action === "show_contingency") {
      return formatContingencySettingsReply(env.PERSONAL_ASSISTANT_DB, userId);
    }

    if (intent.action === "check_contingency") {
      return getContingencyCheckReply();
    }

    if (intent.action === "list_tasks") {
      if (!intent.filter) {
        await savePendingListContext(env.PERSONAL_ASSISTANT_DB, {
          userId,
          chatId: message.chat.id,
          resource: "task",
        });
        return { text: "¿Qué tareas quieres consultar?", replyMarkup: buildFilterKeyboard("task") };
      }
      const result = await listTasks(env.PERSONAL_ASSISTANT_DB, { userId, filter: intent.filter, limit: 10 });
      return formatTaskListReply(result.tasks, result.nextBeforeId, intent.filter, env.APP_TIMEZONE);
    }
    if (intent.action === "list_reminders") {
      if (!intent.filter) {
        await savePendingListContext(env.PERSONAL_ASSISTANT_DB, {
          userId,
          chatId: message.chat.id,
          resource: "reminder",
        });
        return { text: "¿Qué recordatorios quieres consultar?", replyMarkup: buildFilterKeyboard("reminder") };
      }
      const result = await listReminders(env.PERSONAL_ASSISTANT_DB, { userId, filter: intent.filter, limit: 10 });
      return formatReminderListReply(result.reminders, result.nextBeforeId, intent.filter, env.APP_TIMEZONE);
    }
    if (intent.action === "list_notes") {
      const kind = intent.kind ?? "all";
      let folderId = intent.folderId;
      let folderName = intent.folderName;
      if (folderName !== undefined) {
        const folder = await getFolderByName(env.PERSONAL_ASSISTANT_DB, userId, folderName);
        if (!folder) return `No existe la carpeta «${folderName}». Créala con «Crea la carpeta ${folderName}» y vuelve a intentarlo.`;
        folderId = folder.id;
        folderName = folder.name;
      }
      const selectedFolderId = folderId === 0 ? null : folderId;
      let result: Awaited<ReturnType<typeof listNotes>>;
      try {
        result = await listNotes(env.PERSONAL_ASSISTANT_DB, userId, intent.beforeId, kind, selectedFolderId);
      } catch {
        return "Esta carpeta ya no está disponible. Consulta «mis carpetas» para ver las actuales.";
      }
      const { notes, nextBeforeId } = result;
      await saveSavedNotesContext(env.PERSONAL_ASSISTANT_DB, {
        userId,
        chatId: message.chat.id,
        kind,
        folderId: folderId === undefined ? undefined : folderId === null ? 0 : folderId,
        nextBeforeId,
      });
      if (!notes.length) {
        if (intent.beforeId) return savedNotesEmptyPageMessage(kind);
        return savedNotesEmptyMessage(kind);
      }
      return formatSavedNotesReply(notes, nextBeforeId, kind, folderName, folderId === undefined ? undefined : folderId);
    }

    if (intent.action === "list_folders") {
      await saveSavedNotesContext(env.PERSONAL_ASSISTANT_DB, {
        userId,
        chatId: message.chat.id,
        kind: intent.kind ?? "all",
      });
      return getSavedFoldersReply(env.PERSONAL_ASSISTANT_DB, userId, intent.kind);
    }

    if (intent.action === "create_folder") {
      const folder = await createFolder(env.PERSONAL_ASSISTANT_DB, {
        userId,
        name: intent.name,
      });
      return folder.created
        ? `📁 Carpeta creada: ${folder.name}`
        : `📁 La carpeta «${folder.name}» ya existe.`;
    }

    if (intent.action === "rename_folder") {
      try {
        const folder = await renameFolder(env.PERSONAL_ASSISTANT_DB, {
          userId,
          currentName: intent.currentName,
          newName: intent.newName,
        });
        return folder
          ? `📁 Carpeta renombrada: ${intent.currentName} → ${folder.name}`
          : `No existe la carpeta «${intent.currentName}».`;
      } catch (error) {
        if (error instanceof Error && error.message === "Folder name already exists") {
          return `Ya existe una carpeta llamada «${intent.newName}». Elige otro nombre.`;
        }
        return "No pude renombrar la carpeta. Verifica que el nombre sea válido.";
      }
    }

    if (intent.action === "delete_folder") {
      const folder = await getFolderByName(env.PERSONAL_ASSISTANT_DB, userId, intent.name);
      if (!folder) return `No existe la carpeta «${intent.name}».`;
      if (pendingConfirmationResolution?.kind !== "intent") {
        await savePendingConfirmation(env.PERSONAL_ASSISTANT_DB, {
          userId,
          chatId: message.chat.id,
          question: `⚠️ ¿Confirmas eliminar la carpeta «${folder.name}»? Sus guardados no se borrarán; pasarán a «Sin carpeta». Responde «sí» o «no».`,
          suggestedText: text,
        });
        return `⚠️ ¿Confirmas eliminar la carpeta «${folder.name}»? Sus guardados no se borrarán; pasarán a «Sin carpeta». Responde «sí» o «no».`;
      }
      const deleted = await deleteFolder(env.PERSONAL_ASSISTANT_DB, { userId, name: folder.name });
      return deleted
        ? `🗑️ Carpeta eliminada: ${deleted.name}\nSus guardados ahora están en «Sin carpeta».`
        : "La carpeta ya no está disponible.";
    }

    if (intent.action === "move_note") {
      let destinationId: number | null = null;
      let destinationName = "Sin carpeta";
      if (intent.folderName !== null) {
        const folder = await getFolderByName(env.PERSONAL_ASSISTANT_DB, userId, intent.folderName);
        if (!folder) return `No existe la carpeta «${intent.folderName}». Créala con «Crea la carpeta ${intent.folderName}» y vuelve a intentarlo.`;
        destinationId = folder.id;
        destinationName = folder.name;
      }
      try {
        const moved = await moveNoteToFolder(env.PERSONAL_ASSISTANT_DB, {
          userId,
          noteId: intent.noteId,
          folderId: destinationId,
        });
        return moved ? `✅ Guardado movido a ${destinationName}.` : "No pude mover ese guardado.";
      } catch (error) {
        if (error instanceof Error && error.message === "Note not found") {
          return `No encontré el guardado ${intent.noteId} o no pertenece a tu cuenta.`;
        }
        return "No pude mover el guardado. Verifica la carpeta de destino.";
      }
    }

    if (intent.action === "get_note") {
      const note = await getNote(env.PERSONAL_ASSISTANT_DB, userId, intent.noteId);
      if (!note) return "No encontré ese guardado. Consulta /guardados.";
      if (note.file_kind && note.file_id) {
        try {
          await sendAttachment(env, message.chat.id, { kind: note.file_kind, fileId: note.file_id }, note.content, telegramFetch);
          await sendBotReply(env, message.chat.id, {
            text: "Puedes gestionar este guardado:",
            replyMarkup: buildSavedNoteActionKeyboard(note.id, true),
          }, telegramFetch);
          return null;
        } catch {
          console.error("Saved attachment delivery failed");
          return `No pude enviar el archivo. Sigue guardado; intenta de nuevo con /guardado_${note.id}.`;
        }
      }
      return {
        text: formatSavedNoteContent(note),
        replyMarkup: buildSavedNoteActionKeyboard(note.id, true),
      };
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
      const createdAt = new Date().toISOString();
      const taskId = await createTask(env.PERSONAL_ASSISTANT_DB, {
        userId,
        title: intent.title,
        dueAt: intent.dueAt,
        createdAt,
      });
      await initializePersistentNotification(env.PERSONAL_ASSISTANT_DB, {
        userId,
        resourceType: "task",
        resourceId: taskId,
        firstNotifyAt: intent.dueAt ?? null,
        createdAt,
      });
      const due = intent.dueAt ? `\nVence: ${formatDate(intent.dueAt, env.APP_TIMEZONE)}` : "";
      return {
        text: `✅ Tarea creada\n\n${intent.title}${due}\n\n¿Deseas avisos persistentes?`,
        replyMarkup: buildNotificationChoiceKeyboard("task", taskId),
      };
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
      let folderId: number | undefined;
      let folderLabel = "";
      if (intent.folderName !== undefined) {
        let folder = await getFolderByName(env.PERSONAL_ASSISTANT_DB, userId, intent.folderName);
        let folderCreated = false;
        if (!folder) {
          const similar = await findSimilarFolder(env.PERSONAL_ASSISTANT_DB, userId, intent.folderName);
          if (similar) {
            await savePendingFolderSave(env.PERSONAL_ASSISTANT_DB, {
              userId,
              chatId: message.chat.id,
              pending: {
                content: intent.content,
                url: intent.url,
                requestedFolderName: intent.folderName,
                existingFolderId: similar.folder.id,
                existingFolderName: similar.folder.name,
              },
            });
            return buildFolderConflictReply(similar.folder.name, intent.folderName);
          }
          const createdFolder = await createFolder(env.PERSONAL_ASSISTANT_DB, { userId, name: intent.folderName });
          folder = createdFolder;
          folderCreated = createdFolder.created;
        }
        folderId = folder.id;
        folderLabel = `${folderCreated ? `\n📁 Carpeta creada: ${folder.name}` : ""}\nCarpeta: ${folder.name}`;
      }
      await createNote(env.PERSONAL_ASSISTANT_DB, {
        userId,
        content: intent.content,
        url: intent.url,
        folderId,
      });
      await clearPendingFolderSave(env.PERSONAL_ASSISTANT_DB, userId);
      const savedContent = intent.url && intent.content !== intent.url ? `${intent.content}\n${intent.url}` : intent.content;
      return `🔖 Nota guardada${folderLabel}\n\n${savedContent}`;
    }

    const createdAt = new Date().toISOString();
    const reminderId = await createReminder(env.PERSONAL_ASSISTANT_DB, {
      userId,
      title: intent.title,
      remindAt: intent.remindAt,
      createdAt,
    });
    await initializePersistentNotification(env.PERSONAL_ASSISTANT_DB, {
      userId,
      resourceType: "reminder",
      resourceId: reminderId,
      firstNotifyAt: intent.remindAt,
      createdAt,
    });
    return {
      text: `⏰ Recordatorio creado\n\n${intent.title}\n${formatReminderAt(intent.remindAt, env.APP_TIMEZONE)}\n\n¿Deseas avisos persistentes?`,
      replyMarkup: buildNotificationChoiceKeyboard("reminder", reminderId),
    };
  }

  const missingDraft = getConversationDraftSpec(intent);
  if (missingDraft && message && userId !== undefined) {
    await saveConversationDraft(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: message.chat.id,
      ...missingDraft,
      baseText: resolvedText,
    });
  }

  if (intent.action === "unknown" && intent.reason === "missing_task_title") {
    return "Me falta el título de la tarea. Ejemplo: /tarea comprar medicina";
  }

  if (intent.action === "unknown" && intent.reason === "missing_reminder_time") {
    return "Indica cuándo recordarlo. Ejemplo: /recordar pagar internet mañana a las 18:00";
  }

  if (intent.action === "unknown" && intent.reason === "missing_reminder_title") {
    return "Me falta qué quieres que te recuerde. Ejemplo: /recordar pagar internet mañana a las 18:00";
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

  if (intent.action === "unknown" && intent.reason === "missing_folder_name") {
    return "Indica el nombre de la carpeta. Ejemplo: Crea la carpeta Trabajo";
  }

  if (intent.action === "unknown" && intent.reason === "folder_name_too_long") {
    return "El nombre de la carpeta no puede superar 80 caracteres.";
  }

  if (intent.action === "unknown" && intent.reason === "invalid_summary_range") {
    return "El resumen acepta: hoy, semana o mes. Ejemplo: /resumen semana";
  }

  if (intent.action === "unknown" && intent.reason === "missing_search_query") {
    return "Indica qué quieres buscar. Ejemplo: /buscar tornillos";
  }

  if (intent.action === "unknown" && intent.reason === "delete_confirmation_required") {
    return "Para borrar tus datos escribe exactamente: /borrar_datos CONFIRMAR";
  }

  if (intent.action === "unknown" && intent.reason === "invalid_vehicle_details") {
    return "Indica el vehículo así: /vehiculo familiar holograma 0 y placa terminada en 6. Solo guardo el holograma y el último dígito de la placa.";
  }

  if (intent.action === "unknown" && intent.reason === "invalid_vehicle_id") {
    return "Indica el número del vehículo que aparece en /vehiculos.";
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

  if (action.kind === "saved_note_edit_cancel") {
    await clearEditSession(env.PERSONAL_ASSISTANT_DB, userId);
    await sendMessage(env, source.chat.id, "Edición de la nota cancelada.", telegramFetch);
    return;
  }

  if (action.kind === "saved_note_edit") {
    const note = await getNote(env.PERSONAL_ASSISTANT_DB, userId, action.id);
    if (!note) {
      await sendMessage(env, source.chat.id, "No encontré ese guardado o ya no está disponible.", telegramFetch);
      return;
    }
    await startEditSession(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: source.chat.id,
      resourceType: "note",
      resourceId: action.id,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    await sendBotReply(env, source.chat.id, {
      text: `✏️ Escribe el nuevo contenido o descripción del guardado.\n\nContenido actual:\n${formatSavedNoteContent(note)}`,
      replyMarkup: buildSavedNoteEditCancelKeyboard(),
    }, telegramFetch);
    return;
  }

  if (action.kind === "saved_note_move") {
    const note = await getNote(env.PERSONAL_ASSISTANT_DB, userId, action.id);
    if (!note) {
      await sendMessage(env, source.chat.id, "No encontré ese guardado o ya no está disponible.", telegramFetch);
      return;
    }
    const folders = await listFolders(env.PERSONAL_ASSISTANT_DB, userId, "all");
    if (!folders.some((folder) => folder.id === null)) {
      folders.push({ id: null, name: "Sin carpeta", count: 0 });
    }
    await sendBotReply(env, source.chat.id, {
      text: "📁 Elige la carpeta de destino:",
      replyMarkup: buildSavedNoteMoveKeyboard(action.id, folders),
    }, telegramFetch);
    return;
  }

  if (action.kind === "saved_note_move_set") {
    const note = await getNote(env.PERSONAL_ASSISTANT_DB, userId, action.id);
    if (!note) {
      await sendMessage(env, source.chat.id, "No encontré ese guardado o ya no está disponible.", telegramFetch);
      return;
    }
    let destinationName = "Sin carpeta";
    if (action.folderId !== null) {
      const folder = await getFolderById(env.PERSONAL_ASSISTANT_DB, userId, action.folderId);
      if (!folder) {
        await sendMessage(env, source.chat.id, "Esa carpeta ya no está disponible.", telegramFetch);
        return;
      }
      destinationName = folder.name;
    }
    try {
      await moveNoteToFolder(env.PERSONAL_ASSISTANT_DB, {
        userId,
        noteId: action.id,
        folderId: action.folderId,
      });
      await sendMessage(env, source.chat.id, `✅ Guardado movido a «${destinationName}».`, telegramFetch);
    } catch {
      await sendMessage(env, source.chat.id, "No pude mover ese guardado.", telegramFetch);
    }
    return;
  }

  if (action.kind === "saved_note_delete") {
    const note = await getNote(env.PERSONAL_ASSISTANT_DB, userId, action.id);
    if (!note) {
      await sendMessage(env, source.chat.id, "No encontré ese guardado o ya no está disponible.", telegramFetch);
      return;
    }
    await sendBotReply(env, source.chat.id, {
      text: `⚠️ ¿Confirmas eliminar este guardado?\n\n${formatSavedNoteContent(note)}`,
      replyMarkup: buildSavedNoteDeleteKeyboard(action.id),
    }, telegramFetch);
    return;
  }

  if (action.kind === "saved_note_delete_decision") {
    if (!action.confirmed) {
      await sendMessage(env, source.chat.id, "El guardado se conservará.", telegramFetch);
      return;
    }
    const deleted = await deleteNote(env.PERSONAL_ASSISTANT_DB, { userId, noteId: action.id });
    await sendMessage(
      env,
      source.chat.id,
      deleted ? "🗑️ Guardado eliminado." : "Ese guardado ya no está disponible.",
      telegramFetch,
    );
    return;
  }

  if (action.kind === "notification_scope") {
    await sendBotReply(env, source.chat.id, {
      text: `Selecciona el intervalo para ${notificationScopeLabel(action.scope)}. Esto afecta los elementos existentes pendientes y los nuevos.`,
      replyMarkup: buildGlobalNotificationIntervalKeyboard(action.scope),
    }, telegramFetch);
    return;
  }

  if (action.kind === "notification_global_set") {
    await setNotificationDefaults(env.PERSONAL_ASSISTANT_DB, {
      userId,
      scope: action.scope,
      enabled: action.intervalMinutes !== null,
      intervalMinutes: action.intervalMinutes ?? undefined,
    });
    await sendMessage(
      env,
      source.chat.id,
      action.intervalMinutes === null
        ? `Avisos persistentes desactivados para ${notificationScopeLabel(action.scope)}. Para volver a activarlos, elige una tarea o recordatorio, o entra a /configuracion.`
        : `Avisos persistentes activados cada ${action.intervalMinutes} minutos para ${notificationScopeLabel(action.scope)}.`,
      telegramFetch,
    );
    return;
  }

  if (action.kind === "contingency_settings") {
    await sendBotReply(env, source.chat.id, await formatContingencySettingsReply(env.PERSONAL_ASSISTANT_DB, userId), telegramFetch);
    return;
  }

  if (action.kind === "contingency_mode") {
    if (action.mode === "vehicle" && (await listVehicles(env.PERSONAL_ASSISTANT_DB, userId)).length === 0) {
      await sendBotReply(env, source.chat.id, {
        text: "Para avisarte solo cuando afecte a tu vehículo, primero registra uno. Ejemplo:\n\nRegistra mi vehículo, holograma 0 y placa terminada en 6",
        replyMarkup: buildContingencyModeKeyboard(),
      }, telegramFetch);
      return;
    }
    await setContingencyMode(env.PERSONAL_ASSISTANT_DB, { userId, mode: action.mode });
    await sendMessage(
      env,
      source.chat.id,
      action.mode ? `✅ Alertas CAMe configuradas: ${contingencyModeLabel(action.mode)}.` : "✅ Alertas CAMe desactivadas.",
      telegramFetch,
    );
    return;
  }

  if (action.kind === "contingency_remove_vehicle") {
    const removed = await removeVehicle(env.PERSONAL_ASSISTANT_DB, { userId, vehicleId: action.vehicleId });
    if (!removed) {
      await sendMessage(env, source.chat.id, "No encontré ese vehículo o ya estaba eliminado.", telegramFetch);
      return;
    }
    await sendBotReply(env, source.chat.id, await formatContingencySettingsReply(env.PERSONAL_ASSISTANT_DB, userId), telegramFetch);
    return;
  }

  if (action.kind === "folder_conflict") {
    const pending = await getPendingFolderSave(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: source.chat.id,
    });
    if (!pending) {
      await sendMessage(env, source.chat.id, "Esta decisión ya no está disponible. Vuelve a enviar el archivo o la nota.", telegramFetch);
      return;
    }

    let folderCreated = false;
    let folder: { id: number; name: string } | null;
    if (action.decision === "use_existing") {
      folder = await getFolderById(env.PERSONAL_ASSISTANT_DB, userId, pending.existingFolderId);
    } else {
      const createdFolder = await createFolder(env.PERSONAL_ASSISTANT_DB, { userId, name: pending.requestedFolderName });
      folder = createdFolder;
      folderCreated = createdFolder.created;
    }
    if (!folder) {
      await clearPendingFolderSave(env.PERSONAL_ASSISTANT_DB, userId);
      await sendMessage(env, source.chat.id, "La carpeta existente ya no está disponible. Vuelve a enviar la nota o el archivo.", telegramFetch);
      return;
    }
    try {
      const noteId = await createNote(env.PERSONAL_ASSISTANT_DB, {
        userId,
        content: pending.content,
        url: pending.url,
        folderId: folder.id,
        attachment: pending.attachment,
      });
      await clearPendingFolderSave(env.PERSONAL_ASSISTANT_DB, userId);
      const folderLabel = `${folderCreated ? `\n📁 Carpeta creada: ${folder.name}` : ""}\nCarpeta: ${folder.name}`;
      if (pending.attachment) {
        const label = pending.attachment.kind === "photo" ? "Foto guardada" : "Documento guardado";
        await sendMessage(env, source.chat.id, `📎 ${label}${folderLabel}\n\n${pending.content}\n\nVer: /guardado_${noteId}\nLista: /guardados`, telegramFetch);
      } else {
        const savedContent = pending.url && pending.content !== pending.url ? `${pending.content}\n${pending.url}` : pending.content;
        await sendMessage(env, source.chat.id, `🔖 Nota guardada${folderLabel}\n\n${savedContent}`, telegramFetch);
      }
    } catch {
      await sendMessage(env, source.chat.id, "No pude guardar el elemento. Vuelve a enviarlo para intentarlo de nuevo.", telegramFetch);
    }
    return;
  }

  if (action.kind === "saved_note") {
    const note = await getNote(env.PERSONAL_ASSISTANT_DB, userId, action.id);
    if (!note) {
      await sendMessage(env, source.chat.id, "No encontré ese guardado o ya no está disponible.", telegramFetch);
      return;
    }
    if (note.file_kind && note.file_id) {
      try {
        await sendAttachment(env, source.chat.id, { kind: note.file_kind, fileId: note.file_id }, note.content, telegramFetch);
        await sendBotReply(env, source.chat.id, {
          text: "Puedes gestionar este guardado:",
            replyMarkup: buildSavedNoteActionKeyboard(note.id, true),
        }, telegramFetch);
      } catch {
        await sendMessage(env, source.chat.id, `No pude enviar el archivo. Sigue guardado; intenta de nuevo con /guardado_${note.id}.`, telegramFetch);
      }
      return;
    }
    await sendBotReply(env, source.chat.id, {
      text: formatSavedNoteContent(note),
      replyMarkup: buildSavedNoteActionKeyboard(note.id, true),
    }, telegramFetch);
    return;
  }

  if (action.kind === "folder_item" || action.kind === "folder_page") {
    const folderId = action.folderId;
    const repositoryFolderId = folderId === null ? null : folderId;
    const beforeId = action.kind === "folder_page" ? action.beforeId : undefined;
    let result: Awaited<ReturnType<typeof listNotes>>;
    try {
      result = await listNotes(env.PERSONAL_ASSISTANT_DB, userId, beforeId, action.noteKind, repositoryFolderId);
    } catch {
      await sendMessage(env, source.chat.id, "Esta carpeta ya no está disponible.", telegramFetch);
      return;
    }
    await saveSavedNotesContext(env.PERSONAL_ASSISTANT_DB, {
      userId,
      chatId: source.chat.id,
      kind: action.noteKind,
      folderId: folderId === null ? 0 : folderId,
      nextBeforeId: result.nextBeforeId,
    });
    if (!result.notes.length) {
      await sendMessage(env, source.chat.id, beforeId ? savedNotesEmptyPageMessage(action.noteKind) : savedNotesEmptyMessage(action.noteKind), telegramFetch);
      return;
    }
    await sendBotReply(
      env,
      source.chat.id,
      formatSavedNotesReply(result.notes, result.nextBeforeId, action.noteKind, undefined, folderId === null ? 0 : folderId),
      telegramFetch,
    );
    return;
  }

  if (action.kind === "filter" || action.kind === "page") {
    await clearPendingListContext(env.PERSONAL_ASSISTANT_DB, userId);
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

  if (action.kind === "notification_set") {
    if (item.status !== "pending") {
      await sendMessage(env, source.chat.id, "Solo puedes configurar avisos de elementos pendientes.", telegramFetch);
      return;
    }
    const now = new Date();
    const nextNotifyAt = action.intervalMinutes === null
      ? undefined
      : getFirstNotificationAt(action.resource, item, action.intervalMinutes, now);
    await setPersistentNotification(env.PERSONAL_ASSISTANT_DB, {
      userId,
      resourceType: action.resource,
      resourceId: action.id,
      intervalMinutes: action.intervalMinutes,
      nextNotifyAt,
      now: now.toISOString(),
    });
    await sendMessage(
      env,
      source.chat.id,
      action.intervalMinutes === null
        ? "Avisos persistentes desactivados. El elemento sigue pendiente."
        : `Avisos persistentes configurados cada ${action.intervalMinutes} minutos.`,
      telegramFetch,
    );
    return;
  }

  if (action.kind === "snooze_set") {
    try {
      await scheduleNotificationSnooze(env.PERSONAL_ASSISTANT_DB, {
        userId,
        resourceType: action.resource,
        resourceId: action.id,
        delayMinutes: action.delayMinutes,
      });
      await sendMessage(
        env,
        source.chat.id,
        `⏱ Te recordaré una vez más en ${action.delayMinutes} minutos. No activé avisos persistentes.`,
        telegramFetch,
      );
    } catch {
      await sendMessage(env, source.chat.id, "Ese aviso ya no está disponible para posponer.", telegramFetch);
    }
    return;
  }

  if (action.kind === "action" && action.action === "notify") {
    if (item.status !== "pending") {
      await sendMessage(env, source.chat.id, "Solo puedes configurar avisos de elementos pendientes.", telegramFetch);
      return;
    }
    await sendBotReply(env, source.chat.id, {
      text: "Selecciona cada cuánto quieres recibir avisos persistentes.",
      replyMarkup: buildNotificationChoiceKeyboard(action.resource, action.id),
    }, telegramFetch);
    return;
  }

  if (action.kind === "action" && action.action === "notify_stop") {
    if (item.status !== "pending") {
      await sendMessage(env, source.chat.id, "Ese elemento ya no está pendiente.", telegramFetch);
      return;
    }
    await disablePersistentNotification(env.PERSONAL_ASSISTANT_DB, userId, action.resource, action.id);
    const label = action.resource === "task" ? "la tarea" : "el recordatorio";
    await sendBotReply(env, source.chat.id, {
      text: `Avisos detenidos definitivamente para ${label}. ¿Se completó?`,
      replyMarkup: buildStopConfirmationKeyboard(action.resource, action.id),
    }, telegramFetch);
    return;
  }

  if (action.kind === "action" && action.action === "complete_after_stop") {
    const changed = action.resource === "task"
      ? await completeTask(env.PERSONAL_ASSISTANT_DB, { userId, taskId: action.id, timeZone: env.APP_TIMEZONE })
      : await completeReminder(env.PERSONAL_ASSISTANT_DB, { userId, reminderId: action.id, timeZone: env.APP_TIMEZONE });
    if (changed) {
      await sendMessage(env, source.chat.id, "✅ Marcado como completado. No volveré a avisar.", telegramFetch);
    } else {
      await sendMessage(env, source.chat.id, "Ese elemento ya no está pendiente.", telegramFetch);
    }
    return;
  }

  if (action.kind === "action" && action.action === "leave_pending_after_stop") {
    await sendMessage(env, source.chat.id, "Queda pendiente y no volveré a enviar avisos.", telegramFetch);
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
      ? await completeTask(env.PERSONAL_ASSISTANT_DB, { userId, taskId: action.id, timeZone: env.APP_TIMEZONE })
      : await cancelTask(env.PERSONAL_ASSISTANT_DB, { userId, taskId: action.id })
    : action.action === "complete"
      ? await completeReminder(env.PERSONAL_ASSISTANT_DB, { userId, reminderId: action.id, timeZone: env.APP_TIMEZONE })
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

  if (session.resourceType === "note") {
    const intent = parseIntent(`nota ${text}`, {
      timezone: env.APP_TIMEZONE,
      currency: env.DEFAULT_CURRENCY,
    });
    if (intent.action !== "save_note") {
      return "Escribe el nuevo contenido de la nota. Puede ser texto o un enlace http(s).";
    }
    try {
      const changed = await updateNote(env.PERSONAL_ASSISTANT_DB, {
        userId,
        noteId: session.resourceId,
        content: intent.content,
        url: intent.url ?? null,
      });
      await clearEditSession(env.PERSONAL_ASSISTANT_DB, userId);
      if (!changed) return "La nota ya no está disponible.";
      const updated = await getNote(env.PERSONAL_ASSISTANT_DB, userId, session.resourceId);
      return updated ? `✅ Nota actualizada\n\n${formatSavedNoteContent(updated)}` : "✅ Nota actualizada.";
    } catch {
      return "No pude actualizar la nota. Usa un contenido de hasta 1,000 caracteres y enlaces http(s).";
    }
  }

  if (session.resourceType === "task") {
    const intent = parseIntent(`tarea ${text}`, {
      timezone: env.APP_TIMEZONE,
      currency: env.DEFAULT_CURRENCY,
    });
    if (intent.action !== "create_task") {
      return "Indica el nuevo nombre y, si quieres cambiarla, una fecha. Ejemplo: comprar medicina mañana a las 18:00";
    }
    try {
      const changed = await updateTask(env.PERSONAL_ASSISTANT_DB, {
        userId,
        taskId: session.resourceId,
        title: intent.title,
        ...(intent.dueAt === undefined ? {} : { dueAt: intent.dueAt }),
      });
      await clearEditSession(env.PERSONAL_ASSISTANT_DB, userId);
      const due = intent.dueAt ? `\nVence: ${formatDate(intent.dueAt, env.APP_TIMEZONE)}` : "";
      return changed ? `✅ Tarea actualizada\n\n${intent.title}${due}` : "La tarea ya no está pendiente o no existe.";
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
    if (changed) {
      const notification = await getPersistentNotification(env.PERSONAL_ASSISTANT_DB, userId, "reminder", session.resourceId);
      if (notification?.enabled) {
        await reschedulePersistentNotification(env.PERSONAL_ASSISTANT_DB, userId, "reminder", session.resourceId, intent.remindAt);
      }
    }
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
    ? [`📋 Tareas · ${label}`, "", ...tasks.map((task, index) => `${index + 1}.- ${statusBullet(task.status)} ${task.title}\n  ${formatTaskDate(task, timezone)}`)].join("\n")
    : `📋 Tareas · ${label}\n\nNo hay tareas en este estado.`;
  return { text, replyMarkup: tasks.length ? buildListKeyboard("task", tasks, nextBeforeId, filter) : buildFilterKeyboard("task") };
}

function formatReminderListReply(
  reminders: ReminderListItem[],
  nextBeforeId: number | undefined,
  filter: QueryFilter,
  timezone: string,
): BotReply {
  const label = filterLabel("reminder", filter);
  const text = reminders.length
    ? [`⏰ Recordatorios · ${label}`, "", ...reminders.map((reminder, index) => `${index + 1}.- ${statusBullet(reminder.status)} ${reminder.title}\n  ${formatDate(reminder.remindAt, timezone)}`)].join("\n")
    : `⏰ Recordatorios · ${label}\n\nNo hay recordatorios en este estado.`;
  return { text, replyMarkup: reminders.length ? buildListKeyboard("reminder", reminders, nextBeforeId, filter) : buildFilterKeyboard("reminder") };
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

function formatBotStatus(status: Awaited<ReturnType<typeof getBotStatus>>, timezone: string): string {
  const lines = [
    "📊 Estado del bot",
    "",
    `📋 Tareas pendientes: ${status.pendingTaskCount}`,
    `⏰ Recordatorios próximos: ${status.upcomingReminderCount}`,
    `🔔 Avisos persistentes activos: ${status.activePersistentNotificationCount}`,
    `⏱ Avisos únicos pendientes: ${status.pendingSnoozeCount}`,
    `💾 Almacenamiento lógico estimado: ${formatStorageBytes(status.logicalStorageBytes)}`,
    "",
    "Próximos recordatorios:",
  ];

  if (!status.upcomingReminders.length) {
    lines.push("Ninguno");
  } else {
    lines.push(...status.upcomingReminders.map((reminder) => `• ${formatReminderAt(reminder.remindAt, timezone)} · ${reminder.title}`));
  }
  return lines.join("\n");
}

async function getContingencyCheckReply(): Promise<string> {
  try {
    const result = await fetchCombinedContingencyBulletin();
    return formatCombinedContingencyCheck(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: "contingency_check_failed",
      reason: error instanceof Error ? error.name : "unknown_error",
    }));
    return "⚠️ No pude consultar el boletín oficial de CAMe. Inténtalo de nuevo más tarde.";
  }
}

async function formatContingencySettingsReply(db: D1Database, userId: number): Promise<BotReply> {
  const [preferences, vehicles] = await Promise.all([
    getContingencyPreferences(db, userId),
    listVehicles(db, userId),
  ]);
  const lines = [
    "🚗 Alertas CAMe y Hoy No Circula",
    "",
    `Estado: ${preferences.enabled ? `Activos · ${contingencyModeLabel(preferences.mode)}` : "Apagados"}`,
    "",
    "Vehículos registrados:",
    ...(vehicles.length
      ? vehicles.map((vehicle, index) => `${index + 1}.- ${vehicle.label} · holograma ${vehicle.hologram} · placa terminada en ${vehicle.plateLastDigit}`)
      : ["Ninguno. Ejemplo: «Registra mi vehículo, holograma 0 y placa terminada en 6»." ]),
    "",
    "Recibe avisos cuando CAMe active Fase I y publique restricciones para hologramas 0 y 00.",
  ];
  const modeKeyboard = buildContingencyModeKeyboard();
  const vehicleKeyboard = buildContingencyVehiclesKeyboard(vehicles);
  return {
    text: lines.join("\n"),
    replyMarkup: { inline_keyboard: [...modeKeyboard.inline_keyboard, ...vehicleKeyboard.inline_keyboard] },
  };
}

function contingencyModeLabel(mode: ContingencyMode | null): string {
  return mode === "always" ? "avisar siempre cuando se active Fase I" : mode === "vehicle" ? "avisar solo si afecta a un vehículo" : "avisos apagados";
}

function formatSearchResults(
  results: Awaited<ReturnType<typeof searchUserDataPage>>["results"],
  timezone: string,
  pagination?: { page: number; hasMore: boolean; nextCommand: string },
): string {
  if (!results.length) return "🔎 No encontré coincidencias en tus datos.";
  const lines = [`🔎 Resultados de búsqueda${pagination ? ` · página ${pagination.page}` : ""}`, "", ...results.map((result, index) => {
    const label = result.kind === "task" ? `Tarea ${result.id}`
      : result.kind === "reminder" ? `Recordatorio ${result.id}`
        : result.kind === "expense" ? `Gasto ${result.id}`
          : `Guardado ${result.id}`;
    const date = formatDate(result.createdAt, timezone);
    const folder = result.folderName ? ` · ${result.folderName}` : "";
    return `${index + 1}.- ${label}${folder} · ${result.preview.replace(/\s+/g, " ")}\n   ${result.status} · ${date}`;
  })];
  if (pagination?.hasMore) lines.push("", `Más resultados: ${pagination.nextCommand}`);
  lines.push("", "Para abrir un guardado usa /guardado_ID.");
  return lines.join("\n");
}

function buildSearchContinuation(
  intent: Extract<Intent, { action: "search" }>,
  page: number,
): string {
  const parts = [intent.query];
  if (intent.kind) parts.push(`tipo:${intent.kind}`);
  if (intent.status) parts.push(`estado:${intent.status}`);
  if (intent.folderName) parts.push(`carpeta:"${intent.folderName.replace(/"/g, "")}"`);
  if (intent.from) parts.push(`desde:${intent.from}`);
  if (intent.to) parts.push(`hasta:${intent.to}`);
  parts.push(`pagina:${page}`);
  return `/buscar ${parts.join(" ")}`;
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type GlobalResetAction = "start" | 1 | 2 | 3;

type BroadcastAction =
  | { kind: "start"; messageText: string }
  | { kind: "start_current_status" }
  | { kind: "confirm"; step: 1 | 2 | 3 };

function parseBroadcastAction(text: string): BroadcastAction | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (/^\/difundir_estado(?:@[a-z0-9_]+)?$/iu.test(normalized)) return { kind: "start_current_status" };
  const command = /^\/difundir(?:@[a-z0-9_]+)?(?:\s+([\s\S]+))?$/iu.exec(normalized);
  if (command) return { kind: "start", messageText: command[1]?.trim() ?? "" };
  const confirmation = /^CONFIRMAR DIFUSI[ÓO]N ([123])\/3$/iu.exec(normalized);
  return confirmation ? { kind: "confirm", step: Number(confirmation[1]) as 1 | 2 | 3 } : null;
}

async function handleBroadcastAction(
  action: BroadcastAction,
  update: TelegramUpdate,
  env: Env,
  telegramFetch: typeof fetch,
): Promise<string> {
  const message = update.message;
  const telegramUserId = message?.from?.id;
  if (!message || telegramUserId === undefined) return "No pude identificar al usuario de Telegram.";
  if (!isConfiguredAdmin(telegramUserId, env)) return "Este comando solo está disponible para el administrador.";

  if (action.kind === "start_current_status") {
    try {
      const status = formatCombinedContingencyCheck(await fetchCombinedContingencyBulletin());
      return startBroadcastPreview(status, telegramUserId, message.chat.id, env);
    } catch {
      return "⚠️ No pude consultar CAMe. No preparé ninguna difusión.";
    }
  }

  if (action.kind === "start") {
    if (!validateBroadcastMessage(action.messageText)) {
      return "Escribe el mensaje después del comando. Ejemplo:\n/difundir Mantenimiento hoy a las 22:00";
    }
    return startBroadcastPreview(action.messageText, telegramUserId, message.chat.id, env);
  }

  const confirmation = await getBroadcastConfirmation(env.PERSONAL_ASSISTANT_DB, {
    telegramUserId,
    chatId: message.chat.id,
  });
  if (!confirmation || confirmation.step !== action.step) {
    if (confirmation) await clearBroadcastConfirmation(env.PERSONAL_ASSISTANT_DB, telegramUserId);
    return "Confirmación incorrecta o expirada. No se envió nada. Inicia de nuevo con /difundir o /difundir_estado.";
  }

  if (action.step === 1 || action.step === 2) {
    const advanced = await advanceBroadcastConfirmation(env.PERSONAL_ASSISTANT_DB, {
      telegramUserId,
      chatId: message.chat.id,
      expectedStep: action.step,
    });
    if (!advanced) {
      await clearBroadcastConfirmation(env.PERSONAL_ASSISTANT_DB, telegramUserId);
      return "Confirmación expirada. No se envió nada. Inicia de nuevo con /difundir.";
    }
    return action.step === 1
      ? "Confirmación 2 de 3. Todavía no se envió nada. Escribe exactamente:\nCONFIRMAR DIFUSIÓN 2/3"
      : "⚠️ Confirmación 3 de 3 (última). Se enviará el aviso a todos los chats conocidos. Escribe exactamente:\nCONFIRMAR DIFUSIÓN 3/3";
  }

  await clearBroadcastConfirmation(env.PERSONAL_ASSISTANT_DB, telegramUserId);
  const destinations = await listBroadcastDestinations(env.PERSONAL_ASSISTANT_DB);
  let delivered = 0;
  let failed = 0;
  for (const destination of destinations) {
    try {
      await sendMessage(env, destination.chatId, confirmation.messageText, telegramFetch);
      delivered += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ event: "broadcast_delivery_failed", userId: destination.userId, reason: error instanceof Error ? error.name : "delivery_failure" }));
    }
  }
  return `📣 Difusión completada.\n\nEntregados: ${delivered}\nFallidos: ${failed}\nDestinatarios conocidos: ${destinations.length}`;
}

async function startBroadcastPreview(
  messageText: string,
  telegramUserId: number,
  chatId: number,
  env: Env,
): Promise<string> {
  const destinations = await listBroadcastDestinations(env.PERSONAL_ASSISTANT_DB);
  if (destinations.length === 0) return "No hay chats conocidos a los que enviar la difusión.";
  await startBroadcastConfirmation(env.PERSONAL_ASSISTANT_DB, { telegramUserId, chatId, messageText });
  const preview = messageText.length > 800 ? `${messageText.slice(0, 799)}…` : messageText;
  return `📣 Vista previa de difusión\n\nDestinatarios conocidos: ${destinations.length}\n\n${preview}\n\nNo se modifica ninguna configuración de alertas.\n\nConfirmación 1 de 3: escribe exactamente:\nCONFIRMAR DIFUSIÓN 1/3`;
}

function isConfiguredAdmin(telegramUserId: number, env: Env): boolean {
  const adminUserId = parseConfiguredTelegramUserId(env.TELEGRAM_ADMIN_USER_ID ?? env.TELEGRAM_ALLOWED_USER_ID);
  return adminUserId !== null && telegramUserId === adminUserId;
}

function parseGlobalResetAction(text: string): GlobalResetAction | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (/^\/borrar_bd(?:@[a-z0-9_]+)?$/iu.test(normalized)) return "start";
  const confirmation = /^CONFIRMO BORRADO GLOBAL ([123])\/3$/iu.exec(normalized);
  return confirmation ? Number(confirmation[1]) as 1 | 2 | 3 : null;
}

async function handleGlobalResetAction(
  action: GlobalResetAction,
  update: TelegramUpdate,
  env: Env,
): Promise<string> {
  const message = update.message;
  const telegramUserId = message?.from?.id;
  if (!message || telegramUserId === undefined) return "No pude identificar al usuario de Telegram.";

  const adminUserId = parseConfiguredTelegramUserId(env.TELEGRAM_ADMIN_USER_ID ?? env.TELEGRAM_ALLOWED_USER_ID);
  if (adminUserId === null || telegramUserId !== adminUserId) {
    return "Este comando solo está disponible para el administrador.";
  }

  if (action === "start") {
    await startGlobalResetConfirmation(env.PERSONAL_ASSISTANT_DB, {
      telegramUserId,
      chatId: message.chat.id,
    });
    return "⚠️ Borrado global peligroso. Se eliminarán los datos de TODOS los usuarios y no se podrán recuperar.\n\nConfirmación 1 de 3: escribe exactamente:\nCONFIRMO BORRADO GLOBAL 1/3";
  }

  const confirmation = await getGlobalResetConfirmation(env.PERSONAL_ASSISTANT_DB, {
    telegramUserId,
    chatId: message.chat.id,
  });
  if (!confirmation || confirmation.step !== action) {
    if (confirmation) await clearGlobalResetConfirmation(env.PERSONAL_ASSISTANT_DB, telegramUserId);
    return "Confirmación incorrecta o expirada. El proceso se canceló y no se eliminó nada. Inicia de nuevo con /borrar_bd.";
  }

  if (action === 3) {
    await deleteAllData(env.PERSONAL_ASSISTANT_DB);
    return "🧹 La base de datos fue vaciada por completo. Se conservaron únicamente las tablas del sistema.";
  }

  const advanced = await advanceGlobalResetConfirmation(env.PERSONAL_ASSISTANT_DB, {
    telegramUserId,
    chatId: message.chat.id,
    expectedStep: action,
  });
  if (!advanced) {
    await clearGlobalResetConfirmation(env.PERSONAL_ASSISTANT_DB, telegramUserId);
    return "Confirmación expirada. El proceso se canceló y no se eliminó nada. Inicia de nuevo con /borrar_bd.";
  }
  return action === 1
    ? "Confirmación 2 de 3. Todavía no se ha borrado nada. Escribe exactamente:\nCONFIRMO BORRADO GLOBAL 2/3"
    : "⚠️ Confirmación 3 de 3 (última). Esta acción eliminará definitivamente toda la información de todos los usuarios. Escribe exactamente:\nCONFIRMO BORRADO GLOBAL 3/3";
}

function parseConfiguredTelegramUserId(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value.trim())) return null;
  const id = Number(value.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function getSavedFoldersReply(
  db: D1Database,
  userId: number,
  requestedKind: SavedNoteKind | undefined,
): Promise<Reply> {
  const kinds: SavedFolderKind[] = requestedKind && requestedKind !== "all"
    ? [requestedKind]
    : ["photos", "documents", "links"];
  const groups = await Promise.all(kinds.map(async (kind) => ({ kind, folders: await listFolders(db, userId, kind) })));
  const visibleGroups = groups.filter((group) => group.folders.length > 0);
  const emptyFolders = !requestedKind || requestedKind === "all" ? await listEmptyFolders(db, userId) : [];
  if (visibleGroups.length === 0 && emptyFolders.length === 0) {
    return requestedKind === "photos"
      ? "No tienes carpetas con imágenes guardadas. Crea una con «Crea la carpeta ...» y envía una foto con «Guarda ...»."
      : requestedKind === "documents"
        ? "No tienes carpetas con archivos guardados. Crea una con «Crea la carpeta ...» y envía un documento con «Guarda ...»."
        : requestedKind === "links"
          ? "No tienes carpetas con enlaces o notas guardadas. Crea una con «Crea la carpeta ...» y guarda una nota o enlace."
          : "Todavía no tienes carpetas con guardados. Crea una con «Crea la carpeta ...».";
  }

  const lines = [requestedKind && requestedKind !== "all" ? savedFolderBlockLabel(requestedKind) : "📁 Mis carpetas", ""];
  const keyboardRows = [];
  for (const group of visibleGroups) {
    if (!requestedKind || requestedKind === "all") lines.push(savedFolderBlockLabel(group.kind));
    lines.push(...group.folders.map((folder) => `• ${folder.name} (${folder.count})`), "");
    keyboardRows.push(...buildFolderKeyboard(group.kind, group.folders).inline_keyboard);
  }
  if (emptyFolders.length > 0) {
    lines.push("📂 Carpetas vacías", "", ...emptyFolders.map((folder) => `• ${folder.name} (0)`), "");
    lines.push("Para renombrar o eliminar una carpeta vacía, escribe su nombre.");
  }
  if (keyboardRows.length > 0) {
    lines.push("Elige una carpeta para ver sus guardados.");
    return { text: lines.join("\n"), replyMarkup: { inline_keyboard: keyboardRows } };
  }
  lines.push("Todavía no hay guardados dentro de estas carpetas.");
  return lines.join("\n");
}

function formatSavedNotesReply(
  notes: SavedNote[],
  nextBeforeId: number | undefined,
  kind: SavedNoteKind,
  folderName?: string,
  folderId?: number | null,
): Reply {
  const isPhotoList = kind === "photos";
  const lines = notes.map((note, index) => {
    const itemKind = note.file_kind === "photo" ? "Foto" : note.file_kind === "document" ? "Documento" : note.url ? "Enlace" : "Nota";
    const preview = note.content.replace(/\s+/g, " ");
    return isPhotoList
      ? `${index + 1}.- ${itemKind} · ${preview.length > 160 ? preview.slice(0, 159) + "…" : preview}`
      : `/guardado_${note.id} · ${itemKind} · ${preview.length > 160 ? preview.slice(0, 159) + "…" : preview}`;
  });
  const title = kind === "photos"
    ? "📷 Imágenes guardadas · más recientes primero"
    : kind === "documents"
      ? "📄 Archivos guardados · más recientes primero"
      : kind === "links"
        ? "🔗 Enlaces y notas · más recientes primero"
        : "📎 Mis guardados · más recientes primero";
  const selectedFolder = folderId === 0 ? "Sin carpeta" : folderName;
  const text = [
    title + (selectedFolder ? ` · ${selectedFolder}` : ""),
    "",
    ...lines,
    "",
    isPhotoList ? "Selecciona una foto para verla:" : "Toca un comando para ver el guardado.",
  ];
  if (isPhotoList) {
    const replyMarkup = buildSavedNoteKeyboard(notes);
    if (nextBeforeId && folderId !== undefined) {
      replyMarkup.inline_keyboard.push(...buildFolderPageKeyboard(kind, folderId === 0 ? null : folderId ?? null, nextBeforeId).inline_keyboard);
    } else if (nextBeforeId) {
      text.push(`Más: /guardados_${nextBeforeId}`);
    }
    return { text: text.join("\n"), replyMarkup };
  }
  if (nextBeforeId && kind !== "all" && folderId !== undefined) {
    return {
      text: text.join("\n"),
      replyMarkup: buildFolderPageKeyboard(kind, folderId === 0 ? null : folderId ?? null, nextBeforeId),
    };
  }
  if (nextBeforeId) text.push(`Más: /guardados_${nextBeforeId}`);
  return text.join("\n");
}

function formatSavedNoteContent(note: Pick<SavedNote, "content" | "url">): string {
  return note.url && note.content !== note.url ? `${note.content}\n${note.url}` : note.content;
}

function savedFolderBlockLabel(kind: SavedFolderKind): string {
  return kind === "photos" ? "🖼️ Imágenes" : kind === "documents" ? "📄 Archivos" : "🔗 Enlaces y notas";
}

function savedNotesEmptyMessage(kind: SavedNoteKind): string {
  return kind === "photos"
    ? "No tienes imágenes guardadas. Envía una foto con la descripción «Guarda»."
    : kind === "documents"
      ? "No tienes archivos guardados. Envía un documento con la descripción «Guarda»."
      : kind === "links"
        ? "No tienes enlaces o notas guardadas. Usa «Guarda https://...» o «Nota ...»."
        : "No tienes guardados. Envía una foto o documento con la descripción «Guarda».";
}

function savedNotesEmptyPageMessage(kind: SavedNoteKind): string {
  return kind === "photos" ? "No hay más imágenes guardadas." : kind === "documents" ? "No hay más archivos guardados." : kind === "links" ? "No hay más enlaces o notas guardados." : "No hay más guardados. Volver: /guardados";
}

type PendingListIntent = Extract<Intent, { action: "list_tasks" | "list_reminders" }>;

type PendingListResolution =
  | { kind: "intent"; intent: PendingListIntent }
  | { kind: "reply"; text: string };

type PendingConfirmationResolution =
  | { kind: "intent"; suggestedText: string }
  | { kind: "reply"; text: string };

function getConversationDraftSpec(
  intent: Intent,
): Pick<ConversationDraft, "flow" | "missing"> | null {
  if (intent.action !== "unknown") return null;
  if (intent.reason === "missing_task_title") return { flow: "task", missing: "title" };
  if (intent.reason === "missing_reminder_title") return { flow: "reminder", missing: "title" };
  if (intent.reason === "missing_reminder_time") return { flow: "reminder", missing: "time" };
  if (intent.reason === "missing_expense_amount") return { flow: "expense", missing: "amount" };
  if (intent.reason === "missing_expense_category") return { flow: "expense", missing: "category" };
  return null;
}

function mergeConversationDraft(draft: ConversationDraft, response: string): string {
  const answer = response.trim().replace(/\s+/g, " ");
  if (draft.missing !== "amount") return `${draft.baseText} ${answer}`.trim();

  const details = draft.baseText
    .replace(/^(?:\/?gasto(?:@[a-z0-9_]+)?|gast[eé]|anota(?:me)?|apunta(?:me)?)\s*/iu, "")
    .replace(/^agrega(?:r)?\s+(?:a\s+)?(?:los?\s+)?gastos?(?:\s+de)?\s*/iu, "")
    .trim();
  return `Gasté ${answer}${details ? ` ${details}` : ""}`.trim();
}

function conversationDraftPrompt(draft: ConversationDraft): string {
  if (draft.flow === "task") return "Me falta el título de la tarea. Ejemplo: comprar medicina";
  if (draft.flow === "reminder" && draft.missing === "time") {
    return "Indica cuándo recordarlo. Ejemplo: mañana a las 18:00";
  }
  if (draft.flow === "reminder") return "Me falta qué quieres que te recuerde. Ejemplo: pagar internet";
  if (draft.missing === "amount") return "Para registrarlo necesito el monto. Ejemplo: 450";
  return "Indica qué fue el gasto. Ejemplo: gasolina";
}

function resolvePendingConfirmationResponse(
  text: string,
  context: PendingConfirmationContext,
): PendingConfirmationResolution | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (isAffirmativeResponse(normalized)) return { kind: "intent", suggestedText: context.suggestedText };
  if (isNegativeResponse(normalized)) return { kind: "reply", text: "Entendido. No haré esa acción." };
  return null;
}

function applyClarificationDefaults(intent: Intent): Intent {
  if (intent.action === "list_tasks" && !intent.filter) return { ...intent, filter: "pending" };
  if (intent.action === "list_reminders" && !intent.filter) return { ...intent, filter: "pending" };
  return intent;
}

function isAffirmativeResponse(text: string): boolean {
  return /^(?:s[ií]|claro|correcto|adelante|de acuerdo|s[ií]\s+quiero|s[ií],?\s+(?:hazlo|adelante|por favor))$/iu.test(text);
}

function isNegativeResponse(text: string): boolean {
  return /^(?:no|ahora no|cancelar|salir)$/iu.test(text);
}

function resolvePendingListResponse(text: string, context: PendingListContext): PendingListResolution | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  const action = context.resource === "task" ? "list_tasks" : "list_reminders";
  const resourceLabel = context.resource === "task" ? "tareas" : "recordatorios";

  if (isAffirmativeResponse(normalized)) {
    return { kind: "intent", intent: { action, filter: "pending" } };
  }
  if (isNegativeResponse(normalized)) {
    return { kind: "reply", text: `Entendido. No consulté tus ${resourceLabel}.` };
  }

  const candidate = parseIntent(`${resourceLabel} ${normalized}`);
  return candidate.action === action && candidate.filter
    ? { kind: "intent", intent: candidate }
    : null;
}

function getCommandReply(text: string): Reply | null {
  const command = getCommandToken(text);

  if (command === "/start") {
    return "👋 Bienvenido a Personal Assistant.\n\nEscribe una tarea, gasto o recordatorio en lenguaje natural. También puedes guardar notas, enlaces, fotos y documentos, organizarlos en carpetas y consultar /guardados.";
  }

  if (command === "/help") {
    return "Puedo ayudarte con tareas, recordatorios, gastos, notas, enlaces, archivos y carpetas.\n\nEjemplos:\n• /comandos para ver el catálogo completo\n• tarea comprar medicina\n• tarea pagar la luz mañana a las 18:00\n• recuérdame pagar internet mañana\n• quiero que me recuerdes a las 2pm tomarme mi medicamento\n• repite tarea 1 cada semana\n• repite recordatorio 2 cada mes\n• gasté 450 en carro por compra de radiador\n• historial de gastos de carro\n• /estado para ver pendientes, avisos y almacenamiento lógico\n• /buscar tornillos para buscar entre tus datos\n• /exportar para recibir una copia JSON de tus datos\n• /importar y envía el JSON exportado como documento\n• /configuraciones para avisos persistentes y alertas CAMe\n• /contingencia para configurar avisos de Fase I\n• /hoy_no_circula para corroborar alertas actuales de CAMe\n• /vehiculo familiar holograma 0 y placa terminada en 6\n• Crea la carpeta Documentos personales\n• Renombra la carpeta Documentos personales a Documentos\n• Elimina la carpeta Temporal (te pediré confirmación)\n• Mueve el guardado 123 a la carpeta Archivo\n• Guarda este link https://ejemplo.com en Documentos personales\n• Nota póliza pendiente\n• Envía una foto o documento con «Guarda recibo de luz en Documentos personales» (uno por mensaje).\n• mis carpetas, mis imágenes, mis archivos o mis enlaces\n• mis guardados o /guardados\n• /guardado_123 para recibir un guardado de la lista";
  }

  if (command === "/comandos") return formatCommandsGuide();

  if (command === "/importar" || command === "/restaurar") {
    return "📥 Para restaurar tus datos, envía el archivo JSON de /exportar como documento y escribe /importar en la descripción.";
  }

  if (command === "/configuraciones" || command === "/configuracion" || command === "/config" || command === "configuraciones" || command === "configuracion" || command === "configuración") {
    return {
      text: "⚙️ Configuraciones\n\nElige qué deseas configurar: avisos de tareas y recordatorios, o alertas CAMe y Hoy No Circula.",
      replyMarkup: buildConfigurationKeyboard(),
    };
  }

  return null;
}

function formatCommandsGuide(): string {
  const lines = [
    "📚 Comandos disponibles",
    "",
    "Puedes usar estos comandos o pedirme lo mismo con lenguaje natural:",
    "Si una frase natural no se reconoce, usa el comando exacto del ejemplo.",
    "",
  ];
  COMMAND_GUIDE.forEach((item, index) => {
    lines.push(
      `${index + 1}.- ${item.command} — ${item.description}`,
      `   Ejemplo: ${item.example}`,
      `   Ejemplo natural: «${item.natural}»`,
      "",
    );
  });
  return lines.join("\n").trim();
}

function isNaturalCommandsRequest(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ");
  return /^¿?\s*(?:comandos|(?:qu[eé]|que)\s+puedo\s+hacer(?:\s+con\s+el\s+bot)?|(?:qu[eé]|que)\s+comandos?\s+(?:hay|puedo\s+usar)|cu[aá]les?\s+son\s+(?:los\s+)?comandos?|(?:mu[eé]strame|ens[eé]ñame|dime)\s+(?:los\s+)?comandos?)\s*[?!.]*$/iu.test(normalized);
}

async function restoreTelegramDocument(
  message: NonNullable<TelegramUpdate["message"]>,
  env: Env,
  telegramFetch: typeof fetch,
): Promise<string> {
  if (!message.document || !message.from) return "No pude identificar el documento o el usuario.";
  try {
    const content = await downloadTelegramDocument(env, message.document.file_id, telegramFetch);
    let data: unknown;
    try {
      data = JSON.parse(content) as unknown;
    } catch {
      return "El archivo no contiene un JSON válido de /exportar.";
    }
    const userId = await ensureUser(env.PERSONAL_ASSISTANT_DB, {
      telegramUserId: message.from.id,
      telegramChatId: message.chat.id,
      timezone: env.APP_TIMEZONE,
      currency: env.DEFAULT_CURRENCY,
    });
    const result = await importUserData(env.PERSONAL_ASSISTANT_DB, { userId, data });
    if (result.alreadyImported) return "ℹ️ Este archivo ya había sido restaurado; no dupliqué sus datos.";
    return `✅ Restauración completada.\nCarpetas: ${result.folders}\nTareas: ${result.tasks}\nRecordatorios: ${result.reminders}\nGastos: ${result.expenses}\nGuardados: ${result.notes}\nAvisos persistentes: ${result.persistentNotifications}`;
  } catch (error) {
    console.error(JSON.stringify({ event: "data_import_failed", reason: error instanceof Error ? error.name : "unknown_error" }));
    return "No pude restaurar el archivo. Verifica que sea el JSON generado por /exportar y vuelve a intentarlo.";
  }
}

function isImportCaption(caption: string | undefined): boolean {
  return /^(?:\/)?(?:importar|restaurar)(?:@[a-z0-9_]+)?$/iu.test(caption?.trim() ?? "");
}

async function configureTelegramCommands(env: Env, telegramFetch: typeof fetch): Promise<void> {
  try {
    await setMyCommands(env, [...TELEGRAM_COMMANDS], telegramFetch);
  } catch (error) {
    console.error(JSON.stringify({
      event: "telegram_command_menu_failed",
      reason: error instanceof Error ? error.name : "unknown_error",
    }));
  }
}

async function getTelegramHealthReply(update: TelegramUpdate, env: Env): Promise<string> {
  const telegramUserId = update.message?.from?.id;
  const adminUserId = parseConfiguredTelegramUserId(env.TELEGRAM_ADMIN_USER_ID ?? env.TELEGRAM_ALLOWED_USER_ID);
  if (telegramUserId === undefined || adminUserId === null || telegramUserId !== adminUserId) {
    return "Este comando solo está disponible para el administrador.";
  }

  try {
    await env.PERSONAL_ASSISTANT_DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return `✅ Bot operativo\nD1: accesible\nHora: ${new Date().toISOString()}`;
  } catch (error) {
    console.error(JSON.stringify({ event: "telegram_health_check_failed", reason: error instanceof Error ? error.name : "unknown_error" }));
    return "⚠️ El bot responde, pero D1 no está disponible en este momento.";
  }
}

function getCommandToken(text: string): string {
  return text.split(/\s+/, 1)[0].toLowerCase().split("@")[0];
}

function notificationScopeLabel(scope: NotificationScope): string {
  return scope === "task" ? "todas las tareas" : scope === "reminder" ? "todos los recordatorios" : "tareas y recordatorios";
}

function recurrenceLabel(rule: RecurrenceRule): string {
  return rule === "daily" ? "diaria" : rule === "weekly" ? "semanal" : "mensual";
}

function getFirstNotificationAt(
  resource: QueryResource,
  item: TaskListItem | ReminderListItem,
  intervalMinutes: NotificationIntervalMinutes,
  now: Date,
): string {
  const scheduledAt = resource === "task" ? (item as TaskListItem).dueAt : (item as ReminderListItem).remindAt;
  const scheduled = scheduledAt ? new Date(scheduledAt) : null;
  if (scheduled && scheduled.getTime() > now.getTime()) return scheduled.toISOString();
  if (resource === "task" && !scheduledAt) return new Date(now.getTime() + intervalMinutes * 60_000).toISOString();
  return now.toISOString();
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
