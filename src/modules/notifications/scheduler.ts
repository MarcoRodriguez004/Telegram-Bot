import { sendMessage } from "../../telegram/client";
import { buildOneTimeAlertKeyboard, buildPersistentAlertKeyboard } from "../../telegram/keyboards";
import type { Env } from "../../types";
import type { NotificationResource } from "./repository";
import { reportOperationalFailure } from "../operations/alerts";

const MAX_NOTIFICATIONS_PER_RUN = 20;
const PROCESSING_LEASE_MS = 5 * 60 * 1_000;

interface DueNotification {
  id: number;
  userId: number;
  chatId: number;
  resourceId: number;
  title: string;
  resourceType: NotificationResource;
  intervalMinutes: number;
  nextNotifyAt: string;
}

export async function processDueNotifications(
  db: D1Database,
  env: Env,
  now = new Date(),
  telegramFetch: typeof fetch = fetch,
): Promise<number> {
  let sent = await processDueSnoozes(db, env, now, telegramFetch);
  if (sent >= MAX_NOTIFICATIONS_PER_RUN) return sent;
  sent += await processResourceNotifications(db, env, "task", now, telegramFetch, MAX_NOTIFICATIONS_PER_RUN - sent);
  if (sent < MAX_NOTIFICATIONS_PER_RUN) {
    sent += await processResourceNotifications(db, env, "reminder", now, telegramFetch, MAX_NOTIFICATIONS_PER_RUN - sent);
  }
  return sent;
}

interface DueSnooze {
  id: number;
  userId: number;
  chatId: number;
  resourceId: number;
  title: string;
  resourceType: NotificationResource;
}

async function processDueSnoozes(
  db: D1Database,
  env: Env,
  now: Date,
  telegramFetch: typeof fetch,
): Promise<number> {
  let sent = 0;
  const nowIso = now.toISOString();
  for (let attempt = 0; attempt < MAX_NOTIFICATIONS_PER_RUN; attempt += 1) {
    const snooze = await findDueSnooze(db, nowIso);
    if (!snooze) break;
    const leaseUntil = new Date(now.getTime() + PROCESSING_LEASE_MS).toISOString();
    const claimed = await claimSnooze(db, snooze, nowIso, leaseUntil);
    if (!claimed) continue;
    try {
      const heading = snooze.resourceType === "task" ? "📋 Tarea pendiente" : "⏰ Recordatorio";
      await sendMessage(env, snooze.chatId, `${heading}\n\n${snooze.title}`, telegramFetch, {
        replyMarkup: buildOneTimeAlertKeyboard(snooze.resourceType, snooze.resourceId),
      });
      await markSnoozeSent(db, snooze.id, nowIso, leaseUntil);
      sent += 1;
    } catch (error) {
      console.error(JSON.stringify({ event: "telegram_snooze_delivery_failed", error: error instanceof Error ? error.message : "unknown_error" }));
      await reportOperationalFailure(db, env, {
        component: "scheduler",
        operation: "snooze_delivery",
        detail: "telegram_or_database_failure",
        now,
      }, telegramFetch);
      await releaseSnooze(db, snooze.id, leaseUntil);
      break;
    }
  }
  return sent;
}

async function findDueSnooze(db: D1Database, nowIso: string): Promise<DueSnooze | null> {
  const task = await db.prepare(
    "SELECT snoozes.id, snoozes.user_id AS userId, users.telegram_chat_id AS chatId, snoozes.resource_id AS resourceId, " +
      "'task' AS resourceType, resource.title FROM notification_snoozes snoozes " +
      "INNER JOIN users ON users.id = snoozes.user_id " +
      "INNER JOIN tasks resource ON snoozes.resource_type = 'task' AND resource.id = snoozes.resource_id AND resource.user_id = snoozes.user_id " +
      "WHERE snoozes.status IN ('pending', 'failed') AND snoozes.notify_at <= ? AND " +
      "(snoozes.processing_until IS NULL OR snoozes.processing_until <= ?) " +
      "AND resource.cancelled_at IS NULL AND resource.status = 'pending' " +
      "ORDER BY snoozes.notify_at ASC, snoozes.id ASC LIMIT 1",
  ).bind(nowIso, nowIso).first<DueSnooze>();
  if (task) return task;
  return db.prepare(
    "SELECT snoozes.id, snoozes.user_id AS userId, users.telegram_chat_id AS chatId, snoozes.resource_id AS resourceId, " +
      "'reminder' AS resourceType, resource.title FROM notification_snoozes snoozes " +
      "INNER JOIN users ON users.id = snoozes.user_id " +
      "INNER JOIN reminders resource ON snoozes.resource_type = 'reminder' AND resource.id = snoozes.resource_id AND resource.user_id = snoozes.user_id " +
      "WHERE snoozes.status IN ('pending', 'failed') AND snoozes.notify_at <= ? AND " +
      "(snoozes.processing_until IS NULL OR snoozes.processing_until <= ?) " +
      "AND resource.cancelled_at IS NULL AND resource.status IN ('pending', 'processing', 'sent', 'failed') " +
      "ORDER BY snoozes.notify_at ASC, snoozes.id ASC LIMIT 1",
  ).bind(nowIso, nowIso).first<DueSnooze>();
}

async function claimSnooze(db: D1Database, snooze: DueSnooze, nowIso: string, leaseUntil: string): Promise<boolean> {
  const result = await db.prepare(
    "UPDATE notification_snoozes SET status = 'processing', processing_until = ? WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed') AND notify_at <= ? AND (processing_until IS NULL OR processing_until <= ?)",
  ).bind(leaseUntil, snooze.id, snooze.userId, nowIso, nowIso).run();
  return result.meta.changes === 1;
}

