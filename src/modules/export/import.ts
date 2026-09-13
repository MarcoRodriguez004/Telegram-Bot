import { createExpense } from "../expenses/repository";
import { setNotificationDefaults, setPersistentNotification } from "../notifications/repository";
import type { NotificationIntervalMinutes, NotificationResource } from "../notifications/repository";
import { createFolder, createNote } from "../notes/repository";
import { createReminder } from "../reminders/repository";
import { createTask } from "../tasks/repository";
import type { RecurrenceRule } from "../recurrence";
import { normalizeHttpUrl } from "../../shared/urls";
import { MAX_EXPENSE_CENTS } from "../../shared/money";
import { isTelegramFileId } from "../../telegram/types";
import type { ExportData } from "./repository";

const MAX_IMPORT_RECORDS = 2_000;
const VALID_INTERVALS = [5, 10, 20, 30, 60] as const;
const VALID_RECURRENCES = ["daily", "weekly", "monthly"] as const;

export interface ImportResult {
  alreadyImported: false;
  folders: number;
  tasks: number;
  reminders: number;
  expenses: number;
  notes: number;
  persistentNotifications: number;
}

export interface AlreadyImportedResult {
  alreadyImported: true;
}

export async function importUserData(
  db: D1Database,
  input: { userId: number; data: unknown; importedAt?: string },
): Promise<ImportResult | AlreadyImportedResult> {
  assertUserId(input.userId);
  const data = validateExportData(input.data);
  const existing = await db.prepare(
    "SELECT id FROM data_imports WHERE user_id = ? AND exported_at = ?",
  ).bind(input.userId, data.exportedAt).first<{ id: number }>();
  if (existing) return { alreadyImported: true };

  const importedAt = parseDate(input.importedAt ?? new Date().toISOString(), "Import date");
  await db.prepare("UPDATE users SET timezone = ?, currency = ? WHERE id = ?")
    .bind(data.user.timezone, data.user.currency, input.userId).run();
  const folderIds = new Map<number, number>();
  for (const folder of data.folders) {
    const created = await createFolder(db, {
      userId: input.userId,
      name: folder.name,
      createdAt: folder.createdAt,
    });
    folderIds.set(folder.id, created.id);
  }

  const taskIds = new Map<number, number>();
  for (const task of data.tasks) {
    const id = await createTask(db, {
      userId: input.userId,
      title: task.title,
      dueAt: task.dueAt,
      recurrenceRule: task.recurrenceRule as RecurrenceRule | null,
      createdAt: task.createdAt,
    });
    taskIds.set(task.id, id);
    if (task.status === "completed") {
      await db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE user_id = ? AND id = ?")
        .bind(task.completedAt ?? task.createdAt, input.userId, id).run();
    } else if (task.status === "cancelled") {
      await db.prepare("UPDATE tasks SET cancelled_at = ?, completed_at = NULL WHERE user_id = ? AND id = ?")
        .bind(task.cancelledAt ?? task.createdAt, input.userId, id).run();
    }
  }

  const reminderIds = new Map<number, number>();
  for (const reminder of data.reminders) {
    const id = await createReminder(db, {
      userId: input.userId,
      title: reminder.title,
      remindAt: reminder.remindAt,
      recurrenceRule: reminder.recurrenceRule as RecurrenceRule | null,
      createdAt: reminder.createdAt,
    });
    reminderIds.set(reminder.id, id);
    if (reminder.status === "completed") {
      await db.prepare("UPDATE reminders SET status = 'sent', sent_at = ?, processing_until = NULL WHERE user_id = ? AND id = ?")
        .bind(reminder.sentAt ?? reminder.createdAt, input.userId, id).run();
    } else if (reminder.status === "cancelled") {
      await db.prepare("UPDATE reminders SET cancelled_at = ?, processing_until = NULL WHERE user_id = ? AND id = ?")
        .bind(reminder.cancelledAt ?? reminder.createdAt, input.userId, id).run();
    }
  }

  for (const expense of data.expenses) {
    await createExpense(db, {
      userId: input.userId,
      amountCents: expense.amountCents,
      currency: expense.currency,
      category: expense.category,
      description: expense.description ?? undefined,
      occurredAt: expense.occurredAt,
      createdAt: expense.createdAt,
    });
  }

  for (const note of data.notes) {
    await createNote(db, {
      userId: input.userId,
      content: note.content,
      url: note.url ?? undefined,
      createdAt: note.createdAt,
      folderId: note.folderId === null ? null : folderIds.get(note.folderId)!,
      attachment: note.fileKind && note.fileId ? { kind: note.fileKind as "photo" | "document", fileId: note.fileId } : undefined,
    });
  }

  if (data.notificationDefaults) {
    await setNotificationDefaults(db, {
      userId: input.userId,
      scope: "task",
      enabled: data.notificationDefaults.tasksEnabled,
      intervalMinutes: data.notificationDefaults.tasksIntervalMinutes as NotificationIntervalMinutes,
      now: importedAt,
    });
    await setNotificationDefaults(db, {
      userId: input.userId,
      scope: "reminder",
      enabled: data.notificationDefaults.remindersEnabled,
      intervalMinutes: data.notificationDefaults.remindersIntervalMinutes as NotificationIntervalMinutes,
      now: importedAt,
    });
  }

  let persistentNotifications = 0;
  for (const notification of data.persistentNotifications) {
    const resourceId = notification.resourceType === "task"
      ? taskIds.get(notification.resourceId)
      : reminderIds.get(notification.resourceId);
    if (!resourceId || !notification.enabled) continue;
    await setPersistentNotification(db, {
      userId: input.userId,
      resourceType: notification.resourceType as NotificationResource,
      resourceId,
      intervalMinutes: notification.intervalMinutes as NotificationIntervalMinutes,
      nextNotifyAt: notification.nextNotifyAt ?? importedAt,
      now: importedAt,
    });
    if (notification.lastNotifiedAt) {
      await db.prepare(
        "UPDATE persistent_notifications SET last_notified_at = ? WHERE user_id = ? AND resource_type = ? AND resource_id = ?",
      ).bind(notification.lastNotifiedAt, input.userId, notification.resourceType, resourceId).run();
    }
    persistentNotifications += 1;
  }

  await db.prepare(
    "INSERT INTO data_imports (user_id, exported_at, source_telegram_user_id, imported_at) VALUES (?, ?, ?, ?)",
  ).bind(input.userId, data.exportedAt, data.user.telegramUserId, importedAt).run();

  return {
    alreadyImported: false,
    folders: data.folders.length,
    tasks: data.tasks.length,
    reminders: data.reminders.length,
    expenses: data.expenses.length,
    notes: data.notes.length,
    persistentNotifications,
  };
}

