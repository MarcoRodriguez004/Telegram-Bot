export interface CreateTaskInput {
  userId: number;
  title: string;
  createdAt?: string;
}

export async function createTask(db: D1Database, input: CreateTaskInput): Promise<number> {
  if (!Number.isInteger(input.userId) || input.userId < 1) {
    throw new Error("User id is invalid");
  }

  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) {
    throw new Error("Task title is required");
  }
  if (title.length > 500) {
    throw new Error("Task title is too long");
  }

  const result = await db
    .prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
    .bind(input.userId, title, input.createdAt ?? new Date().toISOString())
    .run();

  return result.meta.last_row_id;
}
