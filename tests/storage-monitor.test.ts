import { describe, expect, it } from "vitest";
import { monitorDatabaseStorage, STORAGE_LIMIT_BYTES } from "../src/modules/storage/monitor";
import type { Env } from "../src/types";

function createStorageDb(sizeBytes: number) {
  let overLimit = false;
  const messages: Array<{ chatId: number; text: string }> = [];
  const db = {
    prepare(query: string) {
      const createStatement = (values: unknown[] = []) => ({
        async run() {
          if (query.startsWith("INSERT INTO storage_status")) overLimit = Number(values[1]) === 1;
          return { success: true, meta: { changes: 1, size_after: sizeBytes } };
        },
        async first<T>() {
          if (query.startsWith("SELECT over_limit")) return { overLimit: overLimit ? 1 : 0 } as T;
          return null;
        },
        async all<T>() {
          return { results: [{ telegramUserId: 42, chatId: 42 }, { telegramUserId: 99, chatId: 99 }] } as D1Result<T>;
        },
        bind(...nextValues: unknown[]) {
          return createStatement(nextValues);
        },
      });
      return createStatement();
    },
    messages,
  };
  return db as unknown as D1Database & { messages: typeof messages };
}

function env(db: D1Database): Env {
  return {
    PERSONAL_ASSISTANT_DB: db,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_ALLOWED_USER_ID: "42",
    TELEGRAM_ADMIN_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
}

describe("D1 storage monitor", () => {
  it("alerts users and the configured admin once when the threshold is crossed", async () => {
    const database = createStorageDb(STORAGE_LIMIT_BYTES);
    const telegramFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string };
      database.messages.push({ chatId: body.chat_id, text: body.text });
      return Response.json({ ok: true });
    };

    await monitorDatabaseStorage(database, env(database), new Date("2026-09-10T10:00:00.000Z"), telegramFetch);
    await monitorDatabaseStorage(database, env(database), new Date("2026-09-10T10:01:00.000Z"), telegramFetch);

    expect(database.messages).toHaveLength(2);
    expect(database.messages.find((message) => message.chatId === 99)?.text).toContain("150 MB");
    expect(database.messages.find((message) => message.chatId === 42)?.text).toContain("99");
  });
});
