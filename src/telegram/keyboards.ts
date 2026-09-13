import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./client";
import type { ReminderListItem } from "../modules/reminders/repository";
import type { TaskFilter, TaskListItem } from "../modules/tasks/repository";
import type { NotificationIntervalMinutes, NotificationScope } from "../modules/notifications/repository";
import type { SavedFolderListItem, SavedNote, SavedNoteKind } from "../modules/notes/repository";
import type { UserVehicle } from "../modules/contingency/repository";

export type QueryResource = "task" | "reminder";
export type QueryFilter = TaskFilter;
export type ListedItem = TaskListItem | ReminderListItem;
export type SavedFolderKind = Exclude<SavedNoteKind, "all">;

export type FolderCallbackAction =
  | { kind: "folder_item"; noteKind: SavedFolderKind; folderId: number | null }
  | { kind: "folder_page"; noteKind: SavedFolderKind; folderId: number | null; beforeId: number }
  | { kind: "folder_conflict"; decision: "use_existing" | "create_new" };

export type CallbackAction =
  | { kind: "filter"; resource: QueryResource; filter: QueryFilter }
  | { kind: "page"; resource: QueryResource; filter: QueryFilter; beforeId: number }
  | { kind: "item"; resource: QueryResource; id: number }
  | { kind: "action"; resource: QueryResource; action: "complete" | "edit" | "cancel" | "notify" | "notify_stop" | "complete_after_stop" | "leave_pending_after_stop"; id: number }
  | { kind: "notification_set"; resource: QueryResource; id: number; intervalMinutes: NotificationIntervalMinutes | null }
  | { kind: "snooze_set"; resource: QueryResource; id: number; delayMinutes: NotificationIntervalMinutes }
  | { kind: "notification_scope"; scope: NotificationScope }
  | { kind: "notification_global_set"; scope: NotificationScope; intervalMinutes: NotificationIntervalMinutes | null }
  | { kind: "contingency_mode"; mode: "always" | "vehicle" | null }
  | { kind: "contingency_remove_vehicle"; vehicleId: number }
  | { kind: "saved_note_edit"; id: number }
  | { kind: "saved_note_delete"; id: number }
  | { kind: "saved_note_delete_decision"; id: number; confirmed: boolean }
  | { kind: "saved_note_edit_cancel" }
  | { kind: "edit_cancel"; resource: QueryResource }
  | { kind: "saved_note"; id: number }
  | FolderCallbackAction;

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
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = items.map((item, index) => [{
    text: formatItemButton(resource, index),
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

export function buildFolderKeyboard(kind: SavedFolderKind, folders: SavedFolderListItem[]): InlineKeyboardMarkup {
  return {
    inline_keyboard: folders.map((folder) => [{
      text: `📁 ${folder.name} (${folder.count})`,
      callback_data: `pa:f:i:${savedFolderKindCode(kind)}:${folder.id ?? 0}`,
    }]),
  };
}

export function buildFolderPageKeyboard(
  kind: SavedFolderKind,
  folderId: number | null,
  nextBeforeId: number | undefined,
): InlineKeyboardMarkup {
  return nextBeforeId === undefined
    ? { inline_keyboard: [] }
    : { inline_keyboard: [[{
      text: "Consultar más",
      callback_data: `pa:f:p:${savedFolderKindCode(kind)}:${folderId ?? 0}:${nextBeforeId}`,
    }]] };
}

export function buildFolderConflictKeyboard(existingName: string, requestedName: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: `Usar "${clipFolderName(existingName)}"`, callback_data: "pa:f:u" }],
      [{ text: `Crear "${clipFolderName(requestedName)}"`, callback_data: "pa:f:c" }],
    ],
  };
}

export function buildSavedNoteKeyboard(notes: SavedNote[]): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  notes.forEach((note, index) => {
    const row = rows.at(-1);
    if (!row || row.length === 4) rows.push([{ text: `${index + 1}.-`, callback_data: `pa:s:i:${note.id}` }]);
    else row.push({ text: `${index + 1}.-`, callback_data: `pa:s:i:${note.id}` });
  });
  return { inline_keyboard: rows };
}

export function buildSavedNoteActionKeyboard(noteId: number, editable: boolean): InlineKeyboardMarkup {
  const row: InlineKeyboardButton[] = [];
  if (editable) row.push({ text: "✏️ Editar", callback_data: `pa:s:e:${noteId}` });
  row.push({ text: "🗑️ Eliminar", callback_data: `pa:s:d:${noteId}` });
  return { inline_keyboard: [row] };
}

export function buildSavedNoteDeleteKeyboard(noteId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "Sí, eliminar", callback_data: `pa:s:y:${noteId}` },
      { text: "No, conservar", callback_data: `pa:s:n:${noteId}` },
    ]],
  };
}

export function buildSavedNoteEditCancelKeyboard(): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "Cancelar edición", callback_data: "pa:s:x" }]] };
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
    inline_keyboard: [
      ...buildOneTimeSnoozeRows(resource, id),
      [
        { text: label, callback_data: `pa:${resourceCode(resource)}:a:n:${id}` },
        { text: "✅ Completar", callback_data: `pa:${resourceCode(resource)}:a:c:${id}` },
        { text: "❌ Cancelar", callback_data: `pa:${resourceCode(resource)}:a:x:${id}` },
      ],
    ],
  };
}

