CREATE TABLE IF NOT EXISTS conversation_confirmations (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  suggested_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_confirmations_expiry ON conversation_confirmations(expires_at);
