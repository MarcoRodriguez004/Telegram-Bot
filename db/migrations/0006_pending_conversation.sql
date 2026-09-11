CREATE TABLE IF NOT EXISTS pending_conversation (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('task', 'reminder')),
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_conversation_expiry ON pending_conversation(expires_at);