export function buildOneTimeAlertKeyboard(resource: QueryResource, id: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: buildOneTimeSnoozeRows(resource, id),
  };
}

function buildOneTimeSnoozeRows(resource: QueryResource, id: number): InlineKeyboardButton[][] {
  const buttons = [5, 10, 20, 30, 60].map((minutes) => ({
    text: `⏱ ${minutes} min`,
    callback_data: `pa:${resourceCode(resource)}:s:${minutes}:${id}`,
  }));
  return [buttons.slice(0, 3), buttons.slice(3)];
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

export function buildContingencyModeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "Avisar siempre", callback_data: "pa:c:m:a" }],
      [{ text: "Solo si afecta a mi vehículo", callback_data: "pa:c:m:v" }],
      [{ text: "Desactivar avisos", callback_data: "pa:c:m:0" }],
    ],
  };
}

export function buildContingencyVehiclesKeyboard(vehicles: UserVehicle[]): InlineKeyboardMarkup {
  return {
    inline_keyboard: vehicles.map((vehicle) => [{
      text: `Eliminar ${vehicle.label}`,
      callback_data: `pa:c:r:${vehicle.id}`,
    }]),
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
  if (parts[1] === "c" && parts[2] === "m" && parts.length === 4) {
    const mode = parts[3] === "a" ? "always" : parts[3] === "v" ? "vehicle" : parts[3] === "0" ? null : undefined;
    return mode !== undefined ? { kind: "contingency_mode", mode } : null;
  }
  if (parts[1] === "c" && parts[2] === "r" && parts.length === 4) {
    const vehicleId = Number(parts[3]);
    return Number.isSafeInteger(vehicleId) && vehicleId > 0 ? { kind: "contingency_remove_vehicle", vehicleId } : null;
  }
  if (parts[1] === "f" && parts[2] === "u" && parts.length === 3) {
    return { kind: "folder_conflict", decision: "use_existing" };
  }
  if (parts[1] === "f" && parts[2] === "c" && parts.length === 3) {
    return { kind: "folder_conflict", decision: "create_new" };
  }
  if (parts[1] === "s" && parts[2] === "i" && parts.length === 4) {
    const id = Number(parts[3]);
    return Number.isSafeInteger(id) && id > 0 ? { kind: "saved_note", id } : null;
  }
  if (parts[1] === "s" && parts[2] === "x" && parts.length === 3) {
    return { kind: "saved_note_edit_cancel" };
  }
  if (parts[1] === "s" && ["e", "d", "y", "n"].includes(parts[2]) && parts.length === 4) {
    const id = Number(parts[3]);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    if (parts[2] === "e") return { kind: "saved_note_edit", id };
    if (parts[2] === "d") return { kind: "saved_note_delete", id };
    return { kind: "saved_note_delete_decision", id, confirmed: parts[2] === "y" };
  }
  if (parts[1] === "f" && parts[2] === "i" && parts.length === 5) {
    const noteKind = savedFolderKindFromCode(parts[3]);
    const folderId = Number(parts[4]);
    return noteKind && Number.isSafeInteger(folderId) && folderId >= 0
      ? { kind: "folder_item", noteKind, folderId: folderId === 0 ? null : folderId }
      : null;
  }
  if (parts[1] === "f" && parts[2] === "p" && parts.length === 6) {
    const noteKind = savedFolderKindFromCode(parts[3]);
    const folderIdValue = Number(parts[4]);
    const beforeId = Number(parts[5]);
    return noteKind && Number.isSafeInteger(folderIdValue) && folderIdValue >= 0 && Number.isSafeInteger(beforeId) && beforeId > 0
      ? { kind: "folder_page", noteKind, folderId: folderIdValue === 0 ? null : folderIdValue, beforeId }
      : null;
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
  if (parts[2] === "s" && parts.length === 5) {
    const delayMinutes = parseNotificationInterval(parts[3]);
    const id = Number(parts[4]);
    return delayMinutes !== undefined && delayMinutes !== null && Number.isSafeInteger(id) && id > 0
      ? { kind: "snooze_set", resource, delayMinutes, id }
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

function savedFolderKindCode(kind: SavedFolderKind): "p" | "d" | "l" {
  return kind === "photos" ? "p" : kind === "documents" ? "d" : "l";
}

function savedFolderKindFromCode(value: string): SavedFolderKind | null {
  return value === "p" ? "photos" : value === "d" ? "documents" : value === "l" ? "links" : null;
}

function formatItemButton(resource: QueryResource, index: number): string {
  return `${resource === "task" ? "Tarea" : "Recordatorio"} ${index + 1}`;
}

function resourceCode(resource: QueryResource): "t" | "r" {
  return resource === "task" ? "t" : "r";
}

function clipFolderName(name: string): string {
  return name.length <= 42 ? name : `${name.slice(0, 41)}…`;
}
