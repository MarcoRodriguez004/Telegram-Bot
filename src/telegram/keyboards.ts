import { getZonedDateTime } from "../shared/dates";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./client";
import type { ReminderListItem } from "../modules/reminders/repository";
import type { TaskFilter, TaskListItem } from "../modules/tasks/repository";
import type { NotificationIntervalMinutes, NotificationScope } from "../modules/notifications/repository";

export type QueryResource = "task" | "reminder";
export type QueryFilter = TaskFilter;
export type ListedItem = TaskListItem | ReminderListItem;

export type CallbackAction =
  | { kind: "filter"; resource: QueryResource; filter: QueryFilter }
  | { kind: "page"; resource: QueryResource; filter: QueryFilter; beforeId: number }
  | { kind: "item"; resource: QueryResource; id: number }
  | { kind: "action"; resource: QueryResource; action: "complete" | "edit" | "cancel" | "notify" | "notify_stop" | "complete_after_stop" | "leave_pending_after_stop"; id: number }
  | { kind: "notification_set"; resource: QueryResource; id: number; intervalMinutes: NotificationIntervalMinutes | null }
  | { kind: "notification_scope"; scope: NotificationScope }
  | { kind: "notification_global_set"; scope: NotificationScope; intervalMinutes: NotificationIntervalMinutes | null }
  | { kind: "edit_cancel"; resource: QueryResource };

const FILTER_LABELS: Record<QueryResource, Array<{ filter: QueryFilter; label: string }>> = {
  task: [
    { filter: "pending", label: "Pendientes" },
    { filter: "completed", label: "Completadas" },
    { filter: "cancelled", label: "Canceladas" },
    { filter: "all", label: "Todas" },
  ],
  reminder: [
    { filter: "pending", label: "Pendientes" },
    { filter: "completed", label: "Completados" },
    { filter: "cancelled", label: "Cancelados" },
    { filter: "all", label: "Todos" },
  ],
};

const FILTER_CODES: Record<QueryFilter, string> = {
  pending: "p",
  completed: "c",
  cancelled: "x",
  all: "a",
};

const FILTER_BY_CODE: Record<string, QueryFilter> = {
  p: "pending",
  c: "completed",
  x: "cancelled",
  a: "all",
};

export function buildFilterKeyboard(resource: QueryResource): InlineKeyboardMarkup {
  const buttons = FILTER_LABELS[resource].map(({ filter, label }) => ({
    text: label,
    callback_data: `pa:${resourceCode(resource)}:f:${FILTER_CODES[filter]}`,
  }));
  return { inline_keyboard: [buttons.slice(0, 2), buttons.slice(2)] };
}

export function buildListKeyboard(
  resource: QueryResource,
  items: ListedItem[],
  nextBeforeId: number | undefined,
  filter: QueryFilter,
  timezone: string,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = items.map((item) => [{
    text: formatItemButton(resource, item, timezone),
    callback_data: `pa:${resourceCode(resource)}:i:${item.id}`,
  }]);
  if (nextBeforeId !== undefined) {
    rows.push([{ text: "Consultar más", callback_data: `pa:${resourceCode(resource)}:p:${FILTER_CODES[filter]}:${nextBeforeId}` }]);
  }
  return { inline_keyboard: rows };
}

export function buildItemKeyboard(
  resource: QueryResource,
  id: number,
  status: "pending" | "completed" | "cancelled",
  filter: QueryFilter,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  if (status === "pending") {
    rows.push([
      { text: "✅ Completar", callback_data: `pa:${resourceCode(resource)}:a:c:${id}` },
      { text: "✏️ Editar", callback_data: `pa:${resourceCode(resource)}:a:e:${id}` },
      { text: "❌ Cancelar", callback_data: `pa:${resourceCode(resource)}:a:x:${id}` },
    ]);
    rows.push([{ text: "⚙️ Configurar avisos", callback_data: `pa:${resourceCode(resource)}:a:v:${id}` }]);
  }
  rows.push([{ text: "↩️ Volver", callback_data: `pa:${resourceCode(resource)}:f:${FILTER_CODES[filter]}` }]);
  return { inline_keyboard: rows };
}

export function buildNotificationChoiceKeyboard(resource: QueryResource, id: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "Sin avisos", callback_data: `pa:${resourceCode(resource)}:n:0:${id}` }],
      ...[5, 10, 20, 30, 60].map((minutes) => [{
        text: `Cada ${minutes} minutos`,
        callback_data: `pa:${resourceCode(resource)}:n:${minutes}:${id}`,
      }]),
    ],
  };
}

export function buildPersistentAlertKeyboard(resource: QueryResource, id: number): InlineKeyboardMarkup {
  const label = resource === "task" ? "Parar avisos de esta tarea" : "Parar avisos de este recordatorio";
  return {
    inline_keyboard: [[
      { text: label, callback_data: `pa:${resourceCode(resource)}:a:n:${id}` },
      { text: "✅ Completar", callback_data: `pa:${resourceCode(resource)}:a:c:${id}` },
      { text: "❌ Cancelar", callback_data: `pa:${resourceCode(resource)}:a:x:${id}` },
    ]],
  };
}

