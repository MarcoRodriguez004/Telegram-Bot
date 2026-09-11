import { disablePersistentNotification } from "../notifications/repository";

export interface CreateTaskInput {
  userId: number;
  title: string;
  dueAt?: string | null;
  createdAt?: string;
}

export type TaskFilter = "pending" | "completed" | "cancelled" | "all";

export interface TaskListItem {
  id: number;
  title: string;
  status: "pending" | "completed" | "cancelled";
  dueAt: string | null;
  createdAt: string;
}

export interface ListTasksInput {
  userId: number;
  filter: TaskFilter;
  beforeId?: number;
  limit?: number;
}

export interface CompleteTaskInput {
  userId: number;
  taskId: number;
  completedAt?: string;
}

export interface CancelTaskInput {
  userId: number;
  taskId: number;
  cancelledAt?: string;
}

export interface UpdateTaskTitleInput {
  userId: number;
  taskId: number;
  title: string;
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

  const createdAt = input.createdAt ?? new Date().toISOString();
  const dueAt = input.dueAt === undefined || input.dueAt === null ? null : new Date(input.dueAt);
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new Error("Task due date is invalid");

  const result = dueAt
    ? await db
      .prepare("INSERT INTO tasks (user_id, title, status, due_at, created_at) VALUES (?, ?, 'pending', ?, ?)")
      .bind(input.userId, title, dueAt.toISOString(), createdAt)
      .run()
    : await db
      .prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .bind(input.userId, title, createdAt)
      .run();

  return result.meta.last_row_id;
}

export async function listTasks(db: D1Database, input: ListTasksInput): Promise<{ tasks: TaskListItem[]; nextBeforeId?: number }> {
  validateUserId(input.userId);
  validateFilter(input.filter);
  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Task list limit is invalid");
  if (input.beforeId !== undefined && (!Number.isSafeInteger(input.beforeId) || input.beforeId < 1)) {
    throw new Error("Task cursor is invalid");
  }

  const conditions = ["user_id = ?"];
  const values: Array<number | string> = [input.userId];
  if (input.filter === "pending") conditions.push("status = 'pending' AND cancelled_at IS NULL");
  if (input.filter === "completed") conditions.push("status = 'done' AND cancelled_at IS NULL");
  if (input.filter === "cancelled") conditions.push("cancelled_at IS NOT NULL");
  conditions.push("id < ?");
  values.push(input.beforeId ?? Number.MAX_SAFE_INTEGER);

  const result = await db.prepare(
    `SELECT id, title, CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN status = 'done' THEN 'completed' ELSE 'pending' END AS status, due_at AS dueAt, created_at AS createdAt FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT ?`,
  ).bind(...values, limit + 1).all<TaskListItem>();

  const tasks = result.results.slice(0, limit);
  return { tasks, nextBeforeId: result.results.length > limit ? tasks.at(-1)?.id : undefined };
}

export async function getTask(db: D1Database, userId: number, taskId: number): Promise<TaskListItem | null> {
  validateUserId(userId);
  validateRecordId(taskId, "Task");
  return db.prepare(
    "SELECT id, title, CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN status = 'done' THEN 'completed' ELSE 'pending' END AS status, due_at AS dueAt, created_at AS createdAt FROM tasks WHERE user_id = ? AND id = ?",
  ).bind(userId, taskId).first<TaskListItem>();
}

export async function completeTask(db: D1Database, input: CompleteTaskInput): Promise<boolean> {
  validateUserId(input.userId);
  validateRecordId(input.taskId, "Task");
  const result = await db.prepare(
    "UPDATE tasks SET status = 'done', completed_at = ?, cancelled_at = NULL WHERE user_id = ? AND id = ? AND status = 'pending' AND cancelled_at IS NULL",
  ).bind(input.completedAt ?? new Date().toISOString(), input.userId, input.taskId).run();
  if (result.meta.changes === 1) await disablePersistentNotification(db, input.userId, "task", input.taskId);
  return result.meta.changes === 1;
}

export async function cancelTask(db: D1Database, input: CancelTaskInput): Promise<boolean> {
  validateUserId(input.userId);
  validateRecordId(input.taskId, "Task");
  const result = await db.prepare(
    "UPDATE tasks SET cancelled_at = ?, completed_at = NULL WHERE user_id = ? AND id = ? AND status = 'pending' AND cancelled_at IS NULL",
  ).bind(input.cancelledAt ?? new Date().toISOString(), input.userId, input.taskId).run();
  if (result.meta.changes === 1) await disablePersistentNotification(db, input.userId, "task", input.taskId);
  return result.meta.changes === 1;
}

export async function updateTaskTitle(db: D1Database, input: UpdateTaskTitleInput): Promise<boolean> {
  validateUserId(input.userId);
  validateRecordId(input.taskId, "Task");
  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) throw new Error("Task title is required");
  if (title.length > 500) throw new Error("Task title is too long");
  const result = await db.prepare(
    "UPDATE tasks SET title = ? WHERE user_id = ? AND id = ? AND status = 'pending' AND cancelled_at IS NULL",
  ).bind(title, input.userId, input.taskId).run();
  return result.meta.changes === 1;
}

function validateUserId(userId: number): void {
  if (!Number.isInteger(userId) || userId < 1) throw new Error("User id is invalid");
}

function validateRecordId(id: number, label: string): void {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${label} id is invalid`);
}

function validateFilter(filter: TaskFilter): void {
  if (filter !== "pending" && filter !== "completed" && filter !== "cancelled" && filter !== "all") {
    throw new Error("Task filter is invalid");
  }
}
