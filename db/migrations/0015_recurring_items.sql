ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT CHECK (recurrence_rule IN ('daily', 'weekly', 'monthly'));
ALTER TABLE reminders ADD COLUMN recurrence_rule TEXT CHECK (recurrence_rule IN ('daily', 'weekly', 'monthly'));

CREATE INDEX IF NOT EXISTS idx_tasks_user_recurrence ON tasks(user_id, recurrence_rule, status);
CREATE INDEX IF NOT EXISTS idx_reminders_user_recurrence ON reminders(user_id, recurrence_rule, status);
