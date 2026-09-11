export const NOTIFICATION_INTERVALS = [5, 10, 20, 30, 60] as const;
export type NotificationIntervalMinutes = (typeof NOTIFICATION_INTERVALS)[number];
export type NotificationResource = "task" | "reminder";
export type NotificationScope = NotificationResource | "all";

export interface PersistentNotification {
  enabled: boolean;
  intervalMinutes: NotificationIntervalMinutes;
  nextNotifyAt: string | null;
  processingUntil: string | null;
  lastNotifiedAt: string | null;
}

export interface SetPersistentNotificationInput {
  userId: number;
  resourceType: NotificationResource;
  resourceId: number;
  intervalMinutes: NotificationIntervalMinutes | null;
  nextNotifyAt?: string;
  now?: string;
}

export interface InitializePersistentNotificationInput {
  userId: number;
  resourceType: NotificationResource;
  resourceId: number;
  firstNotifyAt: string | null;
  createdAt?: string;
}

export interface SetNotificationDefaultsInput {
  userId: number;
  scope: NotificationScope;
  enabled: boolean;
  intervalMinutes?: NotificationIntervalMinutes;
  now?: string;
}

interface RawPersistentNotification {
  enabled: number;
  intervalMinutes: NotificationIntervalMinutes;
  nextNotifyAt: string | null;
  processingUntil: string | null;
  lastNotifiedAt: string | null;
}

interface RawNotificationPreferences {
  tasksEnabled: number;
  tasksIntervalMinutes: NotificationIntervalMinutes;
  remindersEnabled: number;
  remindersIntervalMinutes: NotificationIntervalMinutes;
}

export async function getPersistentNotification(
  db: D1Database,
  userId: number,
  resourceType: NotificationResource,
  resourceId: number,
): Promise<PersistentNotification | null> {
  validateUserId(userId);
  validateResource(resourceType);
  validateRecordId(resourceId);

  const row = await db.prepare(
    "SELECT enabled, interval_minutes AS intervalMinutes, next_notify_at AS nextNotifyAt, processing_until AS processingUntil, last_notified_at AS lastNotifiedAt " +
      "FROM persistent_notifications WHERE user_id = ? AND resource_type = ? AND resource_id = ?",
  ).bind(userId, resourceType, resourceId).first<RawPersistentNotification>();

  return row ? normalizeNotification(row) : null;
}

export async function setPersistentNotification(db: D1Database, input: SetPersistentNotificationInput): Promise<void> {
  validateUserId(input.userId);
  validateResource(input.resourceType);
  validateRecordId(input.resourceId);
  const now = parseIso(input.now ?? new Date().toISOString(), "Notification timestamp");

  await assertPendingResourceOwnership(db, input.userId, input.resourceType, input.resourceId);

  if (input.intervalMinutes === null) {
    await db.prepare(
      "UPDATE persistent_notifications SET enabled = 0, next_notify_at = NULL, processing_until = NULL " +
        "WHERE user_id = ? AND resource_type = ? AND resource_id = ?",
    ).bind(input.userId, input.resourceType, input.resourceId).run();
    return;
  }

  validateInterval(input.intervalMinutes);
  const nextNotifyAt = input.nextNotifyAt === undefined
    ? now.toISOString()
    : parseIso(input.nextNotifyAt, "Next notification timestamp").toISOString();

  await db.prepare(
    "INSERT INTO persistent_notifications (user_id, resource_type, resource_id, enabled, interval_minutes, next_notify_at, created_at) " +
      "VALUES (?, ?, ?, 1, ?, ?, ?) " +
      "ON CONFLICT(resource_type, resource_id) DO UPDATE SET user_id = excluded.user_id, enabled = 1, " +
      "interval_minutes = excluded.interval_minutes, next_notify_at = excluded.next_notify_at, processing_until = NULL",
  ).bind(input.userId, input.resourceType, input.resourceId, input.intervalMinutes, nextNotifyAt, now.toISOString()).run();
}

export async function initializePersistentNotification(
  db: D1Database,
  input: InitializePersistentNotificationInput,
): Promise<void> {
  const preferences = await getNotificationPreferences(db, input.userId);
  const enabled = input.resourceType === "task" ? preferences.tasksEnabled : preferences.remindersEnabled;
  if (!enabled) return;

  const intervalMinutes = input.resourceType === "task"
    ? preferences.tasksIntervalMinutes
    : preferences.remindersIntervalMinutes;
  const firstNotifyAt = input.firstNotifyAt
    ? parseIso(input.firstNotifyAt, "First notification timestamp").toISOString()
    : new Date(parseIso(input.createdAt ?? new Date().toISOString(), "Creation timestamp").getTime() + intervalMinutes * 60_000).toISOString();

  await setPersistentNotification(db, {
    userId: input.userId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    intervalMinutes,
    nextNotifyAt: firstNotifyAt,
    now: input.createdAt,
  });
}