async function markSnoozeSent(db: D1Database, id: number, sentAt: string, leaseUntil: string): Promise<void> {
  await db.prepare("UPDATE notification_snoozes SET status = 'sent', sent_at = ?, processing_until = NULL WHERE id = ? AND status = 'processing' AND processing_until = ?")
    .bind(sentAt, id, leaseUntil).run();
}

async function releaseSnooze(db: D1Database, id: number, leaseUntil: string): Promise<void> {
  await db.prepare("UPDATE notification_snoozes SET status = 'pending', processing_until = NULL WHERE id = ? AND status = 'processing' AND processing_until = ?")
    .bind(id, leaseUntil).run();
}

async function processResourceNotifications(
  db: D1Database,
  env: Env,
  resourceType: NotificationResource,
  now: Date,
  telegramFetch: typeof fetch,
  remaining: number,
): Promise<number> {
  let sent = 0;
  const nowIso = now.toISOString();

  for (let attempt = 0; attempt < remaining; attempt += 1) {
    const notification = await findDueNotification(db, resourceType, nowIso);
    if (!notification) break;

    const leaseUntil = new Date(now.getTime() + PROCESSING_LEASE_MS).toISOString();
    const claimed = await claimNotification(db, notification, nowIso, leaseUntil);
    if (!claimed) continue;

    try {
      const heading = resourceType === "task" ? "📋 Tarea pendiente" : "⏰ Recordatorio pendiente";
      await sendMessage(env, notification.chatId, `${heading}\n\n${notification.title}`, telegramFetch, {
        replyMarkup: buildPersistentAlertKeyboard(resourceType, notification.resourceId),
      });
      await markNotificationSent(db, notification, nowIso, leaseUntil, now);
      sent += 1;
    } catch (error) {
      console.error("Persistent notification delivery failed", error instanceof Error ? error.message : "unknown error");
      await reportOperationalFailure(db, env, {
        component: "scheduler",
        operation: "persistent_notification_delivery",
        detail: "telegram_or_database_failure",
        now,
      }, telegramFetch);
      await releaseNotification(db, notification.id, leaseUntil);
      break;
    }
  }

  return sent;
}

async function findDueNotification(db: D1Database, resourceType: NotificationResource, nowIso: string): Promise<DueNotification | null> {
  const table = resourceType === "task" ? "tasks" : "reminders";
  const status = "'pending'";
  return db.prepare(
    "SELECT notifications.id, notifications.user_id AS userId, users.telegram_chat_id AS chatId, notifications.resource_id AS resourceId, " +
      `resource.title, notifications.resource_type AS resourceType, notifications.interval_minutes AS intervalMinutes, notifications.next_notify_at AS nextNotifyAt FROM persistent_notifications notifications ` +
      `INNER JOIN ${table} resource ON resource.id = notifications.resource_id AND resource.user_id = notifications.user_id ` +
      "INNER JOIN users ON users.id = notifications.user_id " +
      `WHERE notifications.resource_type = ? AND notifications.enabled = 1 AND resource.status = ${status} AND resource.cancelled_at IS NULL ` +
      (resourceType === "reminder" ? "AND resource.sent_at IS NOT NULL " : "") +
      "AND notifications.next_notify_at IS NOT NULL AND notifications.next_notify_at <= ? AND " +
      "(notifications.processing_until IS NULL OR notifications.processing_until <= ?) " +
      "ORDER BY notifications.next_notify_at ASC, notifications.id ASC LIMIT 1",
  ).bind(resourceType, nowIso, nowIso).first<DueNotification>();
}

async function claimNotification(
  db: D1Database,
  notification: DueNotification,
  nowIso: string,
  leaseUntil: string,
): Promise<boolean> {
  const table = notification.resourceType === "task" ? "tasks" : "reminders";
  const status = "'pending'";
  const result = await db.prepare(
    "UPDATE persistent_notifications SET processing_until = ? WHERE id = ? AND user_id = ? AND resource_type = ? AND enabled = 1 " +
      "AND next_notify_at IS NOT NULL AND next_notify_at <= ? AND (processing_until IS NULL OR processing_until <= ?) " +
      `AND EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND user_id = ? AND status = ${status} AND cancelled_at IS NULL ` +
      (notification.resourceType === "reminder" ? "AND sent_at IS NOT NULL" : "") + ")",
  ).bind(
    leaseUntil,
    notification.id,
    notification.userId,
    notification.resourceType,
    nowIso,
    nowIso,
    notification.resourceId,
    notification.userId,
  ).run();
  return result.meta.changes === 1;
}

async function markNotificationSent(
  db: D1Database,
  notification: DueNotification,
  sentAt: string,
  leaseUntil: string,
  now: Date,
): Promise<void> {
  const intervalMs = notification.intervalMinutes * 60_000;
  let nextNotifyAt = new Date(new Date(notification.nextNotifyAt).getTime() + intervalMs);
  while (nextNotifyAt.getTime() <= now.getTime()) {
    nextNotifyAt = new Date(nextNotifyAt.getTime() + intervalMs);
  }
  await db.prepare(
    "UPDATE persistent_notifications SET last_notified_at = ?, next_notify_at = ?, processing_until = NULL " +
      "WHERE id = ? AND processing_until = ?",
  ).bind(sentAt, nextNotifyAt.toISOString(), notification.id, leaseUntil).run();
}

async function releaseNotification(db: D1Database, id: number, leaseUntil: string): Promise<void> {
  await db.prepare("UPDATE persistent_notifications SET processing_until = NULL WHERE id = ? AND processing_until = ?")
    .bind(id, leaseUntil).run();
}
