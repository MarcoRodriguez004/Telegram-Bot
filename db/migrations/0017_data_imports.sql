CREATE TABLE IF NOT EXISTS data_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exported_at TEXT NOT NULL,
  source_telegram_user_id INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (user_id, exported_at)
);

CREATE INDEX IF NOT EXISTS idx_data_imports_user_imported_at ON data_imports(user_id, imported_at DESC);
