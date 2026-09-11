import { describe, expect, it } from "vitest";
import {
  getNotificationPreferences,
  getPersistentNotification,
  setNotificationDefaults,
  setPersistentNotification,
} from "../src/modules/notifications/repository";
import { createSqliteDb } from "./helpers/sqlite-db";

describe("persistent notification repository", () => {
  it("stores an interval, disables it without losing the interval, and reactivates it", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "pagar la luz", "2026-09-10T15:00:00.000Z");

    await setPersistentNotification(db, {
      userId: 1,
      resourceType: "task",
      resourceId: 1,
      intervalMinutes: 10,
      nextNotifyAt: "2026-09-10T15:10:00.000Z",
      now: "2026-09-10T15:00:00.000Z",
    });
    expect(await getPersistentNotification(db, 1, "task", 1)).toMatchObject({
      enabled: true,
      intervalMinutes: 10,
      nextNotifyAt: "2026-09-10T15:10:00.000Z",
    });

    await setPersistentNotification(db, {
      userId: 1,
      resourceType: "task",
      resourceId: 1,
      intervalMinutes: null,
      now: "2026-09-10T15:05:00.000Z",
    });
    expect(await getPersistentNotification(db, 1, "task", 1)).toMatchObject({
      enabled: false,
      intervalMinutes: 10,
      nextNotifyAt: null,
    });

    await setPersistentNotification(db, {
      userId: 1,
      resourceType: "task",
      resourceId: 1,
      intervalMinutes: 10,
      nextNotifyAt: "2026-09-10T15:15:00.000Z",
      now: "2026-09-10T15:05:00.000Z",
    });
    expect(await getPersistentNotification(db, 1, "task", 1)).toMatchObject({
      enabled: true,
      intervalMinutes: 10,
      nextNotifyAt: "2026-09-10T15:15:00.000Z",
    });
  });

  it("applies a global setting to pending existing items and future defaults", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "revisar contrato", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO reminders (user_id, title, remind_at, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(1, "llamar al banco", "2026-09-10T16:00:00.000Z", "2026-09-10T15:00:00.000Z");

    await setNotificationDefaults(db, {
      userId: 1,
      scope: "all",
      enabled: true,
      intervalMinutes: 5,
      now: "2026-09-10T15:00:00.000Z",
    });

    expect(await getNotificationPreferences(db, 1)).toMatchObject({
      tasksEnabled: true,
      tasksIntervalMinutes: 5,
      remindersEnabled: true,
      remindersIntervalMinutes: 5,
    });
    expect(await getPersistentNotification(db, 1, "task", 1)).toMatchObject({
      enabled: true,
      intervalMinutes: 5,
      nextNotifyAt: "2026-09-10T15:00:00.000Z",
    });
    expect(await getPersistentNotification(db, 1, "reminder", 1)).toMatchObject({
      enabled: true,
      nextNotifyAt: "2026-09-10T16:00:00.000Z",
    });

    await setNotificationDefaults(db, {
      userId: 1,
      scope: "all",
      enabled: false,
      now: "2026-09-10T15:01:00.000Z",
    });
    expect(await getNotificationPreferences(db, 1)).toMatchObject({ tasksEnabled: false, remindersEnabled: false });
    expect(await getPersistentNotification(db, 1, "task", 1)).toMatchObject({ enabled: false, nextNotifyAt: null });
    expect(await getPersistentNotification(db, 1, "reminder", 1)).toMatchObject({ enabled: false, nextNotifyAt: null });
  });
});
