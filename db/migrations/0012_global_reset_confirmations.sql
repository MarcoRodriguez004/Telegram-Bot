CREATE TABLE IF NOT EXISTS database_reset_confirmations (
  telegram_user_id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  step INTEGER NOT NULL CHECK (step IN (1, 2, 3)),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_database_reset_confirmations_expiry ON database_reset_confirmations(expires_at);
