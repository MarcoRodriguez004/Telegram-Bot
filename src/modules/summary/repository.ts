export interface SummaryInput {
  userId: number;
  startAt: string;
  endAt: string;
}

export interface SummaryReminder {
  title: string;
  remindAt: string;
}

export interface SummaryNote {
  content: string;
  url: string | null;
  createdAt: string;
}

export interface SummaryExpenseCategory {
  category: string;
  totalCents: number;
}

export interface SummaryResult {
  pendingTaskCount: number;
  completedTaskCount: number;
  cancelledTaskCount: number;
  totalExpenseCents: number;
  expenseCount: number;
  expensesByCategory: SummaryExpenseCategory[];
  upcomingReminders: SummaryReminder[];
  recentNotes: SummaryNote[];
}

export async function getSummary(db: D1Database, input: SummaryInput): Promise<SummaryResult> {
  if (!Number.isInteger(input.userId) || input.userId < 1) {
    throw new Error("User id is invalid");
  }

  const pendingTasks = await db
    .prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status = 'pending'")
    .bind(input.userId)
    .first<{ count: number }>();

  const completedTasks = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status = 'done' AND completed_at >= ? AND completed_at < ?",
    )
    .bind(input.userId, input.startAt, input.endAt)
    .first<{ count: number }>();

  const cancelledTasks = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND cancelled_at >= ? AND cancelled_at < ?",
    )
    .bind(input.userId, input.startAt, input.endAt)
    .first<{ count: number }>();

  const expenses = await db
    .prepare(
      "SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses " +
      "WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ?",
    )
    .bind(input.userId, input.startAt, input.endAt)
    .first<{ count: number; totalCents: number }>();

  const expensesByCategory = await db
    .prepare(
      "SELECT category, SUM(amount_cents) AS totalCents FROM expenses " +
      "WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ? " +
      "GROUP BY category ORDER BY totalCents DESC, category ASC LIMIT 5",
    )
    .bind(input.userId, input.startAt, input.endAt)
    .all<SummaryExpenseCategory>();

  const reminders = await db
    .prepare(
      "SELECT title, remind_at AS remindAt FROM reminders " +
        "WHERE user_id = ? AND status IN ('pending', 'processing') " +
        "AND remind_at >= ? AND remind_at < ? ORDER BY remind_at ASC LIMIT 5",
    )
    .bind(input.userId, input.startAt, input.endAt)
    .all<SummaryReminder>();

  const notes = await db
    .prepare(
      "SELECT content, url, created_at AS createdAt FROM notes " +
        "WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
    )
    .bind(input.userId)
    .all<SummaryNote>();

  return {
    pendingTaskCount: Number(pendingTasks?.count ?? 0),
    completedTaskCount: Number(completedTasks?.count ?? 0),
    cancelledTaskCount: Number(cancelledTasks?.count ?? 0),
    totalExpenseCents: Number(expenses?.totalCents ?? 0),
    expenseCount: Number(expenses?.count ?? 0),
    expensesByCategory: expensesByCategory.results.map((entry) => ({
      category: String(entry.category),
      totalCents: Number(entry.totalCents ?? 0),
    })),
    upcomingReminders: reminders.results,
    recentNotes: notes.results,
  };
}
