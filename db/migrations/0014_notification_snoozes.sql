CREATE TABLE IF NOT EXISTS notification_snoozes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('task', 'reminder')),
  resource_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  notify_at TEXT NOT NULL,
  processing_until TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_snoozes_due
  ON notification_snoozes(status, notify_at, processing_until);
CREATE INDEX IF NOT EXISTS idx_notification_snoozes_user_resource
  ON notification_snoozes(user_id, resource_type, resource_id);
