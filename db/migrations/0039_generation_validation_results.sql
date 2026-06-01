-- Migration 0039: Generation Validation Results
-- Audit trail for content validation during generation

CREATE TABLE IF NOT EXISTS generation_validation_results (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  generation_run_id  TEXT REFERENCES generation_runs(id) ON DELETE CASCADE,
  post_id            TEXT REFERENCES posts(id) ON DELETE CASCADE,
  client_id          TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  validation_passed  INTEGER NOT NULL DEFAULT 1,
  -- 1 = passed, 0 = blocked
  hard_blocks        TEXT,
  -- JSON array of blocking issues that prevented save
  -- e.g., ["Industry mismatch: remodeling topic for locksmith client"]
  warnings           TEXT,
  -- JSON array of warnings that were logged but didn't block
  -- e.g., ["Service not in client profile", "Missing geographic mention"]
  validation_json    TEXT,
  -- Full validation result object for auditing
  validated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_generation_validation_results_run ON generation_validation_results(generation_run_id);
CREATE INDEX IF NOT EXISTS idx_generation_validation_results_post ON generation_validation_results(post_id);
CREATE INDEX IF NOT EXISTS idx_generation_validation_results_client_passed ON generation_validation_results(client_id, validation_passed);
