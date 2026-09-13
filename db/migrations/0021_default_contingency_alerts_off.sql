UPDATE contingency_preferences
SET enabled = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE enabled = 1;
