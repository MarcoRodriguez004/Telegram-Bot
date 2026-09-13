import { describe, expect, it, vi } from "vitest";
import { ensureUser } from "../src/db/users";
import { monitorContingency } from "../src/modules/contingency/monitor";
import { setContingencyMode } from "../src/modules/contingency/repository";
import { fetchCombinedContingencyBulletin } from "../src/modules/contingency/combined";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

vi.mock("../src/modules/contingency/combined", () => ({
  fetchCombinedContingencyBulletin: vi.fn(),
}));

function createEnv(db: D1Database): Env {
  return {
    PERSONAL_ASSISTANT_DB: db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_ADMIN_USER_ID: "999",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
}

describe("contingency monitor", () => {
  it("does not fetch CAMe between the 30-minute checks", async () => {
    const { db } = createSqliteDb();

    await expect(monitorContingency(
      db,
      createEnv(db),
      new Date("2026-09-13T04:15:00.000Z"),
      fetch,
      fetch,
    )).resolves.toBe(false);
    expect(fetchCombinedContingencyBulletin).not.toHaveBeenCalled();
  });

  it("delivers an alert to users who opted into the always mode", async () => {
    const { db } = createSqliteDb();
    await ensureUser(db, {
      telegramUserId: 101,
      telegramChatId: 1001,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });
    await setContingencyMode(db, { userId: 1, mode: "always" });
    await ensureUser(db, {
      telegramUserId: 202,
      telegramChatId: 2002,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });
    await setContingencyMode(db, { userId: 2, mode: "always" });
    vi.mocked(fetchCombinedContingencyBulletin).mockResolvedValue({
      bulletin: {
        active: true,
        phase: "I",
        affectedDate: "2026-04-26",
        restriction: {
          holograms: ["0", "00"],
          plateLastDigits: [5, 6],
          color: "amarillo",
          text: "Hologramas 0 y 00 deben suspender su circulación.",
          signature: "restriction-1",
        },
        sourceUrl: "https://aire.cdmx.gob.mx/comunicado.pdf",
        publishedAt: "2026-09-13T04:00:00.000Z",
      },
      camE: null,
      gobMx: null,
      gobMxError: null,
    });
    const messages: Array<{ chatId: number; text: string }> = [];
    const telegramFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string };
      messages.push({ chatId: body.chat_id, text: body.text });
      return Response.json({ ok: true });
    };

    await monitorContingency(
      db,
      createEnv(db),
      new Date("2026-09-13T04:30:00.000Z"),
      fetch,
      telegramFetch,
    );

    expect(messages.map((message) => message.chatId)).toEqual([1001, 2002]);
    expect(messages[0]?.text).toContain("Se activó la Fase I");
    expect(messages[0]?.text).toContain("Día de afectación: domingo, 26 de abril de 2026.");
    expect(messages[0]?.text).toContain("Boletín publicado:");
  });

  it("notifies the same recipients when CAMe suspends an active contingency", async () => {
    const { db } = createSqliteDb();
    await ensureUser(db, {
      telegramUserId: 101,
      telegramChatId: 1001,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });
    await setContingencyMode(db, { userId: 1, mode: "always" });
    vi.mocked(fetchCombinedContingencyBulletin)
      .mockResolvedValueOnce({
        bulletin: {
          active: true,
          phase: "I",
          affectedDate: "2026-09-14",
          restriction: {
            holograms: ["0", "00"],
            plateLastDigits: [7, 8],
            color: "rosa",
            text: "Hologramas 0 y 00 deben suspender su circulación.",
            signature: "restriction-rosa-7-8",
          },
          sourceUrl: "https://aire.cdmx.gob.mx/comunicado43.pdf",
          publishedAt: "2026-09-13T12:17:00.000Z",
        },
        camE: null,
        gobMx: null,
        gobMxError: null,
      })
      .mockResolvedValueOnce({
        bulletin: {
          active: false,
          phase: "I",
          affectedDate: "2026-09-14",
          restriction: null,
          sourceUrl: "https://aire.cdmx.gob.mx/comunicado44.pdf",
          publishedAt: "2026-09-13T21:00:00.000Z",
        },
        camE: null,
        gobMx: null,
        gobMxError: null,
      });
    const messages: Array<{ chatId: number; text: string }> = [];
    const telegramFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string };
      messages.push({ chatId: body.chat_id, text: body.text });
      return Response.json({ ok: true });
    };

    await monitorContingency(db, createEnv(db), new Date("2026-09-13T12:30:00.000Z"), fetch, telegramFetch);
    await monitorContingency(db, createEnv(db), new Date("2026-09-13T21:30:00.000Z"), fetch, telegramFetch);

    expect(messages).toHaveLength(2);
    expect(messages[1]?.chatId).toBe(1001);
    expect(messages[1]?.text).toContain("se suspendió la Fase I de contingencia ambiental");
    expect(messages[1]?.text).toContain("Día de suspensión: domingo, 13 de septiembre de 2026.");
    expect(messages[1]?.text).toContain("Boletín publicado:");
  });
});
