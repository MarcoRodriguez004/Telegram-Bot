import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";
import { createSqliteDb } from "./helpers/sqlite-db";
import { completeReminder, setReminderRecurrence } from "../src/modules/reminders/repository";
import { completeTask, setTaskRecurrence } from "../src/modules/tasks/repository";

describe("recurring tasks and reminders", () => {
  it("parses a recurrence command without exposing database details", () => {
    expect(parseIntent("repite tarea 7 cada semana")).toEqual({
      action: "set_recurrence",
      resource: "task",
      resourceId: 7,
      recurrenceRule: "weekly",
    });
    expect(parseIntent("repite recordatorio 9 cada mes")).toEqual({
      action: "set_recurrence",
      resource: "reminder",
      resourceId: 9,
      recurrenceRule: "monthly",
    });
    expect(parseIntent("repite tarea 7 nunca")).toEqual({
      action: "set_recurrence",
      resource: "task",
      resourceId: 7,
      recurrenceRule: null,
    });
  });

  it("creates the next task when a recurring task is completed", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, due_at, created_at, recurrence_rule) VALUES (?, ?, 'pending', ?, ?, ?)")
      .run(1, "limpiar taller", "2026-09-10T15:00:00.000Z", "2026-09-09T15:00:00.000Z", "weekly");

    expect(await completeTask(db, { userId: 1, taskId: 1, completedAt: "2026-09-10T15:05:00.000Z", timeZone: "America/Mexico_City" })).toBe(true);
    expect(sqlite.prepare("SELECT title, status, due_at, recurrence_rule FROM tasks ORDER BY id").all()).toEqual([
      { title: "limpiar taller", status: "done", due_at: "2026-09-10T15:00:00.000Z", recurrence_rule: "weekly" },
      { title: "limpiar taller", status: "pending", due_at: "2026-09-17T15:00:00.000Z", recurrence_rule: "weekly" },
    ]);
  });

  it("creates the next reminder when a recurring reminder is completed", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO reminders (user_id, title, remind_at, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(1, "pagar internet", "2026-09-10T15:00:00.000Z", "2026-09-09T15:00:00.000Z");
    expect(await setReminderRecurrence(db, { userId: 1, reminderId: 1, recurrenceRule: "daily" })).toBe(true);

    expect(await completeReminder(db, { userId: 1, reminderId: 1, completedAt: "2026-09-10T15:05:00.000Z", timeZone: "America/Mexico_City" })).toBe(true);
    expect(sqlite.prepare("SELECT title, status, remind_at, recurrence_rule FROM reminders ORDER BY id").all()).toEqual([
      { title: "pagar internet", status: "sent", remind_at: "2026-09-10T15:00:00.000Z", recurrence_rule: "daily" },
      { title: "pagar internet", status: "pending", remind_at: "2026-09-11T15:00:00.000Z", recurrence_rule: "daily" },
    ]);
  });

  it("can assign and remove recurrence only from pending records", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "revisar contrato", "2026-09-10T15:00:00.000Z");
    expect(await setTaskRecurrence(db, { userId: 1, taskId: 1, recurrenceRule: "monthly" })).toBe(true);
    expect(await setTaskRecurrence(db, { userId: 1, taskId: 1, recurrenceRule: null })).toBe(true);
    expect(sqlite.prepare("SELECT recurrence_rule FROM tasks WHERE id = 1").get()).toEqual({ recurrence_rule: null });
  });
});
