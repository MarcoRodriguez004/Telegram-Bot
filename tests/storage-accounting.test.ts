import { describe, expect, it } from "vitest";
import { calculateUserStorageUsage } from "../src/modules/storage/accounting";
import { createSqliteDb } from "./helpers/sqlite-db";

describe("per-user storage accounting", () => {
  it("calculates logical bytes separately and orders users by usage", async () => {
    const { db, sqlite } = createSqliteDb();

    sqlite.prepare(
      "INSERT INTO users (id, telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(1, 42, 42, "America/Mexico_City", "MXN", "2026-09-10T10:00:00.000Z");
    sqlite.prepare(
      "INSERT INTO users (id, telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(2, 99, 99, "America/Mexico_City", "MXN", "2026-09-10T10:00:00.000Z");
    sqlite.prepare(
      "INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)",
    ).run(1, "x".repeat(200), "2026-09-10T10:00:00.000Z");
    sqlite.prepare(
      "INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'pending', ?)",
    ).run(2, "corta", "2026-09-10T10:00:00.000Z");

    const usage = await calculateUserStorageUsage(db);

    expect(usage).toHaveLength(2);
    expect(usage[0].telegramUserId).toBe(42);
    expect(usage[0].logicalBytes).toBeGreaterThan(usage[1].logicalBytes);
    expect(usage.every((entry) => entry.logicalBytes > 0)).toBe(true);
  });
});
