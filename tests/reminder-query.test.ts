import { describe, expect, it } from "vitest";
import { createSqliteDb } from "./helpers/sqlite-db";
import { cancelReminder, completeReminder, listReminders, updateReminder } from "../src/modules/reminders/repository";

function seedReminders() {
  const { db, sqlite } = createSqliteDb();
  sqlite.exec("INSERT INTO users (id, telegram_user_id, telegram_chat_id, created_at) VALUES (1, 42, 42, '2026-09-09T10:00:00.000Z')");
  sqlite.exec("INSERT INTO reminders (id, user_id, title, remind_at, status, created_at) VALUES (1, 1, 'pendiente uno', '2026-09-10T10:00:00.000Z', 'pending', '2026-09-09T10:01:00.000Z')");
  sqlite.exec("INSERT INTO reminders (id, user_id, title, remind_at, status, sent_at, created_at) VALUES (2, 1, 'completado', '2026-09-09T09:00:00.000Z', 'sent', '2026-09-09T09:00:00.000Z', '2026-09-09T10:02:00.000Z')");
  sqlite.exec("INSERT INTO reminders (id, user_id, title, remind_at, status, cancelled_at, created_at) VALUES (3, 1, 'cancelado', '2026-09-10T11:00:00.000Z', 'pending', '2026-09-09T10:03:00.000Z', '2026-09-09T10:03:00.000Z')");
  return { db, sqlite };
}

describe("reminder queries and actions", () => {
  it("filters pending, completed, and cancelled reminders", async () => {
    const { db } = seedReminders();

    await expect(listReminders(db, { userId: 1, filter: "pending" })).resolves.toMatchObject({
      reminders: [{ id: 1, title: "pendiente uno", status: "pending" }],
    });
    await expect(listReminders(db, { userId: 1, filter: "completed" })).resolves.toMatchObject({
      reminders: [{ id: 2, title: "completado", status: "completed" }],
    });
    await expect(listReminders(db, { userId: 1, filter: "cancelled" })).resolves.toMatchObject({
      reminders: [{ id: 3, title: "cancelado", status: "cancelled" }],
    });
  });

  it("completes, cancels, and edits only pending reminders", async () => {
    const { db } = seedReminders();

    expect(await completeReminder(db, { userId: 1, reminderId: 1, completedAt: "2026-09-09T11:00:00.000Z" })).toBe(true);
    expect(await cancelReminder(db, { userId: 1, reminderId: 3, cancelledAt: "2026-09-09T11:01:00.000Z" })).toBe(false);
    expect(await updateReminder(db, {
      userId: 1,
      reminderId: 1,
      title: "nuevo título",
      remindAt: "2026-09-11T10:00:00.000Z",
    })).toBe(false);
  });
});
