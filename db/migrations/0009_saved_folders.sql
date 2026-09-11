CREATE TABLE IF NOT EXISTS saved_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, normalized_name)
);

ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES saved_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_saved_folders_user_name ON saved_folders(user_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_notes_user_folder_id ON notes(user_id, folder_id, id DESC);
