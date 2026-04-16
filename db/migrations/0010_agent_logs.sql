-- Migration 0010: AI Agent conversation logs
CREATE TABLE IF NOT EXISTS agent_logs (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL,
  user_email  TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  response    TEXT,
  tools_used  TEXT,       -- JSON array of tool names called
  actions     TEXT,       -- JSON array of action summaries
  errors      TEXT,       -- JSON array of errors
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_user_id   ON agent_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC);
