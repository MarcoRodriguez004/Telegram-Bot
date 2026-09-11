import { afterEach, describe, expect, it } from "vitest";
import { ensureUser } from "../src/db/users";
import { deleteUserData } from "../src/modules/privacy/repository";
import {
  clearPendingConfirmation,
  clearPendingListContext,
  getPendingConfirmation,
  getPendingListContext,
  getSavedNotesContext,
  savePendingConfirmation,
  savePendingListContext,
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
  it("keeps a confirmation suggestion for the same chat and expires it", async () => {
    const { db, userId } = await setup();
    const question = "¿Quieres consultar tu lista de pendientes?";
    const suggestedText = "mis tareas";

    await savePendingConfirmation(db, {
      userId,
      chatId: 42,
      question,
      suggestedText,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    await expect(getPendingConfirmation(db, {
      userId,
      chatId: 42,
      now: new Date("2026-09-09T00:05:00.000Z"),
    })).resolves.toEqual({
      question,
      suggestedText,
    });
    await expect(getPendingConfirmation(db, {
      userId,
      chatId: 42,
      now: new Date("2026-09-09T00:16:00.000Z"),
    })).resolves.toBeNull();
    await clearPendingConfirmation(db, userId);
  });

  it("keeps a pending task list query for the same chat and expires it", async () => {
    const { db, userId } = await setup();

    await savePendingListContext(db, {
      userId,
      chatId: 42,
      resource: "task",
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    await expect(getPendingListContext(db, {
      userId,
      chatId: 42,
      now: new Date("2026-09-09T00:05:00.000Z"),
    })).resolves.toEqual({ resource: "task" });
    await expect(getPendingListContext(db, {
      userId,
      chatId: 42,
      now: new Date("2026-09-09T00:16:00.000Z"),
    })).resolves.toBeNull();
  });

  it("does not leak a pending query across chats", async () => {
    const { db, userId } = await setup();
    await savePendingListContext(db, { userId, chatId: 42, resource: "reminder" });

    await expect(getPendingListContext(db, { userId, chatId: 99 })).resolves.toBeNull();
    await clearPendingListContext(db, userId);
  });

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

  it("removes the context with the rest of the user's data", async () => {
    const { db, userId, sqlite } = await setup();
    await saveSavedNotesContext(db, { userId, chatId: 42, kind: "photos" });
    await savePendingListContext(db, { userId, chatId: 42, resource: "task" });
    await savePendingConfirmation(db, {
      userId,
      chatId: 42,
      question: "¿Quisiste decir tareas?",
      suggestedText: "mis tareas",
    });

    await deleteUserData(db, 42);

    expect(sqlite.prepare("SELECT * FROM conversation_context").all()).toHaveLength(0);
    expect(sqlite.prepare("SELECT * FROM pending_conversation").all()).toHaveLength(0);
    expect(sqlite.prepare("SELECT * FROM conversation_confirmations").all()).toHaveLength(0);
    await expect(getSavedNotesContext(db, { userId, chatId: 42 })).resolves.toBeNull();
  });
});
