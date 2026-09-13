CREATE TABLE IF NOT EXISTS contingency_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  mode TEXT CHECK(mode IN ('always', 'vehicle')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  hologram TEXT NOT NULL CHECK(hologram IN ('0', '00')),
  plate_last_digit INTEGER NOT NULL CHECK(plate_last_digit BETWEEN 0 AND 9),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_vehicles_user_enabled
  ON user_vehicles(user_id, enabled, id);

CREATE TABLE IF NOT EXISTS contingency_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  active INTEGER NOT NULL CHECK(active IN (0, 1)),
  phase TEXT,
  restriction_signature TEXT,
  restrictions_text TEXT,
  source_url TEXT NOT NULL,
  published_at TEXT,
  updated_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL
);
