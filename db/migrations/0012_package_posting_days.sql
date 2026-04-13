-- Migration 0012: add posting_days to packages
-- posting_days: JSON array of lowercase day names, e.g. ["monday","wednesday","friday"]
-- posts_per_month is kept in schema but is now auto-calculated, not user-editable
ALTER TABLE packages ADD COLUMN posting_days TEXT;
