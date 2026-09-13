export type BroadcastConfirmationStep = 1 | 2 | 3;

export type BroadcastConfirmation = {
  chatId: number;
  messageText: string;
  step: BroadcastConfirmationStep;
};

export type BroadcastDestination = {
  userId: number;
  chatId: number;
};

const BROADCAST_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const MAX_BROADCAST_MESSAGE_LENGTH = 3_500;

export async function startBroadcastConfirmation(
  db: D1Database,
  input: { telegramUserId: number; chatId: number; messageText: string; now?: Date },
): Promise<void> {
  assertIdentifiers(input.telegramUserId, input.chatId);
  assertMessage(input.messageText);
  const now = input.now ?? new Date();
  assertDate(now);
  await db.prepare(
    "INSERT INTO broadcast_confirmations (telegram_user_id, chat_id, message_text, step, expires_at) VALUES (?, ?, ?, 1, ?) " +
      "ON CONFLICT(telegram_user_id) DO UPDATE SET chat_id = excluded.chat_id, message_text = excluded.message_text, step = 1, expires_at = excluded.expires_at",
  ).bind(
    input.telegramUserId,
    input.chatId,
    input.messageText,
    new Date(now.getTime() + BROADCAST_CONFIRMATION_TTL_MS).toISOString(),
  ).run();
}

export async function getBroadcastConfirmation(
  db: D1Database,
  input: { telegramUserId: number; chatId: number; now?: Date },
): Promise<BroadcastConfirmation | null> {
  assertIdentifiers(input.telegramUserId, input.chatId);
  const now = input.now ?? new Date();
  assertDate(now);
  const row = await db.prepare(
    "SELECT chat_id, message_text, step, expires_at FROM broadcast_confirmations WHERE telegram_user_id = ? AND chat_id = ?",
  ).bind(input.telegramUserId, input.chatId).first<{ chat_id: number; message_text: string; step: number; expires_at: string }>();
  if (!row) return null;
  if (!isValidStep(row.step) || !row.message_text || !Number.isFinite(new Date(row.expires_at).getTime()) || new Date(row.expires_at).getTime() <= now.getTime()) {
    await clearBroadcastConfirmation(db, input.telegramUserId);
    return null;
  }
  return { chatId: row.chat_id, messageText: row.message_text, step: row.step };
}

export async function advanceBroadcastConfirmation(
  db: D1Database,
  input: { telegramUserId: number; chatId: number; expectedStep: 1 | 2; now?: Date },
): Promise<boolean> {
  assertIdentifiers(input.telegramUserId, input.chatId);
  const now = input.now ?? new Date();
  assertDate(now);
  const nextStep: BroadcastConfirmationStep = input.expectedStep === 1 ? 2 : 3;
  const result = await db.prepare(
    "UPDATE broadcast_confirmations SET step = ?, expires_at = ? WHERE telegram_user_id = ? AND chat_id = ? AND step = ? AND expires_at > ?",
  ).bind(
    nextStep,
    new Date(now.getTime() + BROADCAST_CONFIRMATION_TTL_MS).toISOString(),
    input.telegramUserId,
    input.chatId,
    input.expectedStep,
    now.toISOString(),
  ).run();
  return result.meta.changes === 1;
}

export async function clearBroadcastConfirmation(db: D1Database, telegramUserId: number): Promise<void> {
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId < 1) throw new Error("Telegram user id is invalid");
  await db.prepare("DELETE FROM broadcast_confirmations WHERE telegram_user_id = ?").bind(telegramUserId).run();
}

export async function listBroadcastDestinations(db: D1Database): Promise<BroadcastDestination[]> {
  const rows = await db.prepare(
    "SELECT id AS userId, telegram_chat_id AS chatId FROM users WHERE telegram_chat_id IS NOT NULL ORDER BY id",
  ).all<{ userId: number; chatId: number }>();
  const destinations = new Map<number, BroadcastDestination>();
  for (const row of rows.results) {
    const userId = Number(row.userId);
    const chatId = Number(row.chatId);
    if (Number.isSafeInteger(userId) && userId > 0 && Number.isSafeInteger(chatId) && chatId !== 0) {
      destinations.set(chatId, { userId, chatId });
    }
  }
  return [...destinations.values()];
}

export function validateBroadcastMessage(messageText: string): boolean {
  try {
    assertMessage(messageText);
    return true;
  } catch {
    return false;
  }
}

function assertIdentifiers(telegramUserId: number, chatId: number): void {
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId < 1) throw new Error("Telegram user id is invalid");
  if (!Number.isInteger(chatId) || chatId === 0) throw new Error("Chat id is invalid");
}

function assertMessage(messageText: string): void {
  if (!messageText.trim() || messageText.length > MAX_BROADCAST_MESSAGE_LENGTH) throw new Error("Broadcast message is invalid");
}

function assertDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) throw new Error("Broadcast timestamp is invalid");
}

function isValidStep(value: number): value is BroadcastConfirmationStep {
  return value === 1 || value === 2 || value === 3;
}
