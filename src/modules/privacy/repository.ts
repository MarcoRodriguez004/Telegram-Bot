export async function deleteUserData(db: D1Database, telegramUserId: number): Promise<void> {
  if (!Number.isInteger(telegramUserId)) {
    throw new Error("Telegram user id is invalid");
  }

  const user = await db
    .prepare("SELECT id FROM users WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .first<{ id: number }>();

  if (!user) {
    return;
  }

  if (!Number.isInteger(user.id)) {
    throw new Error("Stored user id is invalid");
  }

  await db.batch([
    db.prepare("DELETE FROM tasks WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM reminders WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM expenses WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM notes WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM edit_sessions WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM conversation_context WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
}
