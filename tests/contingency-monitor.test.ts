import { describe, expect, it, vi } from "vitest";
import { ensureUser } from "../src/db/users";
import { monitorContingency } from "../src/modules/contingency/monitor";
import { fetchLatestContingencyBulletin } from "../src/modules/contingency/source";
import type { Env } from "../src/types";
import { createSqliteDb } from "./helpers/sqlite-db";

vi.mock("../src/modules/contingency/source", () => ({
  fetchLatestContingencyBulletin: vi.fn(),
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
  it("delivers the default always alert to every user", async () => {
    const { db } = createSqliteDb();
    await ensureUser(db, {
      telegramUserId: 101,
      telegramChatId: 1001,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });
    await ensureUser(db, {
      telegramUserId: 202,
      telegramChatId: 2002,
      timezone: "America/Mexico_City",
      currency: "MXN",
    });
    vi.mocked(fetchLatestContingencyBulletin).mockResolvedValue({
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
      new Date("2026-09-13T04:45:00.000Z"),
      fetch,
      telegramFetch,
    );

    expect(messages.map((message) => message.chatId)).toEqual([1001, 2002]);
    expect(messages[0]?.text).toContain("Se activó la Fase I");
    expect(messages[0]?.text).toContain("Día de afectación: domingo, 26 de abril de 2026.");
  });
});
