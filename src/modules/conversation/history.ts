export type ConversationTurnRole = "user" | "assistant";

export interface ConversationTurn {
  role: ConversationTurnRole;
  content: string;
  createdAt: string;
}

export interface SaveConversationTurnInput {
  userId: number;
  chatId: number;
  role: ConversationTurnRole;
  content: string;
  now?: Date;
}

export const CONVERSATION_HISTORY_TURN_LIMIT = 12;
export const CONVERSATION_HISTORY_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TURN_CONTENT_LENGTH = 4_000;

export async function saveConversationTurn(
  db: D1Database,
  input: SaveConversationTurnInput,
): Promise<void> {
  assertScope(input.userId, input.chatId);
  assertRole(input.role);
  const content = normalizeContent(input.content);
  const now = input.now ?? new Date();
  assertDate(now);
  const expiresAt = new Date(now.getTime() + CONVERSATION_HISTORY_TTL_MS).toISOString();

  await db.batch([
    db.prepare("DELETE FROM conversation_history WHERE user_id = ? AND chat_id = ? AND expires_at <= ?")
      .bind(input.userId, input.chatId, now.toISOString()),
    db.prepare(
      "INSERT INTO conversation_history (user_id, chat_id, role, content, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(input.userId, input.chatId, input.role, content, now.toISOString(), expiresAt),
    db.prepare(
      "DELETE FROM conversation_history WHERE user_id = ? AND chat_id = ? AND id NOT IN (SELECT id FROM conversation_history WHERE user_id = ? AND chat_id = ? ORDER BY id DESC LIMIT ?)",
    ).bind(input.userId, input.chatId, input.userId, input.chatId, CONVERSATION_HISTORY_TURN_LIMIT),
  ]);
}

export async function getConversationHistory(
  db: D1Database,
  input: { userId: number; chatId: number; now?: Date },
): Promise<ConversationTurn[]> {
  assertScope(input.userId, input.chatId);
  const now = input.now ?? new Date();
  assertDate(now);
  await db.prepare(
    "DELETE FROM conversation_history WHERE user_id = ? AND chat_id = ? AND expires_at <= ?",
  ).bind(input.userId, input.chatId, now.toISOString()).run();

  const result = await db.prepare(
    "SELECT role, content, created_at AS createdAt FROM conversation_history WHERE user_id = ? AND chat_id = ? ORDER BY id DESC LIMIT ?",
  ).bind(input.userId, input.chatId, CONVERSATION_HISTORY_TURN_LIMIT).all<{ role: string; content: string; createdAt: string }>();

  return result.results.reverse().filter((row): row is { role: ConversationTurnRole; content: string; createdAt: string } =>
    (row.role === "user" || row.role === "assistant") && Boolean(row.content) && Boolean(row.createdAt),
  );
}

export async function clearConversationHistory(db: D1Database, userId: number): Promise<void> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("Conversation history user id is invalid");
  await db.prepare("DELETE FROM conversation_history WHERE user_id = ?").bind(userId).run();
}

function normalizeContent(value: string): string {
  const content = value.trim().replace(/\s+/g, " ");
  if (!content || content.length > MAX_TURN_CONTENT_LENGTH) throw new Error("Conversation turn content is invalid");
  return content;
}

function assertScope(userId: number, chatId: number): void {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("Conversation history user id is invalid");
  if (!Number.isInteger(chatId)) throw new Error("Conversation history chat id is invalid");
}

function assertRole(role: string): asserts role is ConversationTurnRole {
  if (role !== "user" && role !== "assistant") throw new Error("Conversation turn role is invalid");
}

function assertDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) throw new Error("Conversation history timestamp is invalid");
}
