-- 0045: Ranking-first client intelligence (§3/§4/§5) + executor logging (§1).
-- Additive only. Curated client_intelligence is untouched.

-- Shared, queryable keyword set consumed by every agent (research/strategy/
-- social/blog/GMB) via the content brief. One source of truth per client.
CREATE TABLE IF NOT EXISTS client_keywords (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  keyword           TEXT NOT NULL,
  kw_type           TEXT NOT NULL DEFAULT 'secondary',  -- primary|secondary|long_tail|local|near_me
  search_intent     TEXT,                               -- informational|commercial|transactional|local
  difficulty        TEXT,                               -- low|medium|high or free text
  opportunity_notes TEXT,
  locality          TEXT,                               -- city / service-area term
  source            TEXT,                               -- research|strategy|manual
  confidence        TEXT DEFAULT 'medium',              -- low|medium|high
  status            TEXT NOT NULL DEFAULT 'active',      -- active|archived
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_client_keywords_client ON client_keywords(client_id, status);
CREATE INDEX IF NOT EXISTS idx_client_keywords_type   ON client_keywords(client_id, kw_type);
-- Dedupe key so upserts don't pile duplicate keywords per client.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_keyword ON client_keywords(client_id, keyword);

-- Missing-information protocol (§5): track profile gaps Hermes must resolve via
-- web search → Discord ask, plus any assumptions made so a human can correct them.
CREATE TABLE IF NOT EXISTS client_profile_gaps (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  field             TEXT NOT NULL,                       -- e.g. service_areas, hours, certifications
  question          TEXT,                                -- the Discord question to ask
  status            TEXT NOT NULL DEFAULT 'needs_info',  -- needs_info|searching|answered|assumed
  assumption        TEXT,                                -- assumption made while blocked
  resolution        TEXT,                                -- answer once resolved
  asked_in_discord_at INTEGER,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_profile_gaps_client ON client_profile_gaps(client_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_gap ON client_profile_gaps(client_id, field);

-- §1: record which executor ran each task and why.
ALTER TABLE agency_cost_log ADD COLUMN executor_reason TEXT;

-- §2 measurement: locality target for GMB/local-rank posts (target_keyword exists).
ALTER TABLE posts ADD COLUMN target_locality TEXT;
