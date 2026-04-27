-- Migration 0029: approved backend command jobs for Discord-safe Claude terminal runs

CREATE TABLE IF NOT EXISTS approved_command_jobs (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  generation_run_id TEXT REFERENCES generation_runs(id) ON DELETE SET NULL,
  command_name      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  requested_by      TEXT NOT NULL,
  args_json         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued',
  claimed_by        TEXT,
  command_line      TEXT,
  progress_message  TEXT,
  result_json       TEXT,
  error_log         TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  claimed_at        INTEGER,
  started_at        INTEGER,
  completed_at      INTEGER,
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_approved_jobs_status_created
  ON approved_command_jobs(status, created_at);