export async function setNotificationDefaults(db: D1Database, input: SetNotificationDefaultsInput): Promise<void> {
  validateUserId(input.userId);
  validateScope(input.scope);
  const now = parseIso(input.now ?? new Date().toISOString(), "Notification timestamp").toISOString();
  if (input.enabled && input.intervalMinutes === undefined) {
    throw new Error("Notification interval is required when enabling notifications");
  }
  if (input.intervalMinutes !== undefined) validateInterval(input.intervalMinutes);

  const current = await getNotificationPreferences(db, input.userId);
  const tasksEnabled = appliesTo(input.scope, "task") ? input.enabled : current.tasksEnabled;
  const remindersEnabled = appliesTo(input.scope, "reminder") ? input.enabled : current.remindersEnabled;
  const tasksIntervalMinutes = appliesTo(input.scope, "task") && input.intervalMinutes !== undefined
    ? input.intervalMinutes
    : current.tasksIntervalMinutes;
  const remindersIntervalMinutes = appliesTo(input.scope, "reminder") && input.intervalMinutes !== undefined
    ? input.intervalMinutes
    : current.remindersIntervalMinutes;

  await db.prepare(
    "INSERT INTO notification_preferences (user_id, tasks_enabled, tasks_interval_minutes, reminders_enabled, reminders_interval_minutes, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET tasks_enabled = excluded.tasks_enabled, tasks_interval_minutes = excluded.tasks_interval_minutes, " +
      "reminders_enabled = excluded.reminders_enabled, reminders_interval_minutes = excluded.reminders_interval_minutes, updated_at = excluded.updated_at",
  ).bind(input.userId, tasksEnabled ? 1 : 0, tasksIntervalMinutes, remindersEnabled ? 1 : 0, remindersIntervalMinutes, now).run();

  if (appliesTo(input.scope, "task")) {
    await syncGlobalResource(db, input.userId, "task", input.enabled, tasksIntervalMinutes, now);
  }
  if (appliesTo(input.scope, "reminder")) {
    await syncGlobalResource(db, input.userId, "reminder", input.enabled, remindersIntervalMinutes, now);
  }
}

export async function getNotificationPreferences(db: D1Database, userId: number): Promise<{
  tasksEnabled: boolean;
  tasksIntervalMinutes: NotificationIntervalMinutes;
  remindersEnabled: boolean;
  remindersIntervalMinutes: NotificationIntervalMinutes;
}> {
  validateUserId(userId);
  const row = await db.prepare(
    "SELECT tasks_enabled AS tasksEnabled, tasks_interval_minutes AS tasksIntervalMinutes, reminders_enabled AS remindersEnabled, " +
      "reminders_interval_minutes AS remindersIntervalMinutes FROM notification_preferences WHERE user_id = ?",
  ).bind(userId).first<RawNotificationPreferences>();
  if (!row) {
    return { tasksEnabled: false, tasksIntervalMinutes: 60, remindersEnabled: false, remindersIntervalMinutes: 60 };
  }
  return {
    tasksEnabled: row.tasksEnabled === 1,
    tasksIntervalMinutes: row.tasksIntervalMinutes,
    remindersEnabled: row.remindersEnabled === 1,
    remindersIntervalMinutes: row.remindersIntervalMinutes,
  };
}

export async function disablePersistentNotification(
  db: D1Database,
  userId: number,
  resourceType: NotificationResource,
  resourceId: number,
): Promise<void> {
  validateUserId(userId);
  validateResource(resourceType);
  validateRecordId(resourceId);
  await db.prepare(
    "UPDATE persistent_notifications SET enabled = 0, next_notify_at = NULL, processing_until = NULL " +
      "WHERE user_id = ? AND resource_type = ? AND resource_id = ?",
  ).bind(userId, resourceType, resourceId).run();
}

