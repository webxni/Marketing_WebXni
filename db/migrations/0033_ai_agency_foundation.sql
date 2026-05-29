-- Migration 0033: AI Agency operating system foundation
-- Adds durable, reviewable records for first-class agency agents without
-- granting agents approval, designer-delivery, publishing, or shell privileges.

CREATE TABLE IF NOT EXISTS agent_definitions (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  schedule_kind   TEXT,
  default_backend TEXT NOT NULL DEFAULT 'internal',
  status          TEXT NOT NULL DEFAULT 'idle',
  current_task    TEXT,
  progress        INTEGER NOT NULL DEFAULT 0,
  last_run_at     INTEGER,
  next_run_at     INTEGER,
  skills_json     TEXT,
  command_name    TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_slug    TEXT NOT NULL REFERENCES agent_definitions(slug) ON DELETE CASCADE,
  task_id       TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  backend       TEXT NOT NULL DEFAULT 'internal',
  started_at    INTEGER,
  finished_at   INTEGER,
  duration_ms   INTEGER,
  summary_json  TEXT,
  error         TEXT,
  created_by    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_slug        TEXT NOT NULL REFERENCES agent_definitions(slug) ON DELETE CASCADE,
  client_id         TEXT REFERENCES clients(id) ON DELETE SET NULL,
  related_post_id   TEXT REFERENCES posts(id) ON DELETE SET NULL,
  related_blog_id   TEXT REFERENCES posts(id) ON DELETE SET NULL,
  approved_job_id   TEXT REFERENCES approved_command_jobs(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued',
  priority          TEXT NOT NULL DEFAULT 'medium',
  progress          INTEGER NOT NULL DEFAULT 0,
  input_json        TEXT,
  output_json       TEXT,
  due_at            INTEGER,
  started_at        INTEGER,
  finished_at       INTEGER,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agent_findings (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_slug   TEXT NOT NULL REFERENCES agent_definitions(slug) ON DELETE CASCADE,
  client_id    TEXT REFERENCES clients(id) ON DELETE SET NULL,
  task_id      TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL,
  severity     TEXT NOT NULL DEFAULT 'info',
  title        TEXT NOT NULL,
  finding_json TEXT,
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS client_research_notes (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source         TEXT NOT NULL DEFAULT 'agent',
  research_json  TEXT NOT NULL,
  freshness_date TEXT NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS client_strategy_plans (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS content_review_notes (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  post_id       TEXT REFERENCES posts(id) ON DELETE CASCADE,
  blog_id       TEXT REFERENCES posts(id) ON DELETE CASCADE,
  agent_task_id TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL,
  severity      TEXT NOT NULL DEFAULT 'info',
  notes_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agency_logs (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_slug TEXT,
  task_id    TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL,
  run_id     TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  job_id     TEXT REFERENCES approved_command_jobs(id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'info',
  step       TEXT,
  summary    TEXT NOT NULL,
  error      TEXT,
  backend    TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_agent_definitions_status ON agent_definitions(status, enabled);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created ON agent_runs(agent_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status_updated ON agent_tasks(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent_status ON agent_tasks(agent_slug, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_findings_status_severity ON agent_findings(status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_research_notes_client_freshness ON client_research_notes(client_id, freshness_date DESC);
CREATE INDEX IF NOT EXISTS idx_client_strategy_plans_client_period ON client_strategy_plans(client_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_content_review_notes_post ON content_review_notes(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_logs_created ON agency_logs(created_at DESC);

INSERT OR IGNORE INTO agent_definitions
  (slug, name, purpose, schedule_kind, default_backend, skills_json, command_name)
VALUES
  ('agency-orchestrator', 'Agency Orchestrator Agent', 'Coordinates weekly agency work, detects bottlenecks, and summarizes safe next actions.', 'weekly', 'claude_code', '["webxni-agency-orchestrator"]', 'agency_orchestrator'),
  ('system-reliability', 'System Reliability Agent', 'Reviews job health, failed runs, queue state, and production consistency without changing code or services.', 'daily', 'claude_code', '["webxni-system-reliability"]', 'agency_system_review'),
  ('security-sentinel', 'Security Sentinel Agent', 'Performs defensive-only review of auth and audit signals with secret redaction.', 'daily', 'claude_code', '["webxni-security-sentinel"]', 'agency_security_review'),
  ('client-research', 'Client Research Agent', 'Gradually researches active clients with quotas and stores cited structured notes.', 'daily_quota', 'gemini_cli', '["webxni-client-research"]', 'agency_client_research'),
  ('strategy', 'Strategy Agent', 'Turns research into reviewable weekly and monthly content strategy.', 'weekly', 'claude_code', '["webxni-strategist"]', 'agency_strategy'),
  ('social-copy', 'Social Copy Agent', 'Drafts social content for approval while preserving Marvin approval and designer gates.', 'weekly', 'claude_code', '["webxni-social-copywriter"]', 'agency_social_generation'),
  ('blog-writer', 'Blog Writer Agent', 'Drafts local SEO blog content for review without publishing to WordPress.', 'weekly_quota', 'claude_code', '["webxni-blog-writer"]', 'agency_blog_generation'),
  ('editorial-review', 'Editorial Review Agent', 'Reviews generated posts and blogs for quality, factual risk, repetition, and platform fit.', 'weekly', 'claude_code', '["webxni-editorial-reviewer"]', 'agency_editorial_review');
