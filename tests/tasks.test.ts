import { describe, expect, it } from "vitest";
import { createTask } from "../src/modules/tasks/repository";

function createDb() {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          calls.push({ query, values });
          return {
            async run() {
              return { success: true, meta: { changes: 1, last_row_id: 7 } };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

describe("task repository", () => {
  it("creates a pending task and returns its id", async () => {
    const { db, calls } = createDb();

    const taskId = await createTask(db, {
      userId: 3,
      title: "comprar medicina",
      createdAt: "2026-09-07T20:00:00.000Z",
    });

    expect(taskId).toBe(7);
    expect(calls[0]).toEqual({
      query: "INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)",
      values: [3, "comprar medicina", "2026-09-07T20:00:00.000Z"],
    });
  });

  it("stores an optional due date for a scheduled task", async () => {
    const { db, calls } = createDb();

    await createTask(db, {
      userId: 3,
      title: "pagar la luz",
      dueAt: "2026-09-12T00:00:00.000Z",
      createdAt: "2026-09-10T15:00:00.000Z",
    });

    expect(calls[0]).toEqual({
      query: "INSERT INTO tasks (user_id, title, status, due_at, created_at) VALUES (?, ?, 'pending', ?, ?)",
      values: [3, "pagar la luz", "2026-09-12T00:00:00.000Z", "2026-09-10T15:00:00.000Z"],
    });
  });

  it("rejects empty or oversized titles before touching the database", async () => {
    const { db, calls } = createDb();

    await expect(createTask(db, { userId: 3, title: "  " })).rejects.toThrow("Task title is required");
    await expect(createTask(db, { userId: 3, title: "x".repeat(501) })).rejects.toThrow("Task title is too long");
    expect(calls).toHaveLength(0);
  });
});
