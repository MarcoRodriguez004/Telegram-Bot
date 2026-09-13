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
  folderName?: string | null;
}

export interface SearchUserDataInput {
  userId: number;
  query: string;
  limit?: number;
  page?: number;
  kind?: SearchResult["kind"];
  status?: "pending" | "completed" | "cancelled" | "saved";
  folderName?: string;
  from?: string;
  to?: string;
}

export interface SearchPage {
  results: SearchResult[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export async function searchUserData(
  db: D1Database,
  input: SearchUserDataInput,
): Promise<SearchResult[]> {
  const page = await searchUserDataPage(db, input);
  return page.results;
}

export async function searchUserDataPage(
  db: D1Database,
  input: SearchUserDataInput,
): Promise<SearchPage> {
  assertUserId(input.userId);
  const query = input.query.trim().replace(/\s+/g, " ");
  if (!query) throw new Error("Search query is required");
  if (query.length > 200) throw new Error("Search query is too long");

  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Search limit is invalid");
  const page = input.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new Error("Search page is invalid");
  if (input.folderName !== undefined && (input.folderName.trim().length === 0 || input.folderName.trim().length > 80)) {
    throw new Error("Search folder is invalid");
  }
  const from = input.from === undefined ? undefined : searchDateBoundary(input.from, false);
  const to = input.to === undefined ? undefined : searchDateBoundary(input.to, true);
  if (from && to && from >= to) throw new Error("Search date range is invalid");

  const pattern = `%${escapeLikePattern(query.toLocaleLowerCase("es-MX"))}%`;
  const conditions = ["LOWER(searchText) LIKE ? ESCAPE '\\'"];
  const values: Array<string | number> = [pattern];
  if (input.kind) {
    conditions.push("kind = ?");
    values.push(input.kind);
  }
  if (input.status) {
    conditions.push("status = ?");
    values.push(input.status);
  }
  if (input.folderName !== undefined) {
    const folderName = input.folderName.trim().toLocaleLowerCase("es-MX");
    conditions.push("kind = 'note'");
    if (/^sin\s+carpeta$/iu.test(folderName)) {
      conditions.push("folderName IS NULL");
    } else {
      conditions.push("LOWER(folderName) = ?");
      values.push(folderName);
    }
  }
  if (from) {
    conditions.push("createdAt >= ?");
    values.push(from);
  }
  if (to) {
    conditions.push("createdAt < ?");
    values.push(to);
  }

  const result = await db.prepare(
    `SELECT kind, id, preview, status, createdAt, folderName
       FROM (
         SELECT 'task' AS kind,
                id,
                title AS preview,
                CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN status = 'done' THEN 'completed' ELSE 'pending' END AS status,
                created_at AS createdAt,
                NULL AS folderName,
                title AS searchText
           FROM tasks
          WHERE user_id = ?
         UNION ALL
         SELECT 'reminder' AS kind,
                id,
                title AS preview,
                CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN status = 'sent' THEN 'completed' ELSE 'pending' END AS status,
                created_at AS createdAt,
                NULL AS folderName,
                title AS searchText
           FROM reminders
          WHERE user_id = ?
         UNION ALL
         SELECT 'expense' AS kind,
                id,
                category || CASE WHEN description IS NULL OR description = '' THEN '' ELSE ': ' || description END AS preview,
                'saved' AS status,
                created_at AS createdAt,
                NULL AS folderName,
                category || ' ' || COALESCE(description, '') AS searchText
           FROM expenses
          WHERE user_id = ?
         UNION ALL
         SELECT 'note' AS kind,
                n.id,
                n.content AS preview,
                'saved' AS status,
                n.created_at AS createdAt,
                f.name AS folderName,
                n.content || ' ' || COALESCE(n.url, '') AS searchText
           FROM notes n
           LEFT JOIN saved_folders f ON f.id = n.folder_id AND f.user_id = n.user_id
          WHERE n.user_id = ?
       )
      WHERE ${conditions.join(" AND ")}
      ORDER BY createdAt DESC, id DESC
      LIMIT ? OFFSET ?`,
  ).bind(input.userId, input.userId, input.userId, input.userId, ...values, limit + 1, (page - 1) * limit).all<SearchResult>();

  const rows = result.results.slice(0, limit);
  return {
    results: rows.map((entry) => ({
    ...entry,
    id: Number(entry.id),
    preview: String(entry.preview),
    status: String(entry.status),
    createdAt: String(entry.createdAt),
    ...(entry.folderName === null || entry.folderName === undefined ? {} : { folderName: String(entry.folderName) }),
    })),
    page,
    limit,
    hasMore: result.results.length > limit,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("User id is invalid");
}

function searchDateBoundary(value: string, exclusiveEnd: boolean): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new Error("Search date is invalid");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (exclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function normalizeCount(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
