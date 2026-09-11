import { sendMessage } from "../../telegram/client";
import { buildPersistentAlertKeyboard } from "../../telegram/keyboards";
import type { Env } from "../../types";
import { advancePersistentNotification, getPersistentNotification } from "../notifications/repository";

const MAX_REMINDERS_PER_RUN = 20;
const PROCESSING_LEASE_MS = 5 * 60 * 1_000;

interface DueReminder {
  id: number;
  userId: number;
  chatId: number;
  title: string;
}

export async function processDueReminders(
  db: D1Database,
  env: Env,
  now = new Date(),
  telegramFetch: typeof fetch = fetch,
): Promise<number> {
  let sent = 0;
  const nowIso = now.toISOString();

  for (let attempt = 0; attempt < MAX_REMINDERS_PER_RUN; attempt += 1) {
    const reminder = await findDueReminder(db, nowIso);
    if (!reminder) break;

    const leaseUntil = new Date(now.getTime() + PROCESSING_LEASE_MS).toISOString();
    const claimed = await claimReminder(db, reminder.id, nowIso, leaseUntil);
    if (!claimed) continue;

    try {
      const persistentNotification = await getPersistentNotification(db, reminder.userId, "reminder", reminder.id);
      const usePersistentKeyboard = persistentNotification?.enabled === true &&
        persistentNotification.nextNotifyAt !== null &&
        new Date(persistentNotification.nextNotifyAt).getTime() <= now.getTime();
      await sendMessage(env, reminder.chatId, `⏰ Recordatorio\n\n${reminder.title}`, telegramFetch, usePersistentKeyboard
        ? { replyMarkup: buildPersistentAlertKeyboard("reminder", reminder.id) }
        : undefined);
      await markReminderSent(db, reminder.id, nowIso, usePersistentKeyboard);
      if (usePersistentKeyboard) {
        await advancePersistentNotification(db, reminder.userId, "reminder", reminder.id, nowIso);
      }
      sent += 1;
    } catch (error) {
      console.error("Reminder delivery failed", error instanceof Error ? error.message : "unknown error");
      await releaseReminder(db, reminder.id);
      break;
    }
  }

  return sent;
}

async function findDueReminder(db: D1Database, nowIso: string): Promise<DueReminder | null> {
  const row = await db
    .prepare(
      "SELECT reminders.id, reminders.user_id AS userId, users.telegram_chat_id AS chatId, reminders.title " +
        "FROM reminders INNER JOIN users ON users.id = reminders.user_id " +
      "WHERE reminders.cancelled_at IS NULL AND reminders.remind_at <= ? AND reminders.sent_at IS NULL AND (reminders.status = 'pending' OR " +
        "(reminders.status = 'processing' AND reminders.processing_until <= ?)) " +
        "ORDER BY reminders.remind_at ASC, reminders.id ASC LIMIT 1",
    )
    .bind(nowIso, nowIso)
    .first<DueReminder>();

  return row ?? null;
}

async function claimReminder(db: D1Database, id: number, nowIso: string, leaseUntil: string): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE reminders SET status = 'processing', processing_until = ? " +
        "WHERE id = ? AND cancelled_at IS NULL AND sent_at IS NULL AND remind_at <= ? AND (status = 'pending' OR " +
        "(status = 'processing' AND processing_until <= ?))",
    )
    .bind(leaseUntil, id, nowIso, nowIso)
    .run();

  return result.meta.changes === 1;
}

async function markReminderSent(db: D1Database, id: number, sentAt: string, keepPending: boolean): Promise<void> {
  await db
    .prepare(`UPDATE reminders SET status = '${keepPending ? "pending" : "sent"}', sent_at = ?, processing_until = NULL WHERE id = ? AND status = 'processing' AND cancelled_at IS NULL`)
    .bind(sentAt, id)
    .run();
}

async function releaseReminder(db: D1Database, id: number): Promise<void> {
  await db
    .prepare("UPDATE reminders SET status = 'pending', processing_until = NULL WHERE id = ? AND status = 'processing'")
    .bind(id)
    .run();
}
