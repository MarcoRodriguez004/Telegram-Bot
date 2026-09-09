import { getZonedDateTime } from "../shared/dates";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./client";
import type { ReminderListItem, ReminderFilter } from "../modules/reminders/repository";
import type { TaskFilter, TaskListItem } from "../modules/tasks/repository";

export type QueryResource = "task" | "reminder";
export type QueryFilter = TaskFilter;
export type ListedItem = TaskListItem | ReminderListItem;

export type CallbackAction =
  | { kind: "filter"; resource: QueryResource; filter: QueryFilter }
  | { kind: "page"; resource: QueryResource; filter: QueryFilter; beforeId: number }
  | { kind: "item"; resource: QueryResource; id: number }
  | { kind: "action"; resource: QueryResource; action: "complete" | "edit" | "cancel"; id: number }
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
  } else if (status === "completed") {
    rows.push([{ text: "✏️ Editar", callback_data: `pa:${resourceCode(resource)}:a:e:${id}` }]);
  }
  rows.push([{ text: "↩️ Volver", callback_data: `pa:${resourceCode(resource)}:f:${FILTER_CODES[filter]}` }]);
  return { inline_keyboard: rows };
}

export function buildEditCancelKeyboard(resource: QueryResource): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "Cancelar edición", callback_data: `pa:${resourceCode(resource)}:e:x` }]] };
}

export function parseCallbackData(data: string | undefined): CallbackAction | null {
  if (!data) return null;
  const parts = data.split(":");
  if (parts[0] !== "pa" || (parts[1] !== "t" && parts[1] !== "r")) return null;
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
    if (parts[3] === "c" || parts[3] === "e" || parts[3] === "x") {
      return { kind: "action", resource, action: parts[3] === "c" ? "complete" : parts[3] === "e" ? "edit" : "cancel", id };
    }
    return null;
  }
  if (parts[2] === "e" && parts.length === 4 && parts[3] === "x") {
    return { kind: "edit_cancel", resource };
  }
  return null;
}

function formatItemButton(resource: QueryResource, item: ListedItem, timezone: string): string {
  const date = resource === "task"
    ? formatDate(item.createdAt, timezone)
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
