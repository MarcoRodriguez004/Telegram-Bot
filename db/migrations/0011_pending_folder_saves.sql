CREATE TABLE IF NOT EXISTS pending_folder_saves (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  url TEXT,
  file_kind TEXT CHECK (file_kind IN ('photo', 'document')),
  file_id TEXT,
  requested_folder_name TEXT NOT NULL,
  existing_folder_id INTEGER NOT NULL REFERENCES saved_folders(id) ON DELETE CASCADE,
  existing_folder_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK ((file_kind IS NULL AND file_id IS NULL) OR (file_kind IS NOT NULL AND file_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_pending_folder_saves_expiry ON pending_folder_saves(expires_at);
