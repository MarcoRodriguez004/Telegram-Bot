import { describe, expect, it } from "vitest";
import { createSqliteDb } from "./helpers/sqlite-db";
import { clearEditSession, getActiveEditSession, startEditSession } from "../src/modules/edit-sessions/repository";

describe("temporary edit sessions", () => {
  it("stores and retrieves the selected record until expiry", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.exec("INSERT INTO users (id, telegram_user_id, telegram_chat_id, created_at) VALUES (1, 42, 42, '2026-09-09T10:00:00.000Z')");

    await startEditSession(db, {
      userId: 1,
      chatId: 42,
      resourceType: "task",
      resourceId: 7,
      expiresAt: "2026-09-09T10:15:00.000Z",
      createdAt: "2026-09-09T10:00:00.000Z",
    });

    await expect(getActiveEditSession(db, 1, "2026-09-09T10:14:00.000Z")).resolves.toEqual({
      userId: 1,
      chatId: 42,
      resourceType: "task",
      resourceId: 7,
      expiresAt: "2026-09-09T10:15:00.000Z",
    });
    await expect(getActiveEditSession(db, 1, "2026-09-09T10:15:00.000Z")).resolves.toBeNull();
  });

  it("replaces one user's session and can clear it", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.exec("INSERT INTO users (id, telegram_user_id, telegram_chat_id, created_at) VALUES (1, 42, 42, '2026-09-09T10:00:00.000Z')");

    await startEditSession(db, { userId: 1, chatId: 42, resourceType: "task", resourceId: 1, expiresAt: "2026-09-09T10:15:00.000Z" });
    await startEditSession(db, { userId: 1, chatId: 42, resourceType: "reminder", resourceId: 2, expiresAt: "2026-09-09T10:20:00.000Z" });
    await clearEditSession(db, 1);

    await expect(getActiveEditSession(db, 1, "2026-09-09T10:10:00.000Z")).resolves.toBeNull();
  });
});
