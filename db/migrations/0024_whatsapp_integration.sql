ALTER TABLE users ADD COLUMN whatsapp_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_whatsapp_user_id
  ON users(whatsapp_user_id)
  WHERE whatsapp_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS processed_whatsapp_messages (
  message_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
