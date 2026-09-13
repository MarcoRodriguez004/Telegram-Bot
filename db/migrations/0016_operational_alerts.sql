CREATE TABLE IF NOT EXISTS operational_alerts (
  alert_key TEXT PRIMARY KEY,
  component TEXT NOT NULL,
  operation TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_alerted_at TEXT,
  updated_at TEXT NOT NULL
);
