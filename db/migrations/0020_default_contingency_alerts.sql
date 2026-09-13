INSERT OR IGNORE INTO contingency_preferences (user_id, mode, enabled, updated_at)
SELECT id, 'always', 1, CURRENT_TIMESTAMP
FROM users;
