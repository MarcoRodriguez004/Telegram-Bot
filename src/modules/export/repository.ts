export interface ExportData {
  exportedAt: string;
  user: {
    telegramUserId: number;
    timezone: string;
    currency: string;
    createdAt: string;
  };
  folders: Array<{ id: number; name: string; createdAt: string }>;
  tasks: Array<{
    id: number;
    title: string;
    status: string;
    dueAt: string | null;
    recurrenceRule: string | null;
    createdAt: string;
    completedAt: string | null;
    cancelledAt: string | null;
  }>;
  reminders: Array<{
    id: number;
    title: string;
    remindAt: string;
    status: string;
    recurrenceRule: string | null;
    createdAt: string;
    sentAt: string | null;
    cancelledAt: string | null;
  }>;
  expenses: Array<{
    id: number;
    amountCents: number;
    currency: string;
    category: string;
    description: string | null;
    occurredAt: string;
    createdAt: string;
  }>;
  notes: Array<{
    id: number;
    content: string;
    url: string | null;
    folderId: number | null;
    fileKind: string | null;
    fileId: string | null;
    createdAt: string;
  }>;
  notificationDefaults: {
    tasksEnabled: boolean;
    tasksIntervalMinutes: number;
    remindersEnabled: boolean;
    remindersIntervalMinutes: number;
  } | null;
  persistentNotifications: Array<{
    resourceType: string;
    resourceId: number;
    enabled: boolean;
    intervalMinutes: number;
    nextNotifyAt: string | null;
    lastNotifiedAt: string | null;
    createdAt: string;
  }>;
}

export async function exportUserData(
  db: D1Database,
  input: { userId: number; generatedAt?: string },
): Promise<ExportData> {
  assertUserId(input.userId);
  const user = await db.prepare(
    "SELECT telegram_user_id AS telegramUserId, timezone, currency, created_at AS createdAt FROM users WHERE id = ?",
  ).bind(input.userId).first<ExportData["user"]>();
  if (!user) throw new Error("User not found");

  const [folders, tasks, reminders, expenses, notes, defaults, persistentNotifications] = await Promise.all([
    db.prepare("SELECT id, name, created_at AS createdAt FROM saved_folders WHERE user_id = ? ORDER BY id")
      .bind(input.userId).all<ExportData["folders"][number]>(),
    db.prepare(
      `SELECT id, title, CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN status = 'done' THEN 'completed' ELSE 'pending' END AS status,
              due_at AS dueAt, recurrence_rule AS recurrenceRule, created_at AS createdAt, completed_at AS completedAt, cancelled_at AS cancelledAt
         FROM tasks WHERE user_id = ? ORDER BY id`,
    ).bind(input.userId).all<ExportData["tasks"][number]>(),
    db.prepare(
      `SELECT id, title, remind_at AS remindAt, CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN status = 'sent' THEN 'completed' ELSE status END AS status,
              recurrence_rule AS recurrenceRule, created_at AS createdAt, sent_at AS sentAt, cancelled_at AS cancelledAt
         FROM reminders WHERE user_id = ? ORDER BY id`,
    ).bind(input.userId).all<ExportData["reminders"][number]>(),
    db.prepare(
      `SELECT id, amount_cents AS amountCents, currency, category, description, occurred_at AS occurredAt, created_at AS createdAt
         FROM expenses WHERE user_id = ? ORDER BY id`,
    ).bind(input.userId).all<ExportData["expenses"][number]>(),
    db.prepare(
      `SELECT id, content, url, folder_id AS folderId, file_kind AS fileKind, file_id AS fileId, created_at AS createdAt
         FROM notes WHERE user_id = ? ORDER BY id`,
    ).bind(input.userId).all<ExportData["notes"][number]>(),
    db.prepare(
      `SELECT tasks_enabled AS tasksEnabled, tasks_interval_minutes AS tasksIntervalMinutes,
              reminders_enabled AS remindersEnabled, reminders_interval_minutes AS remindersIntervalMinutes
         FROM notification_preferences WHERE user_id = ?`,
    ).bind(input.userId).first<ExportData["notificationDefaults"]>(),
    db.prepare(
      `SELECT resource_type AS resourceType, resource_id AS resourceId, enabled,
              interval_minutes AS intervalMinutes, next_notify_at AS nextNotifyAt,
              last_notified_at AS lastNotifiedAt, created_at AS createdAt
         FROM persistent_notifications WHERE user_id = ? ORDER BY id`,
    ).bind(input.userId).all<ExportData["persistentNotifications"][number]>(),
  ]);

  return {
    exportedAt: input.generatedAt ?? new Date().toISOString(),
    user,
    folders: folders.results,
    tasks: tasks.results,
    reminders: reminders.results,
    expenses: expenses.results,
    notes: notes.results,
    notificationDefaults: defaults
      ? {
          tasksEnabled: Boolean(defaults.tasksEnabled),
          tasksIntervalMinutes: Number(defaults.tasksIntervalMinutes),
          remindersEnabled: Boolean(defaults.remindersEnabled),
          remindersIntervalMinutes: Number(defaults.remindersIntervalMinutes),
        }
      : null,
    persistentNotifications: persistentNotifications.results.map((notification) => ({
      ...notification,
      enabled: Boolean(notification.enabled),
      resourceId: Number(notification.resourceId),
      intervalMinutes: Number(notification.intervalMinutes),
    })),
  };
}

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("User id is invalid");
}
