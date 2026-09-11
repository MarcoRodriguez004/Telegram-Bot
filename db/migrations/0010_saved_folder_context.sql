CREATE TABLE conversation_context_new (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL,
  context_type TEXT NOT NULL CHECK (context_type IN ('saved_notes')),
  note_kind TEXT NOT NULL CHECK (note_kind IN ('all', 'photos', 'documents', 'links')),
  folder_id INTEGER,
  next_before_id INTEGER,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

INSERT INTO conversation_context_new
  (user_id, chat_id, context_type, note_kind, folder_id, next_before_id, updated_at, expires_at)
SELECT user_id, chat_id, context_type, note_kind, NULL, next_before_id, updated_at, expires_at
FROM conversation_context;

DROP TABLE conversation_context;
ALTER TABLE conversation_context_new RENAME TO conversation_context;

CREATE INDEX IF NOT EXISTS idx_conversation_context_expiry ON conversation_context(expires_at);
