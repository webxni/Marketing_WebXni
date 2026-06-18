-- Migration 0044: agency backend cost tracking
-- Records per-call backend spend so the dashboard/Discord can show cost and
-- per-agent daily budget caps can be enforced. cost_usd is NULL when the
-- backend does not report spend (Hermes/Gemini/Codex CLIs).

CREATE TABLE IF NOT EXISTS agency_cost_log (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_slug  TEXT NOT NULL,
  backend     TEXT NOT NULL,
  mode        TEXT,
  cost_usd    REAL,
  run_id      TEXT,
  task_id     TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Sum-by-agent-per-day lookups for budget enforcement.
CREATE INDEX IF NOT EXISTS idx_agency_cost_agent_day
  ON agency_cost_log(agent_slug, created_at);
