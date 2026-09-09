export type EditResourceType = "task" | "reminder";

export interface EditSession {
  userId: number;
  chatId: number;
  resourceType: EditResourceType;
  resourceId: number;
  expiresAt: string;
}

export interface StartEditSessionInput extends EditSession {
  createdAt?: string;
}

export async function startEditSession(db: D1Database, input: StartEditSessionInput): Promise<void> {
  validateUserId(input.userId);
  validateRecordId(input.resourceId);
  if (!Number.isInteger(input.chatId)) throw new Error("Chat id is invalid");
  if (input.resourceType !== "task" && input.resourceType !== "reminder") throw new Error("Edit resource is invalid");
  if (Number.isNaN(new Date(input.expiresAt).getTime())) throw new Error("Edit expiry is invalid");

  await db.prepare(
    "INSERT INTO edit_sessions (user_id, chat_id, resource_type, resource_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, resource_type = excluded.resource_type, resource_id = excluded.resource_id, expires_at = excluded.expires_at, created_at = excluded.created_at",
  ).bind(
    input.userId,
    input.chatId,
    input.resourceType,
    input.resourceId,
    new Date(input.expiresAt).toISOString(),
    input.createdAt ?? new Date().toISOString(),
  ).run();
}

export async function getActiveEditSession(db: D1Database, userId: number, now = new Date().toISOString()): Promise<EditSession | null> {
  validateUserId(userId);
  const session = await db.prepare(
    "SELECT user_id AS userId, chat_id AS chatId, resource_type AS resourceType, resource_id AS resourceId, expires_at AS expiresAt FROM edit_sessions WHERE user_id = ? AND expires_at > ?",
  ).bind(userId, now).first<EditSession>();
  return session ?? null;
}

export async function clearEditSession(db: D1Database, userId: number): Promise<void> {
  validateUserId(userId);
  await db.prepare("DELETE FROM edit_sessions WHERE user_id = ?").bind(userId).run();
}

function validateUserId(userId: number): void {
  if (!Number.isInteger(userId) || userId < 1) throw new Error("User id is invalid");
}

function validateRecordId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Edit record id is invalid");
}
