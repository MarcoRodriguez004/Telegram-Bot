export interface UserStorageUsage {
  telegramUserId: number;
  logicalBytes: number;
}

interface UserStorageUsageRow {
  telegramUserId: number;
  logicalBytes: number;
}

// This is a logical estimate of user-owned D1 data. It counts UTF-8 bytes for
// text and fixed-width estimates for SQLite numeric values; Telegram-hosted
// file contents are intentionally not counted because they are not in D1.
export const USER_STORAGE_USAGE_QUERY = `/* user-storage-accounting */
WITH owned_bytes AS (
  SELECT user_id,
    64 + 16
      + length(CAST(COALESCE(title, '') AS BLOB))
      + length(CAST(COALESCE(status, '') AS BLOB))
      + length(CAST(COALESCE(due_at, '') AS BLOB))
      + length(CAST(COALESCE(created_at, '') AS BLOB))
      + length(CAST(COALESCE(completed_at, '') AS BLOB))
      + length(CAST(COALESCE(cancelled_at, '') AS BLOB)) AS logical_bytes
  FROM tasks
  UNION ALL
  SELECT user_id,
    64 + 16
      + length(CAST(COALESCE(title, '') AS BLOB))
      + length(CAST(COALESCE(remind_at, '') AS BLOB))
      + length(CAST(COALESCE(status, '') AS BLOB))
      + length(CAST(COALESCE(processing_until, '') AS BLOB))
      + length(CAST(COALESCE(sent_at, '') AS BLOB))
      + length(CAST(COALESCE(created_at, '') AS BLOB))
      + length(CAST(COALESCE(cancelled_at, '') AS BLOB)) AS logical_bytes
  FROM reminders
  UNION ALL
  SELECT user_id,
    64 + 24
      + length(CAST(COALESCE(currency, '') AS BLOB))
      + length(CAST(COALESCE(category, '') AS BLOB))
      + length(CAST(COALESCE(description, '') AS BLOB))
      + length(CAST(COALESCE(occurred_at, '') AS BLOB))
      + length(CAST(COALESCE(created_at, '') AS BLOB)) AS logical_bytes
  FROM expenses
  UNION ALL
  SELECT user_id,
    64 + 16
      + length(CAST(COALESCE(content, '') AS BLOB))
      + length(CAST(COALESCE(url, '') AS BLOB))
      + length(CAST(COALESCE(file_kind, '') AS BLOB))
      + length(CAST(COALESCE(file_id, '') AS BLOB))
      + length(CAST(COALESCE(created_at, '') AS BLOB)) AS logical_bytes
  FROM notes
  UNION ALL
  SELECT user_id,
    48 + 16
      + length(CAST(COALESCE(resource_type, '') AS BLOB))
      + length(CAST(COALESCE(expires_at, '') AS BLOB))
      + length(CAST(COALESCE(created_at, '') AS BLOB)) AS logical_bytes
  FROM edit_sessions
  UNION ALL
  SELECT user_id,
    56 + 24
      + length(CAST(COALESCE(context_type, '') AS BLOB))
      + length(CAST(COALESCE(note_kind, '') AS BLOB))
      + length(CAST(COALESCE(updated_at, '') AS BLOB))
      + length(CAST(COALESCE(expires_at, '') AS BLOB)) AS logical_bytes
  FROM conversation_context
  UNION ALL
  SELECT user_id,
    48 + 16
      + length(CAST(COALESCE(updated_at, '') AS BLOB)) AS logical_bytes
  FROM notification_preferences
  UNION ALL
  SELECT user_id,
    72 + 32
      + length(CAST(COALESCE(resource_type, '') AS BLOB))
      + length(CAST(COALESCE(next_notify_at, '') AS BLOB))
      + length(CAST(COALESCE(processing_until, '') AS BLOB))
      + length(CAST(COALESCE(last_notified_at, '') AS BLOB))
      + length(CAST(COALESCE(created_at, '') AS BLOB)) AS logical_bytes
  FROM persistent_notifications
  UNION ALL
  SELECT user_id,
    48 + 16
      + length(CAST(COALESCE(resource_type, '') AS BLOB))
      + length(CAST(COALESCE(updated_at, '') AS BLOB))
      + length(CAST(COALESCE(expires_at, '') AS BLOB)) AS logical_bytes
  FROM pending_conversation
  UNION ALL
  SELECT user_id,
    64 + 16
      + length(CAST(COALESCE(question, '') AS BLOB))
      + length(CAST(COALESCE(suggested_text, '') AS BLOB))
      + length(CAST(COALESCE(created_at, '') AS BLOB))
      + length(CAST(COALESCE(expires_at, '') AS BLOB)) AS logical_bytes
  FROM conversation_confirmations
  UNION ALL
  SELECT users.id,
    40 + 16 + length(CAST(COALESCE(processed_updates.processed_at, '') AS BLOB)) AS logical_bytes
  FROM processed_updates
  INNER JOIN users ON users.telegram_user_id = processed_updates.telegram_user_id
)
SELECT users.telegram_user_id AS telegramUserId,
  CAST(
    64 + 16
      + length(CAST(COALESCE(users.timezone, '') AS BLOB))
      + length(CAST(COALESCE(users.currency, '') AS BLOB))
      + length(CAST(COALESCE(users.created_at, '') AS BLOB))
      + COALESCE(SUM(owned_bytes.logical_bytes), 0)
    AS INTEGER
  ) AS logicalBytes
FROM users
LEFT JOIN owned_bytes ON owned_bytes.user_id = users.id
GROUP BY users.id, users.telegram_user_id
ORDER BY logicalBytes DESC, users.telegram_user_id ASC
`;

export async function calculateUserStorageUsage(db: D1Database): Promise<UserStorageUsage[]> {
  const result = await db.prepare(USER_STORAGE_USAGE_QUERY).all<UserStorageUsageRow>();
  return result.results
    .filter((row) => Number.isSafeInteger(row.telegramUserId) && row.telegramUserId > 0)
    .map((row) => ({
      telegramUserId: row.telegramUserId,
      logicalBytes: normalizeLogicalBytes(row.logicalBytes),
    }));
}

function normalizeLogicalBytes(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
