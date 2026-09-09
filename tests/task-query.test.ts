import { describe, expect, it } from "vitest";
import { createSqliteDb } from "./helpers/sqlite-db";
import { cancelTask, completeTask, listTasks, updateTaskTitle } from "../src/modules/tasks/repository";

function seedTasks() {
  const { db, sqlite } = createSqliteDb();
  sqlite.exec("INSERT INTO users (id, telegram_user_id, telegram_chat_id, created_at) VALUES (1, 42, 42, '2026-09-09T10:00:00.000Z')");
  sqlite.exec("INSERT INTO tasks (id, user_id, title, status, created_at) VALUES (1, 1, 'pendiente uno', 'pending', '2026-09-09T10:01:00.000Z')");
  sqlite.exec("INSERT INTO tasks (id, user_id, title, status, completed_at, created_at) VALUES (2, 1, 'terminada', 'done', '2026-09-09T10:02:00.000Z', '2026-09-09T10:02:00.000Z')");
  sqlite.exec("INSERT INTO tasks (id, user_id, title, status, cancelled_at, created_at) VALUES (3, 1, 'cancelada', 'pending', '2026-09-09T10:03:00.000Z', '2026-09-09T10:03:00.000Z')");
  sqlite.exec("INSERT INTO tasks (id, user_id, title, status, created_at) VALUES (4, 1, 'pendiente dos', 'pending', '2026-09-09T10:04:00.000Z')");
  return { db, sqlite };
}

describe("task queries and actions", () => {
  it("filters statuses and returns a stable cursor", async () => {
    const { db } = seedTasks();

    const pending = await listTasks(db, { userId: 1, filter: "pending", limit: 1 });
    const next = await listTasks(db, { userId: 1, filter: "pending", beforeId: pending.nextBeforeId, limit: 1 });

    expect(pending.tasks).toMatchObject([{ id: 4, title: "pendiente dos", status: "pending" }]);
    expect(pending.nextBeforeId).toBe(4);
    expect(next.tasks).toMatchObject([{ id: 1, title: "pendiente uno", status: "pending" }]);
    expect(next.nextBeforeId).toBeUndefined();
  });

  it("completes, cancels, and edits only the user's pending task", async () => {
    const { db } = seedTasks();

    expect(await completeTask(db, { userId: 1, taskId: 1, completedAt: "2026-09-09T11:00:00.000Z" })).toBe(true);
    expect(await cancelTask(db, { userId: 1, taskId: 4, cancelledAt: "2026-09-09T11:01:00.000Z" })).toBe(true);
    expect(await updateTaskTitle(db, { userId: 1, taskId: 2, title: "no debe cambiar" })).toBe(false);

    const all = await listTasks(db, { userId: 1, filter: "all", limit: 10 });
    expect(all.tasks).toMatchObject([
      { id: 4, status: "cancelled" },
      { id: 3, status: "cancelled" },
      { id: 2, status: "completed", title: "terminada" },
      { id: 1, status: "completed" },
    ]);
  });
});
