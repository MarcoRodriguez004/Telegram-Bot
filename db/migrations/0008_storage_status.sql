CREATE TABLE IF NOT EXISTS storage_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  over_limit INTEGER NOT NULL CHECK (over_limit IN (0, 1)),
  updated_at TEXT NOT NULL,
  alerted_at TEXT
);
