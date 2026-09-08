export interface EnsureUserInput {
  telegramUserId: number;
  telegramChatId: number;
  timezone: string;
  currency: string;
  createdAt?: string;
}

export async function ensureUser(db: D1Database, input: EnsureUserInput): Promise<number> {
  if (!Number.isInteger(input.telegramUserId) || !Number.isInteger(input.telegramChatId)) {
    throw new Error("Telegram user or chat id is invalid");
  }

  await db
    .prepare(
      "INSERT OR IGNORE INTO users (telegram_user_id, telegram_chat_id, timezone, currency, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      input.telegramUserId,
      input.telegramChatId,
      input.timezone,
      input.currency,
      input.createdAt ?? new Date().toISOString(),
    )
    .run();

  await db
    .prepare("UPDATE users SET telegram_chat_id = ?, timezone = ?, currency = ? WHERE telegram_user_id = ?")
    .bind(input.telegramChatId, input.timezone, input.currency, input.telegramUserId)
    .run();

  const user = await db
    .prepare("SELECT id FROM users WHERE telegram_user_id = ?")
    .bind(input.telegramUserId)
    .first<{ id: number }>();

  if (!user) {
    throw new Error("User could not be created");
  }

  return user.id;
}
