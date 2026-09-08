export async function claimUpdate(db: D1Database, updateId: number, telegramUserId: number): Promise<boolean> {
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO processed_updates (update_id, telegram_user_id, processed_at) VALUES (?, ?, ?)",
    )
    .bind(updateId, telegramUserId, new Date().toISOString())
    .run();

  return result.meta.changes === 1;
}
