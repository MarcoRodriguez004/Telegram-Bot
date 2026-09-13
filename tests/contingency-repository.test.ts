import { describe, expect, it } from "vitest";
import { ensureUser } from "../src/db/users";
import {
  getContingencyPreferences,
  listContingencyRecipients,
  listVehicles,
  registerVehicle,
  setContingencyMode,
} from "../src/modules/contingency/repository";
import { createSqliteDb } from "./helpers/sqlite-db";

describe("contingency preferences and vehicles", () => {
  it("keeps vehicles isolated per user and matches only the configured restriction", async () => {
    const { db } = createSqliteDb();
    const firstUser = await ensureUser(db, {
      telegramUserId: 101,
      telegramChatId: 1001,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });
    const secondUser = await ensureUser(db, {
      telegramUserId: 202,
      telegramChatId: 2002,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });

    await registerVehicle(db, { userId: firstUser, label: "familiar", hologram: "0", plateLastDigit: 6 });
    await registerVehicle(db, { userId: secondUser, hologram: "00", plateLastDigit: 8 });
    await setContingencyMode(db, { userId: firstUser, mode: "vehicle" });
    await setContingencyMode(db, { userId: secondUser, mode: "always" });

    expect((await listVehicles(db, firstUser)).map((vehicle) => vehicle.label)).toEqual(["familiar"]);
    expect((await listVehicles(db, secondUser)).map((vehicle) => vehicle.plateLastDigit)).toEqual([8]);

    const matchingRecipients = await listContingencyRecipients(db, {
      holograms: ["0", "00"],
      plateLastDigits: [6, 7],
    });
    expect(matchingRecipients.map((recipient) => recipient.chatId)).toEqual([1001, 2002]);

    const unknownDigitsRecipients = await listContingencyRecipients(db, {
      holograms: ["0", "00"],
      plateLastDigits: [],
    });
    expect(unknownDigitsRecipients.map((recipient) => recipient.chatId)).toEqual([2002]);

    const ownerOnlyRecipients = await listContingencyRecipients(db, {
      holograms: ["0", "00"],
      plateLastDigits: [6, 7],
    }, 101);
    expect(ownerOnlyRecipients.map((recipient) => recipient.chatId)).toEqual([1001]);
  });

  it("keeps contingency alerts off until the user opts in", async () => {
    const { db } = createSqliteDb();
    const userId = await ensureUser(db, {
      telegramUserId: 303,
      telegramChatId: 3003,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });

    await expect(getContingencyPreferences(db, userId)).resolves.toMatchObject({
      mode: "always",
      enabled: false,
    });
    await expect(listContingencyRecipients(db, {
      holograms: ["0", "00"],
      plateLastDigits: [5, 6],
    })).resolves.toEqual([]);

    await setContingencyMode(db, { userId, mode: "always" });
    await expect(listContingencyRecipients(db, {
      holograms: ["0", "00"],
      plateLastDigits: [5, 6],
    })).resolves.toMatchObject([{ userId, chatId: 3003, mode: "always" }]);
  });
});
