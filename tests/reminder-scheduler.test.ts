import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { processDueReminders } from "../src/modules/reminders/scheduler";

type StoredReminder = {
  id: number;
  userId: number;
  chatId: number;
  title: string;
  remindAt: string;
  status: "pending" | "processing" | "sent";
  processingUntil: string | null;
};

function createDb(initialStatus: StoredReminder["status"] = "pending") {
  const reminders: StoredReminder[] = [
    {
      id: 1,
      userId: 1,
      chatId: 42,
      title: "pagar internet",
      remindAt: "2026-09-07T20:00:00.000Z",
      status: initialStatus,
      processingUntil: null,
    },
  ];

  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (!query.startsWith("SELECT reminders.id")) return null;
              const reminder = reminders.find(
                (item) =>
                  new Date(item.remindAt).getTime() <= new Date(String(values[0])).getTime() &&
                  (item.status === "pending" ||
                    (item.status === "processing" && item.processingUntil !== null && item.processingUntil <= String(values[1]))),
              );
              return reminder
                ? ({ id: reminder.id, userId: reminder.userId, chatId: reminder.chatId, title: reminder.title } as T)
                : null;
            },
            async run() {
              const id = Number(values.length === 1 ? values[0] : values[1]);
              const reminder = reminders.find((item) => item.id === id);
              if (!reminder) return { success: true, meta: { changes: 0 } };

              if (query.startsWith("UPDATE reminders SET status = 'processing'")) {
                const claimable =
                  reminder.status === "pending" ||
                  (reminder.status === "processing" && reminder.processingUntil !== null && reminder.processingUntil <= String(values[3]));
                if (!claimable) return { success: true, meta: { changes: 0 } };
                reminder.status = "processing";
                reminder.processingUntil = String(values[0]);
                return { success: true, meta: { changes: 1 } };
              }

              if (query.startsWith("UPDATE reminders SET status = 'sent'")) {
                reminder.status = "sent";
                reminder.processingUntil = null;
                return { success: true, meta: { changes: 1 } };
              }

              if (query.startsWith("UPDATE reminders SET status = 'pending'")) {
                reminder.status = "pending";
                reminder.processingUntil = null;
                return { success: true, meta: { changes: 1 } };
              }

              return { success: true, meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };

  return { db: db as unknown as D1Database, reminders };
}

function createEnv() {
  const sentMessages: Array<{ chat_id: number; text: string }> = [];
  const env: Env = {
    PERSONAL_ASSISTANT_DB: {} as D1Database,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    TELEGRAM_ALLOWED_USER_ID: "42",
    APP_TIMEZONE: "America/Mexico_City",
    DEFAULT_CURRENCY: "MXN",
  };
  return { env, sentMessages };
}

describe("reminder scheduler", () => {
  it("claims, sends, and marks a due reminder as sent", async () => {
    const { db, reminders } = createDb();
    const { env, sentMessages } = createEnv();
    const telegramFetch: typeof fetch = async (_input, init) => {
      sentMessages.push(JSON.parse(String(init?.body)) as { chat_id: number; text: string });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };

    const sent = await processDueReminders(db, env, new Date("2026-09-07T20:01:00.000Z"), telegramFetch);

    expect(sent).toBe(1);
    expect(reminders[0].status).toBe("sent");
    expect(sentMessages).toEqual([{ chat_id: 42, text: "⏰ Recordatorio\n\npagar internet" }]);
  });

  it("releases a reminder for a later retry when Telegram fails", async () => {
    const { db, reminders } = createDb();
    const { env } = createEnv();
    const telegramFetch: typeof fetch = async () => new Response("telegram down", { status: 503 });

    const sent = await processDueReminders(db, env, new Date("2026-09-07T20:01:00.000Z"), telegramFetch);

    expect(sent).toBe(0);
    expect(reminders[0].status).toBe("pending");
    expect(reminders[0].processingUntil).toBeNull();
  });
});
