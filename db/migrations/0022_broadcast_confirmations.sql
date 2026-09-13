CREATE TABLE IF NOT EXISTS broadcast_confirmations (
  telegram_user_id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  message_text TEXT NOT NULL,
  step INTEGER NOT NULL CHECK (step IN (1, 2, 3)),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_confirmations_expiry ON broadcast_confirmations(expires_at);
