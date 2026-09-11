CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  tasks_enabled INTEGER NOT NULL DEFAULT 0 CHECK (tasks_enabled IN (0, 1)),
  tasks_interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (tasks_interval_minutes IN (5, 10, 20, 30, 60)),
  reminders_enabled INTEGER NOT NULL DEFAULT 0 CHECK (reminders_enabled IN (0, 1)),
  reminders_interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (reminders_interval_minutes IN (5, 10, 20, 30, 60)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persistent_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('task', 'reminder')),
  resource_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes IN (5, 10, 20, 30, 60)),
  next_notify_at TEXT,
  processing_until TEXT,
  last_notified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_persistent_notifications_due
  ON persistent_notifications(enabled, next_notify_at, processing_until);
CREATE INDEX IF NOT EXISTS idx_persistent_notifications_user_resource
  ON persistent_notifications(user_id, resource_type, resource_id);
