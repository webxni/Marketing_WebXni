-- Migration 0024: Strengthen post_platforms idempotency
-- Adds attempt_count for retry-capping and published_at for accurate success timestamps.

ALTER TABLE post_platforms ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE post_platforms ADD COLUMN published_at TEXT;
