import { calculateUserStorageUsage } from "../storage/accounting";

export interface UpcomingReminderStatus {
  id: number;
  title: string;
  remindAt: string;
}

export interface BotStatus {
  pendingTaskCount: number;
  upcomingReminderCount: number;
  upcomingReminders: UpcomingReminderStatus[];
  activePersistentNotificationCount: number;
  pendingSnoozeCount: number;
  logicalStorageBytes: number;
}

export async function getBotStatus(
  db: D1Database,
  input: { userId: number; now?: string },
): Promise<BotStatus> {
  assertUserId(input.userId);
  const now = input.now ?? new Date().toISOString();

  const [pendingTasks, reminderCount, upcomingReminders, activePersistent, pendingSnoozes, user] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status = 'pending' AND cancelled_at IS NULL")
      .bind(input.userId).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM reminders
        WHERE user_id = ?
          AND status IN ('pending', 'processing', 'failed')
          AND cancelled_at IS NULL
          AND remind_at >= ?`,
    ).bind(input.userId, now).first<{ count: number }>(),
    db.prepare(
      `SELECT id, title, remind_at AS remindAt
         FROM reminders
        WHERE user_id = ?
          AND status IN ('pending', 'processing', 'failed')
          AND cancelled_at IS NULL
          AND remind_at >= ?
        ORDER BY remind_at ASC, id ASC
        LIMIT 5`,
    ).bind(input.userId, now).all<UpcomingReminderStatus>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM persistent_notifications p
         INNER JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ? AND p.enabled = 1`,
    ).bind(input.userId).first<{ count: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM notification_snoozes WHERE user_id = ? AND status IN ('pending', 'processing')",
    ).bind(input.userId).first<{ count: number }>(),
    db.prepare("SELECT telegram_user_id AS telegramUserId FROM users WHERE id = ?")
      .bind(input.userId).first<{ telegramUserId: number }>(),
  ]);

  let logicalStorageBytes = 0;
  if (user?.telegramUserId) {
    const usage = await calculateUserStorageUsage(db);
    logicalStorageBytes = usage.find((entry) => entry.telegramUserId === user.telegramUserId)?.logicalBytes ?? 0;
  }

  return {
    pendingTaskCount: normalizeCount(pendingTasks?.count),
    upcomingReminderCount: normalizeCount(reminderCount?.count),
    upcomingReminders: upcomingReminders.results,
    activePersistentNotificationCount: normalizeCount(activePersistent?.count),
    pendingSnoozeCount: normalizeCount(pendingSnoozes?.count),
    logicalStorageBytes,
  };
}

export interface SearchResult {
  kind: "task" | "reminder" | "expense" | "note";
  id: number;
  preview: string;
  status: string;
  createdAt: string;
}

export async function searchUserData(
  db: D1Database,
  input: { userId: number; query: string; limit?: number },
): Promise<SearchResult[]> {
  assertUserId(input.userId);
  const query = input.query.trim().replace(/\s+/g, " ");
  if (!query) throw new Error("Search query is required");
  if (query.length > 200) throw new Error("Search query is too long");

  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Search limit is invalid");

  const pattern = `%${escapeLikePattern(query.toLocaleLowerCase("es-MX"))}%`;
  const result = await db.prepare(
    `SELECT kind, id, preview, status, createdAt
       FROM (
         SELECT 'task' AS kind, id, title AS preview, CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' ELSE status END AS status, created_at AS createdAt
           FROM tasks
          WHERE user_id = ? AND LOWER(title) LIKE ? ESCAPE '\\'
         UNION ALL
         SELECT 'reminder' AS kind, id, title AS preview, CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' ELSE status END AS status, created_at AS createdAt
           FROM reminders
          WHERE user_id = ? AND LOWER(title) LIKE ? ESCAPE '\\'
         UNION ALL
         SELECT 'expense' AS kind, id, category || CASE WHEN description IS NULL OR description = '' THEN '' ELSE ': ' || description END AS preview, 'saved' AS status, created_at AS createdAt
           FROM expenses
          WHERE user_id = ? AND LOWER(category || ' ' || COALESCE(description, '')) LIKE ? ESCAPE '\\'
         UNION ALL
         SELECT 'note' AS kind, id, content AS preview, 'saved' AS status, created_at AS createdAt
           FROM notes
          WHERE user_id = ? AND LOWER(content || ' ' || COALESCE(url, '')) LIKE ? ESCAPE '\\'
       )
      ORDER BY createdAt DESC, id DESC
      LIMIT ?`,
  ).bind(input.userId, pattern, input.userId, pattern, input.userId, pattern, input.userId, pattern, limit).all<SearchResult>();

  return result.results.map((entry) => ({
    ...entry,
    id: Number(entry.id),
    preview: String(entry.preview),
    status: String(entry.status),
    createdAt: String(entry.createdAt),
  }));
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("User id is invalid");
}

function normalizeCount(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