export function buildStopConfirmationKeyboard(resource: QueryResource, id: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "Sí, completar", callback_data: `pa:${resourceCode(resource)}:a:y:${id}` },
      { text: "No, dejar pendiente", callback_data: `pa:${resourceCode(resource)}:a:z:${id}` },
    ]],
  };
}

export function buildGlobalNotificationKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "Todas las tareas", callback_data: "pa:g:s:t" },
      { text: "Todos los recordatorios", callback_data: "pa:g:s:r" },
    ], [{ text: "Tareas y recordatorios", callback_data: "pa:g:s:a" }]],
  };
}

export function buildGlobalNotificationIntervalKeyboard(scope: NotificationScope): InlineKeyboardMarkup {
  const scopeCode = scope === "task" ? "t" : scope === "reminder" ? "r" : "a";
  const stopLabel = scope === "task"
    ? "Parar avisos de todas las tareas"
    : scope === "reminder"
      ? "Parar avisos de todos los recordatorios"
      : "Parar todos los avisos";
  return {
    inline_keyboard: [
      [{ text: stopLabel, callback_data: `pa:g:n:${scopeCode}:0` }],
      ...[5, 10, 20, 30, 60].map((minutes) => [{
        text: `Activar cada ${minutes} minutos`,
        callback_data: `pa:g:n:${scopeCode}:${minutes}`,
      }]),
    ],
  };
}

export function buildEditCancelKeyboard(resource: QueryResource): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "Cancelar edición", callback_data: `pa:${resourceCode(resource)}:e:x` }]] };
}

export function parseCallbackData(data: string | undefined): CallbackAction | null {
  if (!data) return null;
  const parts = data.split(":");
  if (parts[0] !== "pa") return null;
  if (parts[1] === "g" && parts[2] === "s" && parts.length === 4) {
    const scope = parseNotificationScope(parts[3]);
    return scope ? { kind: "notification_scope", scope } : null;
  }
  if (parts[1] === "g" && parts[2] === "n" && parts.length === 5) {
    const scope = parseNotificationScope(parts[3]);
    const intervalMinutes = parseNotificationInterval(parts[4]);
    return scope && intervalMinutes !== undefined ? { kind: "notification_global_set", scope, intervalMinutes } : null;
  }
  if (parts[1] !== "t" && parts[1] !== "r") return null;
  const resource: QueryResource = parts[1] === "t" ? "task" : "reminder";
  if (parts[2] === "f" && parts.length === 4) {
    const filter = FILTER_BY_CODE[parts[3]];
    return filter ? { kind: "filter", resource, filter } : null;
  }
  if (parts[2] === "p" && parts.length === 5) {
    const filter = FILTER_BY_CODE[parts[3]];
    const beforeId = Number(parts[4]);
    return filter && Number.isSafeInteger(beforeId) && beforeId > 0 ? { kind: "page", resource, filter, beforeId } : null;
  }
  if (parts[2] === "i" && parts.length === 4) {
    const id = Number(parts[3]);
    return Number.isSafeInteger(id) && id > 0 ? { kind: "item", resource, id } : null;
  }
  if (parts[2] === "a" && parts.length === 5) {
    const id = Number(parts[4]);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    if (["c", "e", "x", "n", "v", "y", "z"].includes(parts[3])) {
      const action: Extract<CallbackAction, { kind: "action" }>['action'] = parts[3] === "c"
        ? "complete"
        : parts[3] === "e"
          ? "edit"
          : parts[3] === "x"
            ? "cancel"
            : parts[3] === "n"
              ? "notify_stop"
              : parts[3] === "v"
                ? "notify"
                : parts[3] === "y"
                  ? "complete_after_stop"
                  : "leave_pending_after_stop";
      return { kind: "action", resource, action, id };
    }
    return null;
  }
  if (parts[2] === "n" && parts.length === 5) {
    const intervalMinutes = parseNotificationInterval(parts[3]);
    const id = Number(parts[4]);
    return intervalMinutes !== undefined && Number.isSafeInteger(id) && id > 0
      ? { kind: "notification_set", resource, intervalMinutes, id }
      : null;
  }
  if (parts[2] === "e" && parts.length === 4 && parts[3] === "x") {
    return { kind: "edit_cancel", resource };
  }
  return null;
}

function parseNotificationInterval(value: string): NotificationIntervalMinutes | null | undefined {
  if (value === "0") return null;
  const minutes = Number(value);
  return minutes === 5 || minutes === 10 || minutes === 20 || minutes === 30 || minutes === 60 ? minutes : undefined;
}

function parseNotificationScope(value: string): NotificationScope | null {
  return value === "t" ? "task" : value === "r" ? "reminder" : value === "a" ? "all" : null;
}

function formatItemButton(resource: QueryResource, item: ListedItem, timezone: string): string {
  const date = resource === "task"
    ? formatDate((item as TaskListItem).dueAt ?? item.createdAt, timezone)
    : formatDate((item as ReminderListItem).remindAt, timezone);
  return `${truncate(item.title, 44)} · ${date}`;
}

function formatDate(value: string, timezone: string): string {
  const local = getZonedDateTime(new Date(value), timezone);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${local.year}-${pad(local.month)}-${pad(local.day)} ${pad(local.hour)}:${pad(local.minute)}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function resourceCode(resource: QueryResource): "t" | "r" {
  return resource === "task" ? "t" : "r";
}
