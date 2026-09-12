type GlobalResetStep = 1 | 2 | 3;

export type GlobalResetConfirmation = {
  chatId: number;
  step: GlobalResetStep;
};

const GLOBAL_RESET_TTL_MS = 10 * 60 * 1000;

export async function startGlobalResetConfirmation(
  db: D1Database,
  input: { telegramUserId: number; chatId: number; now?: Date },
): Promise<void> {
  assertIdentifiers(input.telegramUserId, input.chatId);
  const now = input.now ?? new Date();
  assertDate(now);
  await db.prepare(
    "INSERT INTO database_reset_confirmations (telegram_user_id, chat_id, step, expires_at) VALUES (?, ?, 1, ?) " +
      "ON CONFLICT(telegram_user_id) DO UPDATE SET chat_id = excluded.chat_id, step = 1, expires_at = excluded.expires_at",
  ).bind(input.telegramUserId, input.chatId, new Date(now.getTime() + GLOBAL_RESET_TTL_MS).toISOString()).run();
}

export async function getGlobalResetConfirmation(
  db: D1Database,
  input: { telegramUserId: number; chatId: number; now?: Date },
): Promise<GlobalResetConfirmation | null> {
  assertIdentifiers(input.telegramUserId, input.chatId);
  const now = input.now ?? new Date();
  assertDate(now);
  const row = await db.prepare(
    "SELECT chat_id, step, expires_at FROM database_reset_confirmations WHERE telegram_user_id = ? AND chat_id = ?",
  ).bind(input.telegramUserId, input.chatId).first<{ chat_id: number; step: number; expires_at: string }>();
  if (!row) return null;
  if (!isValidStep(row.step) || !Number.isFinite(new Date(row.expires_at).getTime()) || new Date(row.expires_at).getTime() <= now.getTime()) {
    await clearGlobalResetConfirmation(db, input.telegramUserId);
    return null;
  }
  return { chatId: row.chat_id, step: row.step };
}

export async function advanceGlobalResetConfirmation(
  db: D1Database,
  input: { telegramUserId: number; chatId: number; expectedStep: 1 | 2; now?: Date },
): Promise<boolean> {
  assertIdentifiers(input.telegramUserId, input.chatId);
  const now = input.now ?? new Date();
  assertDate(now);
  const nextStep: GlobalResetStep = input.expectedStep === 1 ? 2 : 3;
  const result = await db.prepare(
    "UPDATE database_reset_confirmations SET step = ?, expires_at = ? WHERE telegram_user_id = ? AND chat_id = ? AND step = ? AND expires_at > ?",
  ).bind(
    nextStep,
    new Date(now.getTime() + GLOBAL_RESET_TTL_MS).toISOString(),
    input.telegramUserId,
    input.chatId,
    input.expectedStep,
    now.toISOString(),
  ).run();
  return result.meta.changes === 1;
}

export async function clearGlobalResetConfirmation(db: D1Database, telegramUserId: number): Promise<void> {
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId < 1) throw new Error("Telegram user id is invalid");
  await db.prepare("DELETE FROM database_reset_confirmations WHERE telegram_user_id = ?").bind(telegramUserId).run();
}

export async function deleteAllData(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM pending_folder_saves"),
    db.prepare("DELETE FROM persistent_notifications"),
    db.prepare("DELETE FROM notification_preferences"),
    db.prepare("DELETE FROM edit_sessions"),
    db.prepare("DELETE FROM conversation_context"),
    db.prepare("DELETE FROM pending_conversation"),
    db.prepare("DELETE FROM conversation_drafts"),
    db.prepare("DELETE FROM conversation_confirmations"),
    db.prepare("DELETE FROM notes"),
    db.prepare("DELETE FROM saved_folders"),
    db.prepare("DELETE FROM tasks"),
    db.prepare("DELETE FROM reminders"),
    db.prepare("DELETE FROM expenses"),
    db.prepare("DELETE FROM database_reset_confirmations"),
    db.prepare("DELETE FROM storage_status"),
    db.prepare("DELETE FROM processed_updates"),
    db.prepare("DELETE FROM users"),
  ]);
}

function assertIdentifiers(telegramUserId: number, chatId: number): void {
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId < 1) throw new Error("Telegram user id is invalid");
  if (!Number.isInteger(chatId)) throw new Error("Chat id is invalid");
}

function assertDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) throw new Error("Reset timestamp is invalid");
}

function isValidStep(value: number): value is GlobalResetStep {
  return value === 1 || value === 2 || value === 3;
}