export async function advancePersistentNotification(
  db: D1Database,
  userId: number,
  resourceType: NotificationResource,
  resourceId: number,
  sentAt: string,
): Promise<void> {
  const notification = await getPersistentNotification(db, userId, resourceType, resourceId);
  if (!notification?.enabled || !notification.nextNotifyAt) return;

  const sentDate = parseIso(sentAt, "Notification timestamp");
  const intervalMs = notification.intervalMinutes * 60_000;
  let nextNotifyAt = new Date(new Date(notification.nextNotifyAt).getTime() + intervalMs);
  while (nextNotifyAt.getTime() <= sentDate.getTime()) {
    nextNotifyAt = new Date(nextNotifyAt.getTime() + intervalMs);
  }
  await db.prepare(
    "UPDATE persistent_notifications SET last_notified_at = ?, next_notify_at = ?, processing_until = NULL " +
      "WHERE user_id = ? AND resource_type = ? AND resource_id = ? AND enabled = 1",
  ).bind(sentDate.toISOString(), nextNotifyAt.toISOString(), userId, resourceType, resourceId).run();
}

export async function reschedulePersistentNotification(
  db: D1Database,
  userId: number,
  resourceType: NotificationResource,
  resourceId: number,
  firstNotifyAt: string,
): Promise<void> {
  validateUserId(userId);
  validateResource(resourceType);
  validateRecordId(resourceId);
  const nextNotifyAt = parseIso(firstNotifyAt, "First notification timestamp").toISOString();
  await db.prepare(
    "UPDATE persistent_notifications SET next_notify_at = ?, processing_until = NULL " +
      "WHERE user_id = ? AND resource_type = ? AND resource_id = ? AND enabled = 1",
  ).bind(nextNotifyAt, userId, resourceType, resourceId).run();
}

function normalizeNotification(row: RawPersistentNotification): PersistentNotification {
  return {
    enabled: row.enabled === 1,
    intervalMinutes: row.intervalMinutes,
    nextNotifyAt: row.nextNotifyAt,
    processingUntil: row.processingUntil,
    lastNotifiedAt: row.lastNotifiedAt,
  };
}

async function syncGlobalResource(
  db: D1Database,
  userId: number,
  resourceType: NotificationResource,
  enabled: boolean,
  intervalMinutes: NotificationIntervalMinutes,
  now: string,
): Promise<void> {
  if (!enabled) {
    await db.prepare(
      "UPDATE persistent_notifications SET enabled = 0, next_notify_at = NULL, processing_until = NULL " +
        "WHERE user_id = ? AND resource_type = ?",
    ).bind(userId, resourceType).run();
    return;
  }

  const table = resourceType === "task" ? "tasks" : "reminders";
  const dueColumn = resourceType === "task" ? "due_at" : "remind_at";
  await db.prepare(
    "INSERT INTO persistent_notifications (user_id, resource_type, resource_id, enabled, interval_minutes, next_notify_at, created_at) " +
      `SELECT ${table}.user_id, ?, ${table}.id, 1, ?, CASE WHEN ${table}.${dueColumn} IS NOT NULL AND ${table}.${dueColumn} > ? THEN ${table}.${dueColumn} ELSE ? END, ? ` +
      `FROM ${table} WHERE ${table}.user_id = ? AND ${table}.status = ${resourceType === "task" ? "'pending'" : "'pending'"} AND ${table}.cancelled_at IS NULL ` +
      "ON CONFLICT(resource_type, resource_id) DO UPDATE SET enabled = 1, interval_minutes = excluded.interval_minutes, " +
      "next_notify_at = excluded.next_notify_at, processing_until = NULL",
  ).bind(resourceType, intervalMinutes, now, now, now, userId).run();
}

async function assertPendingResourceOwnership(
  db: D1Database,
  userId: number,
  resourceType: NotificationResource,
  resourceId: number,
): Promise<void> {
  const table = resourceType === "task" ? "tasks" : "reminders";
  const row = await db.prepare(
    `SELECT id FROM ${table} WHERE id = ? AND user_id = ? AND status = 'pending' AND cancelled_at IS NULL`,
  ).bind(resourceId, userId).first<{ id: number }>();
  if (!row) throw new Error("Notification resource is not pending or does not belong to the user");
}

function appliesTo(scope: NotificationScope, resource: NotificationResource): boolean {
  return scope === "all" || scope === resource;
}

function validateInterval(value: number): asserts value is NotificationIntervalMinutes {
  if (!NOTIFICATION_INTERVALS.includes(value as NotificationIntervalMinutes)) throw new Error("Notification interval is invalid");
}

function validateScope(scope: NotificationScope): void {
  if (scope !== "task" && scope !== "reminder" && scope !== "all") throw new Error("Notification scope is invalid");
}

function validateResource(resourceType: NotificationResource): void {
  if (resourceType !== "task" && resourceType !== "reminder") throw new Error("Notification resource is invalid");
}

function validateUserId(userId: number): void {
  if (!Number.isInteger(userId) || userId < 1) throw new Error("User id is invalid");
}

function validateRecordId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Notification resource id is invalid");
}

function parseIso(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed;
}
