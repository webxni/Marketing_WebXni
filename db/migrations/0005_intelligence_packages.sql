-- Migration 0005: Client intelligence, packages, content memory, platform links, logo
-- Run: wrangler d1 execute webxni-db --file=db/migrations/0005_intelligence_packages.sql --remote

-- ─────────────────────────────────────────────────────────────────────────────
-- Client intelligence (brand voice, content strategy, research)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_intelligence (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id            TEXT NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  -- Brand voice
  brand_voice          TEXT,   -- "professional but approachable, local, direct"
  tone_keywords        TEXT,   -- JSON: ["trustworthy","expert","local"]
  prohibited_terms     TEXT,   -- JSON: ["cheap","deal","discount"]
  approved_ctas        TEXT,   -- JSON: ["Call for a free estimate","Book online today"]
  -- Content strategy
  content_goals        TEXT,   -- "Drive phone calls, build local trust"
  service_priorities   TEXT,   -- JSON ranked list: ["emergency lockout","car key replacement"]
  content_angles       TEXT,   -- JSON: ["before/after","tips","local stories","seasonal"]
  seasonal_notes       TEXT,   -- "April = spring cleaning, May = graduation"
  competitor_notes     TEXT,
  audience_notes       TEXT,   -- "homeowners 30-60, LA area"
  -- SEO / local
  primary_keyword      TEXT,
  secondary_keywords   TEXT,   -- JSON array
  local_seo_themes     TEXT,   -- JSON: ["East LA","Silver Lake"]
  -- Generation config
  generation_model     TEXT,   -- override global AI model
  generation_language  TEXT,   -- 'en'|'es'|'bilingual'
  humanization_style   TEXT,   -- "conversational","formal","punchy"
  -- Monthly snapshot (updated each generation cycle)
  monthly_snapshot     TEXT,   -- JSON: {month: "2026-04", topics_used: [...], angles_used: [...]}
  -- Feedback integration
  feedback_summary     TEXT,
  last_research_at     INTEGER,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Content memory — tracks used hooks/topics/angles per client for dedup
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_memory (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  post_id         TEXT REFERENCES posts(id) ON DELETE SET NULL,
  month           TEXT NOT NULL,        -- 'YYYY-MM'
  content_type    TEXT NOT NULL,        -- 'caption'|'blog_title'|'hook'|'topic'|'angle'|'cta'
  value           TEXT NOT NULL,        -- normalized fingerprint text
  embedding_hash  TEXT,                 -- SHA-256 of normalized value for fast dedup
  platform        TEXT,                 -- null = all platforms
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Packages — configurable content packages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  slug                  TEXT UNIQUE NOT NULL,  -- 'premium'|'medium'|'basic'|'custom-etb'
  name                  TEXT NOT NULL,
  posts_per_month       INTEGER DEFAULT 12,
  images_per_month      INTEGER DEFAULT 8,
  videos_per_month      INTEGER DEFAULT 2,
  reels_per_month       INTEGER DEFAULT 2,
  blog_posts_per_month  INTEGER DEFAULT 0,
  platforms_included    TEXT NOT NULL DEFAULT '[]',  -- JSON array
  includes_gbp          INTEGER DEFAULT 0,
  includes_blog         INTEGER DEFAULT 0,
  includes_bilingual    INTEGER DEFAULT 0,
  includes_stories      INTEGER DEFAULT 0,
  posting_frequency     TEXT DEFAULT 'weekly',   -- 'daily'|'3x_week'|'weekly'|'biweekly'
  cadence_notes         TEXT,
  price_cents           INTEGER,                 -- price in cents
  active                INTEGER DEFAULT 1,
  sort_order            INTEGER DEFAULT 0,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Seed default packages
INSERT OR IGNORE INTO packages (id, slug, name, posts_per_month, images_per_month, videos_per_month, reels_per_month, blog_posts_per_month, platforms_included, includes_gbp, includes_blog, posting_frequency, sort_order)
VALUES
  (lower(hex(randomblob(16))), 'basic',   'Basic',   8,  6, 1, 1, 0, '["facebook","instagram"]',                                      0, 0, 'weekly',  10),
  (lower(hex(randomblob(16))), 'medium',  'Medium',  12, 8, 2, 2, 0, '["facebook","instagram","google_business"]',                    1, 0, '3x_week', 20),
  (lower(hex(randomblob(16))), 'premium', 'Premium', 20, 12,3, 3, 2, '["facebook","instagram","linkedin","tiktok","google_business"]', 1, 1, 'daily',   30);

-- ─────────────────────────────────────────────────────────────────────────────
-- Client package overrides
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_package_overrides (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id       TEXT NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  base_package_id TEXT REFERENCES packages(id),
  overrides_json  TEXT,   -- JSON partial of package fields that differ from base
  notes           TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Client platform links (social profile URLs)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_platform_links (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id   TEXT NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  facebook    TEXT,
  instagram   TEXT,
  tiktok      TEXT,
  youtube     TEXT,
  linkedin    TEXT,
  pinterest   TEXT,
  x           TEXT,
  threads     TEXT,
  bluesky     TEXT,
  google_business TEXT,
  website     TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend clients: logo + brand colors
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE clients ADD COLUMN logo_r2_key          TEXT;
ALTER TABLE clients ADD COLUMN logo_url             TEXT;
ALTER TABLE clients ADD COLUMN brand_primary_color  TEXT;
ALTER TABLE clients ADD COLUMN brand_accent_color   TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend client_platforms: profile URL, connection status
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE client_platforms ADD COLUMN profile_url       TEXT;
ALTER TABLE client_platforms ADD COLUMN profile_username  TEXT;
ALTER TABLE client_platforms ADD COLUMN connection_status TEXT DEFAULT 'unverified';
ALTER TABLE client_platforms ADD COLUMN yt_channel_id     TEXT;
ALTER TABLE client_platforms ADD COLUMN linkedin_urn      TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Client feedback
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_feedback (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  submitted_by    TEXT REFERENCES users(id),
  month           TEXT,              -- 'YYYY-MM'
  post_id         TEXT REFERENCES posts(id),
  category        TEXT NOT NULL DEFAULT 'general',
  sentiment       TEXT NOT NULL DEFAULT 'neutral',
  message         TEXT NOT NULL,
  admin_reviewed  INTEGER DEFAULT 0,
  admin_notes     TEXT,
  applied_to_intelligence INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_intelligence_client ON client_intelligence(client_id);
CREATE INDEX IF NOT EXISTS idx_content_memory_client ON content_memory(client_id, month);
CREATE INDEX IF NOT EXISTS idx_platform_links_client ON client_platform_links(client_id);
CREATE INDEX IF NOT EXISTS idx_client_feedback       ON client_feedback(client_id, month);
CREATE INDEX IF NOT EXISTS idx_packages_active       ON packages(active, sort_order);
