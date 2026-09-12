import { describe, expect, it } from "vitest";
import { getBotStatus, searchUserData } from "../src/modules/status/repository";
import { exportUserData } from "../src/modules/export/repository";
import { createSqliteDb } from "./helpers/sqlite-db";

function seedUsers(sqlite: ReturnType<typeof createSqliteDb>["sqlite"]): void {
  sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(42, 42, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
  sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(99, 99, "America/Mexico_City", "MXN", "2026-09-10T15:00:00.000Z");
}

describe("status, search and export", () => {
  it("returns a bounded global search scoped to one user", async () => {
    const { db, sqlite } = createSqliteDb();
    seedUsers(sqlite);
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "comprar tornillos", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(2, "comprar tornillos de otra persona", "2026-09-10T15:01:00.000Z");
    sqlite.prepare("INSERT INTO notes (user_id, content, url, created_at) VALUES (?, ?, ?, ?)")
      .run(1, "Manual de tornillos", null, "2026-09-10T15:02:00.000Z");

    const results = await searchUserData(db, { userId: 1, query: "tornillos" });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.kind)).toEqual(["note", "task"]);
    expect(results.every((result) => !result.preview.includes("otra persona"))).toBe(true);
  });

  it("reports pending work and logical storage without exposing another user", async () => {
    const { db, sqlite } = createSqliteDb();
    seedUsers(sqlite);
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "revisar contrato", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO reminders (user_id, title, remind_at, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(1, "llamar al banco", "2026-09-10T16:00:00.000Z", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(2, "dato privado", "2026-09-10T15:00:00.000Z");

    const status = await getBotStatus(db, { userId: 1, now: "2026-09-10T15:30:00.000Z" });

    expect(status.pendingTaskCount).toBe(1);
    expect(status.upcomingReminders[0].title).toBe("llamar al banco");
    expect(status.logicalStorageBytes).toBeGreaterThan(0);
  });

  it("exports only user-owned data and no credentials", async () => {
    const { db, sqlite } = createSqliteDb();
    seedUsers(sqlite);
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(1, "exportar mis datos", "2026-09-10T15:00:00.000Z");
    sqlite.prepare("INSERT INTO notes (user_id, content, file_kind, file_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(1, "INE", "photo", "photo_file_id", "2026-09-10T15:01:00.000Z");
    sqlite.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(2, "no exportar", "2026-09-10T15:00:00.000Z");

    const exported = await exportUserData(db, { userId: 1, generatedAt: "2026-09-10T15:02:00.000Z" });
    const json = JSON.stringify(exported);

    expect(json).toContain("exportar mis datos");
    expect(json).toContain("photo_file_id");
    expect(json).not.toContain("no exportar");
    expect(json).not.toContain("TELEGRAM_BOT_TOKEN");
    expect(exported.notes[0].fileId).toBe("photo_file_id");
  });
});