function validateExportData(value: unknown): ExportData {
  if (!isRecord(value)) throw new Error("Export data is invalid");
  const exportedAt = parseDateString(value.exportedAt, "Export date");
  const user = isRecord(value.user) ? value.user : null;
  if (!user) throw new Error("Export user is invalid");
  const telegramUserId = readPositiveInteger(user.telegramUserId, "Export Telegram user id");
  const timezone = readTimezone(user.timezone);
  const currency = readCurrency(user.currency, "Export currency");
  const createdAt = parseDateString(user.createdAt, "Export user creation date");

  const folders = readArray(value.folders, "folders").map((item) => {
    const row = requireRecord(item, "Folder");
    return { id: readPositiveInteger(row.id, "Folder id"), name: readString(row.name, "Folder name", 80), createdAt: parseDateString(row.createdAt, "Folder creation date") };
  });
  const tasks = readArray(value.tasks, "tasks").map((item) => {
    const row = requireRecord(item, "Task");
    return {
      id: readPositiveInteger(row.id, "Task id"), title: readString(row.title, "Task title", 500), status: readStatus(row.status, "Task status"),
      dueAt: readNullableDate(row.dueAt, "Task due date"), recurrenceRule: readRecurrence(row.recurrenceRule, "Task recurrence"),
      createdAt: parseDateString(row.createdAt, "Task creation date"), completedAt: readNullableDate(row.completedAt, "Task completion date"), cancelledAt: readNullableDate(row.cancelledAt, "Task cancellation date"),
    };
  });
  const reminders = readArray(value.reminders, "reminders").map((item) => {
    const row = requireRecord(item, "Reminder");
    return {
      id: readPositiveInteger(row.id, "Reminder id"), title: readString(row.title, "Reminder title", 500), remindAt: parseDateString(row.remindAt, "Reminder date"),
      status: readStatus(row.status, "Reminder status"), recurrenceRule: readRecurrence(row.recurrenceRule, "Reminder recurrence"),
      createdAt: parseDateString(row.createdAt, "Reminder creation date"), sentAt: readNullableDate(row.sentAt, "Reminder sent date"), cancelledAt: readNullableDate(row.cancelledAt, "Reminder cancellation date"),
    };
  });
  const expenses = readArray(value.expenses, "expenses").map((item) => {
    const row = requireRecord(item, "Expense");
    const amountCents = readPositiveInteger(row.amountCents, "Expense amount");
    if (amountCents > MAX_EXPENSE_CENTS) throw new Error("Expense amount is invalid");
    return {
      id: readPositiveInteger(row.id, "Expense id"), amountCents, currency: readCurrency(row.currency, "Expense currency"),
      category: readString(row.category, "Expense category", 200), description: readNullableString(row.description, "Expense description", 1_000),
      occurredAt: parseDateString(row.occurredAt, "Expense date"), createdAt: parseDateString(row.createdAt, "Expense creation date"),
    };
  });
  const notes = readArray(value.notes, "notes").map((item) => {
    const row = requireRecord(item, "Note");
    const fileKind = row.fileKind === null ? null : readEnum(row.fileKind, "Note file kind", ["photo", "document"] as const);
    const fileId = readNullableString(row.fileId, "Note file id", 512);
    if ((fileKind === null) !== (fileId === null) || (fileId !== null && !isTelegramFileId(fileId))) throw new Error("Note attachment is invalid");
    const rawUrl = readNullableString(row.url, "Note URL", 2_000);
    const url = rawUrl === null ? null : normalizeHttpUrl(rawUrl);
    if (rawUrl !== null && !url) throw new Error("Note URL is invalid");
    const folderId = row.folderId === null ? null : readPositiveInteger(row.folderId, "Note folder id");
    return { id: readPositiveInteger(row.id, "Note id"), content: readString(row.content, "Note content", 1_000), url, folderId, fileKind, fileId, createdAt: parseDateString(row.createdAt, "Note creation date") };
  });
  const knownFolderIds = new Set(folders.map((folder) => folder.id));
  if (notes.some((note) => note.folderId !== null && !knownFolderIds.has(note.folderId))) {
    throw new Error("Note folder reference is invalid");
  }

  let notificationDefaults: ExportData["notificationDefaults"] = null;
  if (value.notificationDefaults !== null && value.notificationDefaults !== undefined) {
    const defaults = requireRecord(value.notificationDefaults, "Notification defaults");
    notificationDefaults = {
      tasksEnabled: readBoolean(defaults.tasksEnabled, "Task notification default"), tasksIntervalMinutes: readInterval(defaults.tasksIntervalMinutes, "Task notification interval"),
      remindersEnabled: readBoolean(defaults.remindersEnabled, "Reminder notification default"), remindersIntervalMinutes: readInterval(defaults.remindersIntervalMinutes, "Reminder notification interval"),
    };
  }
  const persistentNotifications = readArray(value.persistentNotifications, "persistentNotifications").map((item) => {
    const row = requireRecord(item, "Persistent notification");
    return {
      resourceType: readEnum(row.resourceType, "Notification resource", ["task", "reminder"] as const), resourceId: readPositiveInteger(row.resourceId, "Notification resource id"),
      enabled: readBoolean(row.enabled, "Notification enabled"), intervalMinutes: readInterval(row.intervalMinutes, "Notification interval"), nextNotifyAt: readNullableDate(row.nextNotifyAt, "Notification next date"), lastNotifiedAt: readNullableDate(row.lastNotifiedAt, "Notification last date"), createdAt: parseDateString(row.createdAt, "Notification creation date"),
    };
  });

  return { exportedAt, user: { telegramUserId, timezone, currency, createdAt }, folders, tasks, reminders, expenses, notes, notificationDefaults, persistentNotifications };
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_IMPORT_RECORDS) throw new Error(`Export ${label} is invalid`);
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is invalid`);
  return value;
}

function readString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const text = value.trim().replace(/\s+/g, " ");
  if (!text || text.length > maxLength) throw new Error(`${label} is invalid`);
  return text;
}

function readNullableString(value: unknown, label: string, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return readString(value, label, maxLength);
}

function readPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} is invalid`);
  return value as number;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function parseDateString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  return parseDate(value, label);
}

function readNullableDate(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : parseDateString(value, label);
}

function parseDate(value: string, label: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid`);
  return date.toISOString();
}

function readCurrency(value: unknown, label: string): string {
  const currency = readString(value, label, 3).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error(`${label} is invalid`);
  return currency;
}

function readTimezone(value: unknown): string {
  const timezone = readString(value, "Export timezone", 100);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error("Export timezone is invalid");
  }
  return timezone;
}

function readStatus(value: unknown, label: string): "pending" | "completed" | "cancelled" {
  return readEnum(value, label, ["pending", "completed", "cancelled"] as const);
}

function readRecurrence(value: unknown, label: string): "daily" | "weekly" | "monthly" | null {
  if (value === null || value === undefined) return null;
  return readEnum(value, label, VALID_RECURRENCES);
}

function readInterval(value: unknown, label: string): 5 | 10 | 20 | 30 | 60 {
  return readEnum(value, label, VALID_INTERVALS);
}

function readEnum<T extends string | number>(value: unknown, label: string, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new Error(`${label} is invalid`);
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("User id is invalid");
}
