CREATE TABLE IF NOT EXISTS conversation_context (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL,
  context_type TEXT NOT NULL CHECK (context_type IN ('saved_notes')),
  note_kind TEXT NOT NULL CHECK (note_kind IN ('all', 'photos', 'documents')),
  next_before_id INTEGER,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_context_expiry ON conversation_context(expires_at);
