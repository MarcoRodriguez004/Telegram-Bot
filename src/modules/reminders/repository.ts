export interface CreateReminderInput {
  userId: number;
  title: string;
  remindAt: string;
  createdAt?: string;
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
