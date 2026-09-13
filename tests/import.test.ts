import { describe, expect, it } from "vitest";
import { importUserData } from "../src/modules/export/import";
import { createSqliteDb } from "./helpers/sqlite-db";
import type { ExportData } from "../src/modules/export/repository";

describe("JSON data import", () => {
  it("restores records with remapped folders and notification references", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
    const data: ExportData = {
      exportedAt: "2026-09-10T16:00:00.000Z",
      user: { telegramUserId: 99, timezone: "America/Mexico_City", currency: "MXN", createdAt: "2026-09-01T00:00:00.000Z" },
      folders: [{ id: 7, name: "Documentos personales", createdAt: "2026-09-01T00:00:00.000Z" }],
      tasks: [{ id: 3, title: "Comprar tornillos", status: "pending", dueAt: null, recurrenceRule: null, createdAt: "2026-09-02T00:00:00.000Z", completedAt: null, cancelledAt: null }],
      reminders: [{ id: 8, title: "Llamar al banco", remindAt: "2026-09-12T18:00:00.000Z", status: "pending", recurrenceRule: null, createdAt: "2026-09-02T00:00:00.000Z", sentAt: null, cancelledAt: null }],
      expenses: [{ id: 9, amountCents: 12500, currency: "MXN", category: "ferretería", description: "Tornillos", occurredAt: "2026-09-02T00:00:00.000Z", createdAt: "2026-09-02T00:00:00.000Z" }],
      notes: [{ id: 10, content: "INE", url: null, folderId: 7, fileKind: "document", fileId: "Ag123_file" , createdAt: "2026-09-02T00:00:00.000Z" }],
      notificationDefaults: { tasksEnabled: true, tasksIntervalMinutes: 10, remindersEnabled: false, remindersIntervalMinutes: 60 },
      persistentNotifications: [{ resourceType: "task", resourceId: 3, enabled: true, intervalMinutes: 10, nextNotifyAt: "2026-09-12T18:00:00.000Z", lastNotifiedAt: null, createdAt: "2026-09-02T00:00:00.000Z" }],
    };

    const result = await importUserData(db, { userId: 1, data, importedAt: "2026-09-12T00:00:00.000Z" });

    expect(result).toMatchObject({ alreadyImported: false, folders: 1, tasks: 1, reminders: 1, expenses: 1, notes: 1, persistentNotifications: 1 });
    expect(sqlite.prepare("SELECT name FROM saved_folders WHERE user_id = 1").get()).toEqual({ name: "Documentos personales" });
    expect(sqlite.prepare("SELECT title FROM tasks WHERE user_id = 1").get()).toEqual({ title: "Comprar tornillos" });
    expect(sqlite.prepare("SELECT folder_id FROM notes WHERE user_id = 1").get()).toEqual({ folder_id: 1 });
    expect(sqlite.prepare("SELECT resource_type, resource_id, interval_minutes FROM persistent_notifications WHERE user_id = 1").get())
      .toEqual({ resource_type: "task", resource_id: 1, interval_minutes: 10 });

    await expect(importUserData(db, { userId: 1, data, importedAt: "2026-09-12T00:05:00.000Z" })).resolves.toEqual({ alreadyImported: true });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id = 1").get()).toEqual({ count: 1 });
  });

  it("rejects malformed exports before writing data", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare(
      "INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");

    await expect(importUserData(db, { userId: 1, data: { exportedAt: "not-a-date" } })).rejects.toThrow("Export date is invalid");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM data_imports").get()).toEqual({ count: 0 });
  });
});
