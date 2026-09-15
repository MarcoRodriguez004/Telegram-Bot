import { describe, expect, it } from "vitest";
import { ensureWhatsAppUser, claimWhatsAppMessage } from "../src/whatsapp/identity";
import { createSqliteDb } from "./helpers/sqlite-db";

const env = {
  WHATSAPP_ALLOWED_USER_ID: "525500000000",
  TELEGRAM_ADMIN_USER_ID: "42",
  APP_TIMEZONE: "America/Mexico_City",
  DEFAULT_CURRENCY: "MXN",
};

describe("WhatsApp identity", () => {
  it("links the configured WhatsApp sender to the existing owner", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(42, 42, env.APP_TIMEZONE, env.DEFAULT_CURRENCY, new Date().toISOString());

    const userId = await ensureWhatsAppUser(db, env, "525500000000");

    expect(userId).toBe(1);
    expect(sqlite.prepare("SELECT whatsapp_user_id FROM users WHERE id = 1").get()).toEqual({ whatsapp_user_id: "525500000000" });
  });

  it("does not mutate the database for a sender that is not allowlisted", async () => {
    const { db, sqlite } = createSqliteDb();
    sqlite.prepare("INSERT INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(42, 42, env.APP_TIMEZONE, env.DEFAULT_CURRENCY, new Date().toISOString());

    await expect(ensureWhatsAppUser(db, env, "525511111111")).resolves.toBeNull();
    expect(sqlite.prepare("SELECT whatsapp_user_id FROM users WHERE id = 1").get()).toEqual({ whatsapp_user_id: null });
  });

  it("claims each inbound message ID only once", async () => {
    const { db } = createSqliteDb();

    await expect(claimWhatsAppMessage(db, "wamid.in")).resolves.toBe(true);
    await expect(claimWhatsAppMessage(db, "wamid.in")).resolves.toBe(false);
  });
});
