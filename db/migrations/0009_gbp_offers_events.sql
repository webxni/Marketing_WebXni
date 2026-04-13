-- Migration 0009: GBP CTA on client_offers + new client_events table
-- Run: wrangler d1 execute webxni-db --file=db/migrations/0009_gbp_offers_events.sql --remote
-- Generated: 2026-04-13

-- ─── CREATE client_offers if it doesn't exist (was missing from prior migration run) ──
CREATE TABLE IF NOT EXISTS client_offers (
  id          TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id   TEXT    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT,
  cta_text    TEXT,
  valid_until TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_client_offers ON client_offers(client_id);

-- ─── POSTS: add gbp_location_id override column ─────────────────────────────
-- Allows a post to target a specific GBP location (overrides client_platforms default)
ALTER TABLE posts ADD COLUMN gbp_location_id TEXT;

-- ─── EXTEND client_offers with GBP fields + recurrence ───────────────────────

ALTER TABLE client_offers ADD COLUMN gbp_coupon_code  TEXT;
ALTER TABLE client_offers ADD COLUMN gbp_redeem_url   TEXT;
ALTER TABLE client_offers ADD COLUMN gbp_terms        TEXT;
ALTER TABLE client_offers ADD COLUMN gbp_cta_type     TEXT;  -- 'BOOK'|'ORDER'|'SHOP'|'LEARN_MORE'|'SIGN_UP'|'CALL'
ALTER TABLE client_offers ADD COLUMN gbp_cta_url      TEXT;
ALTER TABLE client_offers ADD COLUMN gbp_location_id  TEXT;  -- specific GBP location, NULL = all locations

-- Recurrence: 'none'=one-time, 'weekly', 'biweekly', 'monthly'
ALTER TABLE client_offers ADD COLUMN recurrence       TEXT NOT NULL DEFAULT 'none';
ALTER TABLE client_offers ADD COLUMN next_run_date    TEXT;  -- YYYY-MM-DD — when to next auto-post
ALTER TABLE client_offers ADD COLUMN last_posted_at   TEXT;  -- YYYY-MM-DD — last successful post date
ALTER TABLE client_offers ADD COLUMN asset_r2_key     TEXT;  -- offer image in R2
ALTER TABLE client_offers ADD COLUMN asset_r2_bucket  TEXT;
ALTER TABLE client_offers ADD COLUMN paused           INTEGER NOT NULL DEFAULT 0;  -- 1 = paused (skip in automation)

-- ─── NEW: client_events ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_events (
  id                   TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id            TEXT    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title                TEXT    NOT NULL,
  description          TEXT,
  -- GBP event fields
  gbp_event_title      TEXT,   -- display title sent to GBP (can differ from internal title)
  gbp_event_start_date TEXT,   -- YYYY-MM-DD
  gbp_event_start_time TEXT,   -- HH:MM (24h)
  gbp_event_end_date   TEXT,   -- YYYY-MM-DD
  gbp_event_end_time   TEXT,   -- HH:MM (24h)
  gbp_cta_type         TEXT,   -- 'BOOK'|'ORDER'|'SHOP'|'LEARN_MORE'|'SIGN_UP'|'CALL'
  gbp_cta_url          TEXT,
  gbp_location_id      TEXT,   -- NULL = all/default location
  -- Media
  asset_r2_key         TEXT,
  asset_r2_bucket      TEXT,
  -- Recurrence
  -- 'once'=one-time (posts once then deactivates), 'weekly', 'biweekly', 'monthly'
  recurrence           TEXT    NOT NULL DEFAULT 'once',
  next_run_date        TEXT,   -- YYYY-MM-DD — next auto-post date
  last_posted_at       TEXT,   -- YYYY-MM-DD — last successful post date
  -- State
  active               INTEGER NOT NULL DEFAULT 1,
  paused               INTEGER NOT NULL DEFAULT 0,
  -- Expiry guard: skip if event end date is in the past
  -- (gbp_event_end_date is used for this check automatically)
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_client_events_client     ON client_events(client_id);
CREATE INDEX IF NOT EXISTS idx_client_offers_next_run   ON client_offers(next_run_date, active, paused);
CREATE INDEX IF NOT EXISTS idx_client_events_next_run   ON client_events(next_run_date, active, paused);
