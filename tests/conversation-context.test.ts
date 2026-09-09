import { afterEach, describe, expect, it } from "vitest";
import { ensureUser } from "../src/db/users";
import {
  getSavedNotesContext,
  saveSavedNotesContext,
} from "../src/modules/conversation/repository";
import { createSqliteDb } from "./helpers/sqlite-db";

const databases: ReturnType<typeof createSqliteDb>[] = [];
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); });

async function setup() {
  const database = createSqliteDb();
  databases.push(database);
  const userId = await ensureUser(database.db, {
    telegramUserId: 42,
    telegramChatId: 42,
    timezone: "America/Mexico_City",
    currency: "MXN",
    createdAt: "2026-09-09T00:00:00.000Z",
  });
  return { ...database, userId };
}

describe("conversation context", () => {
  it("keeps the latest saved-notes query for the same chat", async () => {
    const { db, userId } = await setup();

    await saveSavedNotesContext(db, {
      userId,
      chatId: 42,
      kind: "photos",
      nextBeforeId: 17,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    await expect(getSavedNotesContext(db, {
      userId,
      chatId: 42,
      now: new Date("2026-09-09T00:05:00.000Z"),
    })).resolves.toEqual({ kind: "photos", nextBeforeId: 17 });
  });

  it("does not leak context across chats and expires it", async () => {
    const { db, userId } = await setup();
    await saveSavedNotesContext(db, {
      userId,
      chatId: 42,
      kind: "photos",
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    await expect(getSavedNotesContext(db, {
      userId,
      chatId: 99,
      now: new Date("2026-09-09T00:05:00.000Z"),
    })).resolves.toBeNull();
    await expect(getSavedNotesContext(db, {
      userId,
      chatId: 42,
      now: new Date("2026-09-09T00:16:00.000Z"),
    })).resolves.toBeNull();
  });
});
