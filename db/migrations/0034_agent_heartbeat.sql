-- Migration 0034: Agent heartbeat tracking
-- Adds per-agent heartbeat columns so the dashboard and Discord can show
-- real-time health status without polling running processes.

ALTER TABLE agent_definitions ADD COLUMN last_heartbeat_at       INTEGER;
ALTER TABLE agent_definitions ADD COLUMN heartbeat_status        TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE agent_definitions ADD COLUMN heartbeat_message       TEXT;
ALTER TABLE agent_definitions ADD COLUMN last_error              TEXT;
ALTER TABLE agent_definitions ADD COLUMN stale_after_minutes     INTEGER NOT NULL DEFAULT 1440;
ALTER TABLE agent_definitions ADD COLUMN next_expected_heartbeat_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_agent_definitions_heartbeat
  ON agent_definitions(heartbeat_status, next_expected_heartbeat_at);

-- Seed defaults for existing rows
UPDATE agent_definitions
SET heartbeat_status = 'idle', stale_after_minutes = 1440
WHERE heartbeat_status IS NULL OR heartbeat_status = '';
