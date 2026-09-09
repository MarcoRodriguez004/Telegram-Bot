export interface CreateReminderInput {
  userId: number;
  title: string;
  remindAt: string;
  createdAt?: string;
}

export type ReminderFilter = "pending" | "completed" | "cancelled" | "all";

export interface ReminderListItem {
  id: number;
  title: string;
  remindAt: string;
  status: "pending" | "completed" | "cancelled";
  createdAt: string;
}

export interface ListRemindersInput {
  userId: number;
  filter: ReminderFilter;
  beforeId?: number;
  limit?: number;
}

export interface CompleteReminderInput {
  userId: number;
  reminderId: number;
  completedAt?: string;
}

export interface CancelReminderInput {
  userId: number;
  reminderId: number;
  cancelledAt?: string;
}

export interface UpdateReminderInput {
  userId: number;
  reminderId: number;
  title: string;
  remindAt: string;
}

export async function createReminder(db: D1Database, input: CreateReminderInput): Promise<number> {
  if (!Number.isInteger(input.userId) || input.userId < 1) {
    throw new Error("User id is invalid");
  }

  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) {
    throw new Error("Reminder title is required");
  }
  if (title.length > 500) {
    throw new Error("Reminder title is too long");
  }

  const remindAt = new Date(input.remindAt);
  if (Number.isNaN(remindAt.getTime())) {
    throw new Error("Reminder time is invalid");
  }

  const result = await db
    .prepare("INSERT INTO reminders (user_id, title, remind_at, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
    .bind(input.userId, title, remindAt.toISOString(), input.createdAt ?? new Date().toISOString())
    .run();

  return result.meta.last_row_id;
}

export async function listReminders(db: D1Database, input: ListRemindersInput): Promise<{ reminders: ReminderListItem[]; nextBeforeId?: number }> {
  validateUserId(input.userId);
  validateFilter(input.filter);
  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Reminder list limit is invalid");
  if (input.beforeId !== undefined && (!Number.isSafeInteger(input.beforeId) || input.beforeId < 1)) {
    throw new Error("Reminder cursor is invalid");
  }

  const conditions = ["user_id = ?"];
  const values: Array<number | string> = [input.userId];
  if (input.filter === "pending") conditions.push("status IN ('pending', 'processing', 'failed') AND cancelled_at IS NULL");
  if (input.filter === "completed") conditions.push("status = 'sent' AND cancelled_at IS NULL");
  if (input.filter === "cancelled") conditions.push("cancelled_at IS NOT NULL");
  conditions.push("id < ?");
  values.push(input.beforeId ?? Number.MAX_SAFE_INTEGER);

  const result = await db.prepare(
    `SELECT id, title, remind_at AS remindAt, CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN status = 'sent' THEN 'completed' ELSE 'pending' END AS status, created_at AS createdAt FROM reminders WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT ?`,
  ).bind(...values, limit + 1).all<ReminderListItem>();

  const reminders = result.results.slice(0, limit);
  return { reminders, nextBeforeId: result.results.length > limit ? reminders.at(-1)?.id : undefined };
}

export async function completeReminder(db: D1Database, input: CompleteReminderInput): Promise<boolean> {
  validateUserId(input.userId);
  validateRecordId(input.reminderId, "Reminder");
  const completedAt = input.completedAt ?? new Date().toISOString();
  const result = await db.prepare(
    "UPDATE reminders SET status = 'sent', sent_at = ?, processing_until = NULL WHERE user_id = ? AND id = ? AND status IN ('pending', 'processing', 'failed') AND cancelled_at IS NULL",
  ).bind(completedAt, input.userId, input.reminderId).run();
  return result.meta.changes === 1;
}

export async function cancelReminder(db: D1Database, input: CancelReminderInput): Promise<boolean> {
  validateUserId(input.userId);
  validateRecordId(input.reminderId, "Reminder");
  const result = await db.prepare(
    "UPDATE reminders SET cancelled_at = ?, processing_until = NULL WHERE user_id = ? AND id = ? AND status IN ('pending', 'processing', 'failed') AND cancelled_at IS NULL",
  ).bind(input.cancelledAt ?? new Date().toISOString(), input.userId, input.reminderId).run();
  return result.meta.changes === 1;
}

export async function updateReminder(db: D1Database, input: UpdateReminderInput): Promise<boolean> {
  validateUserId(input.userId);
  validateRecordId(input.reminderId, "Reminder");
  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) throw new Error("Reminder title is required");
  if (title.length > 500) throw new Error("Reminder title is too long");
  const remindAt = new Date(input.remindAt);
  if (Number.isNaN(remindAt.getTime())) throw new Error("Reminder time is invalid");
  const result = await db.prepare(
    "UPDATE reminders SET title = ?, remind_at = ?, status = 'pending', sent_at = NULL, processing_until = NULL, cancelled_at = NULL WHERE user_id = ? AND id = ? AND status IN ('pending', 'processing', 'failed') AND cancelled_at IS NULL",
  ).bind(title, remindAt.toISOString(), input.userId, input.reminderId).run();
  return result.meta.changes === 1;
}

function validateUserId(userId: number): void {
  if (!Number.isInteger(userId) || userId < 1) throw new Error("User id is invalid");
}

function validateRecordId(id: number, label: string): void {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${label} id is invalid`);
}

function validateFilter(filter: ReminderFilter): void {
  if (filter !== "pending" && filter !== "completed" && filter !== "cancelled" && filter !== "all") {
    throw new Error("Reminder filter is invalid");
  }
}
