ALTER TABLE notes ADD COLUMN file_kind TEXT CHECK (file_kind IN ('photo', 'document'));
ALTER TABLE notes ADD COLUMN file_id TEXT CHECK (
  (file_kind IS NULL AND file_id IS NULL) OR
  (file_kind IS NOT NULL AND file_id IS NOT NULL AND length(file_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id, id DESC);
