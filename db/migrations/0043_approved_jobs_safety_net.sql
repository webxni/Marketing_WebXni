-- Migration 0043: approved_command_jobs reliability safety net
-- Adds retry/lease/dead-letter columns so a crashed runner no longer freezes
-- the queue and transient failures retry with backoff instead of dying.
--
-- New statuses (TEXT, no enum constraint in SQLite):
--   queued -> claimed -> running -> completed | failed | dead_letter
-- A 'claimed'/'running' job whose lease_expires_at has passed is reclaimed
-- back to 'queued' (if attempts remain) or moved to 'dead_letter'.

ALTER TABLE approved_command_jobs ADD COLUMN attempts         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE approved_command_jobs ADD COLUMN max_attempts     INTEGER NOT NULL DEFAULT 3;
ALTER TABLE approved_command_jobs ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE approved_command_jobs ADD COLUMN next_retry_at    INTEGER;
ALTER TABLE approved_command_jobs ADD COLUMN last_error_at    INTEGER;

-- Reaper lookup: find expired leases fast.
CREATE INDEX IF NOT EXISTS idx_approved_jobs_lease
  ON approved_command_jobs(status, lease_expires_at);

-- Claim lookup: ready-to-run jobs (queued and past any backoff window).
CREATE INDEX IF NOT EXISTS idx_approved_jobs_ready
  ON approved_command_jobs(status, next_retry_at, created_at);
