-- Migration 0010: 3-role system + client portal + 2FA support
-- Run: wrangler d1 execute webxni_db --file=db/migrations/0010_roles_client_portal.sql --remote

-- Add client_id to users (required when role = 'client')
ALTER TABLE users ADD COLUMN client_id TEXT REFERENCES clients(id);

-- Add TOTP 2FA support
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

-- Login audit trail
CREATE TABLE IF NOT EXISTS login_audit (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT,
  email       TEXT    NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  success     INTEGER NOT NULL DEFAULT 0,
  fail_reason TEXT,
  created_at  INTEGER NOT NULL
);

-- Migrate old roles to new 3-role system:
--   manager  → admin    (had near-full access)
--   editor   → designer (content creation workflow)
--   reviewer → designer (content approval = part of designer workflow)
--   operator → designer (ran automation = operational)
UPDATE users SET role = 'admin'    WHERE role = 'manager';
UPDATE users SET role = 'designer' WHERE role = 'editor';
UPDATE users SET role = 'designer' WHERE role = 'reviewer';
UPDATE users SET role = 'designer' WHERE role = 'operator';
