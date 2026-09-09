ALTER TABLE tasks ADD COLUMN cancelled_at TEXT;
ALTER TABLE reminders ADD COLUMN cancelled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_user_cancelled_id ON tasks(user_id, cancelled_at, id DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_user_cancelled_id ON reminders(user_id, cancelled_at, id DESC);

CREATE TABLE IF NOT EXISTS edit_sessions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  chat_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('task', 'reminder')),
  resource_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edit_sessions_expiry ON edit_sessions(expires_at);
