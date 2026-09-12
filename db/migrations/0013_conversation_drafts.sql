CREATE TABLE IF NOT EXISTS conversation_drafts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL,
  flow TEXT NOT NULL CHECK (flow IN ('task', 'reminder', 'expense')),
  missing TEXT NOT NULL CHECK (missing IN ('title', 'time', 'amount', 'category')),
  base_text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (user_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_drafts_expiry ON conversation_drafts(expires_at);
