import { describe, expect, it } from "vitest";
import {
  advanceBroadcastConfirmation,
  clearBroadcastConfirmation,
  getBroadcastConfirmation,
  listBroadcastDestinations,
  startBroadcastConfirmation,
} from "../src/modules/broadcast/repository";
import { createSqliteDb } from "./helpers/sqlite-db";

describe("broadcast repository", () => {
  it("keeps a three-step confirmation with a ten-minute expiry", async () => {
    const { db } = createSqliteDb();
    const now = new Date("2026-09-13T20:00:00.000Z");

    await startBroadcastConfirmation(db, { telegramUserId: 42, chatId: 420, messageText: "Aviso de prueba", now });
    await expect(getBroadcastConfirmation(db, { telegramUserId: 42, chatId: 420, now })).resolves.toMatchObject({ step: 1, messageText: "Aviso de prueba" });
    await expect(advanceBroadcastConfirmation(db, { telegramUserId: 42, chatId: 420, expectedStep: 1, now })).resolves.toBe(true);
    await expect(getBroadcastConfirmation(db, { telegramUserId: 42, chatId: 420, now })).resolves.toMatchObject({ step: 2 });
    await expect(getBroadcastConfirmation(db, { telegramUserId: 42, chatId: 420, now: new Date("2026-09-13T20:10:01.000Z") })).resolves.toBeNull();
  });

  it("deduplicates known chat destinations", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, created_at) VALUES (42, 420, '2026-09-13T20:00:00.000Z'), (43, 420, '2026-09-13T20:00:00.000Z'), (44, 440, '2026-09-13T20:00:00.000Z')").run();

    await expect(listBroadcastDestinations(db)).resolves.toEqual([
      { userId: 2, chatId: 420 },
      { userId: 3, chatId: 440 },
    ]);
  });

  it("clears a pending confirmation", async () => {
    const { db } = createSqliteDb();
    await startBroadcastConfirmation(db, { telegramUserId: 42, chatId: 420, messageText: "Aviso" });
    await clearBroadcastConfirmation(db, 42);
    await expect(getBroadcastConfirmation(db, { telegramUserId: 42, chatId: 420 })).resolves.toBeNull();
  });
});
