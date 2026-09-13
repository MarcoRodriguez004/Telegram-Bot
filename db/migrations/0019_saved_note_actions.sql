CREATE TABLE edit_sessions_v2 (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  chat_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('task', 'reminder', 'note')),
  resource_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO edit_sessions_v2 (user_id, chat_id, resource_type, resource_id, expires_at, created_at)
SELECT user_id, chat_id, resource_type, resource_id, expires_at, created_at
FROM edit_sessions;

DROP TABLE edit_sessions;

ALTER TABLE edit_sessions_v2 RENAME TO edit_sessions;

CREATE INDEX IF NOT EXISTS idx_edit_sessions_expiry ON edit_sessions(expires_at);
