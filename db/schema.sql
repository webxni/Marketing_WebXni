-- Marketing_WebXni — D1 Schema
-- Run: wrangler d1 execute webxni-db --file=db/schema.sql
-- Generated: 2026-04-09

-- ══════════════════════════════════════════
-- USERS
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator', -- 'admin'|'operator'|'viewer'
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ══════════════════════════════════════════
-- CLIENTS  (replaces ACCOUNTS_MAP.json + Notion Clients DB)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS clients (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  slug                   TEXT UNIQUE NOT NULL,         -- 'elite-team-builders'
  canonical_name         TEXT NOT NULL,                -- 'Elite Team Builders Inc.'
  package                TEXT NOT NULL DEFAULT 'medium', -- 'premium'|'medium'|'basic'
  status                 TEXT NOT NULL DEFAULT 'active',  -- 'active'|'inactive'
  owner_group            TEXT,                          -- 'gabriel-algrably'
  manual_only            INTEGER NOT NULL DEFAULT 0,
  requires_approval_from TEXT,                          -- 'Lee Harush'
  language               TEXT NOT NULL DEFAULT 'en',   -- 'en'|'es'
  never_mix_with         TEXT,                          -- JSON array of slugs
  upload_post_profile    TEXT,                          -- 'Elite_Team_Builders'
  -- WordPress
  wp_domain              TEXT,                          -- 'eliteteambuildersinc.com'
  wp_url                 TEXT,                          -- 'https://.../wp-json/wp/v2'
  wp_auth                TEXT,                          -- base64 basic auth
  wp_template            TEXT,                          -- 'etb'|'locksmith'|'caliview'|'americas'
  -- Brand (JSON)
  brand_json             TEXT,                          -- {primary_color, accent_color, phone, cta_text, ...}
  notes                  TEXT,
  created_at             INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at             INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ══════════════════════════════════════════
-- CLIENT PLATFORMS  (replaces ACCOUNTS_MAP.json platforms objects)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS client_platforms (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id               TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform                TEXT NOT NULL,  -- 'facebook'|'instagram'|'tiktok'|'x'|'threads'|
                                          --   'linkedin'|'pinterest'|'bluesky'|'youtube'|
                                          --   'google_business'
  account_id              TEXT,           -- Upload-Post internal account ID
  username                TEXT,
  page_id                 TEXT,           -- Facebook page_id / LinkedIn page_id
  upload_post_board_id    TEXT,           -- Pinterest only
  upload_post_location_id TEXT,           -- Google Business only
  privacy_level           TEXT,           -- TikTok: 'PUBLIC_TO_EVERYONE'
  privacy_status          TEXT,           -- YouTube: 'public'
  paused                  INTEGER NOT NULL DEFAULT 0,
  paused_reason           TEXT,
  paused_since            TEXT,
  notes                   TEXT,
  UNIQUE(client_id, platform)
);

-- GBP multi-location (ETB has LA / WA / OR)
CREATE TABLE IF NOT EXISTS client_gbp_locations (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id            TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label                TEXT NOT NULL,    -- 'LA'|'WA'|'OR'
  location_id          TEXT NOT NULL,    -- 'locations/13908569498767872619'
  upload_post_profile  TEXT,
  caption_field        TEXT,             -- 'cap_gbp_la'|'cap_gbp_wa'|'cap_gbp_or'
  posted_field         TEXT,             -- legacy Notion field name (reference only)
  paused               INTEGER NOT NULL DEFAULT 0,
  paused_reason        TEXT,
  sort_order           INTEGER NOT NULL DEFAULT 0
);

-- Content restrictions (locksmith forbidden terms)
CREATE TABLE IF NOT EXISTS client_restrictions (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  term      TEXT NOT NULL,               -- 'car key fob'
  PRIMARY KEY (client_id, term)
);

-- ══════════════════════════════════════════
-- POSTS  (replaces Notion Content Master)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS posts (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id               TEXT NOT NULL REFERENCES clients(id),
  title                   TEXT NOT NULL,
  -- Status lifecycle: draft → approved → ready → scheduled → posted | failed | cancelled
  status                  TEXT NOT NULL DEFAULT 'draft',
  automation_status       TEXT,           -- 'Pending'|'Sent'|'Posted'|'Failed'|'Manual'
  -- Classification
  content_type            TEXT NOT NULL DEFAULT 'image', -- 'image'|'video'|'reel'|'blog'|'text'|'carousel'
  platforms               TEXT NOT NULL DEFAULT '[]',    -- JSON array of platform slugs
  publish_date            TEXT,           -- ISO 8601
  -- Core content
  master_caption          TEXT,
  hashtags                TEXT,
  cta                     TEXT,
  ai_brief                TEXT,
  -- Platform captions
  cap_facebook            TEXT,
  cap_instagram           TEXT,
  cap_linkedin            TEXT,
  cap_x                   TEXT,
  cap_threads             TEXT,
  cap_tiktok              TEXT,
  cap_pinterest           TEXT,
  cap_bluesky             TEXT,
  cap_google_business     TEXT,
  cap_gbp_la              TEXT,           -- ETB: LA location
  cap_gbp_wa              TEXT,           -- ETB: WA location
  cap_gbp_or              TEXT,           -- ETB: OR location
  -- YouTube
  youtube_title           TEXT,
  youtube_description     TEXT,
  -- Blog / SEO
  blog_content            TEXT,
  blog_excerpt            TEXT,
  seo_title               TEXT,
  meta_description        TEXT,
  slug                    TEXT,
  target_keyword          TEXT,
  secondary_keywords      TEXT,
  featured_image_prompt   TEXT,
  -- AI generation
  ai_image_prompt         TEXT,
  ai_video_prompt         TEXT,
  video_script            TEXT,
  -- Assets
  asset_r2_key            TEXT,           -- R2 object key
  asset_r2_bucket         TEXT,           -- 'MEDIA'|'IMAGES'
  asset_type              TEXT,           -- 'Image'|'Video'|'Short Video'|'Carousel'
  canva_link              TEXT,           -- Design reference only (NOT used for posting)
  wp_post_url             TEXT,           -- URL after WP draft created
  wp_post_id              INTEGER,        -- Linked WordPress post ID
  wp_post_status          TEXT,           -- draft|publish|pending|private
  wp_featured_media_id    INTEGER,        -- WP media library ID of featured image
  -- Automation gates
  ready_for_automation    INTEGER NOT NULL DEFAULT 0,
  asset_delivered         INTEGER NOT NULL DEFAULT 0,
  skarleth_status         TEXT,           -- 'Assets Ready'
  skarleth_notes          TEXT,
  manual_posting_needed   INTEGER NOT NULL DEFAULT 0,
  -- Tracking
  error_log               TEXT,
  last_automation_run     TEXT,
  scheduled_by_automation INTEGER NOT NULL DEFAULT 0,
  platform_manual_override INTEGER NOT NULL DEFAULT 0,
  automation_slot_key     TEXT,
  -- Generation metadata
  generation_run_id       TEXT,
  -- Audit
  created_by              TEXT REFERENCES users(id),
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at              INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ══════════════════════════════════════════
-- POST PLATFORMS  (per-platform tracking)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS post_platforms (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  post_id         TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  tracking_id     TEXT,           -- 'UP:{job_id}' from Upload-Post
  real_url        TEXT,           -- fetched back from Upload-Post history
  status          TEXT NOT NULL DEFAULT 'pending',
  -- 'pending'|'sent'|'posted'|'failed'|'skipped'|'blocked'|'idempotent'
  error_message   TEXT,
  attempted_at    TEXT,
  idempotency_key TEXT,
  UNIQUE(post_id, platform)
);

-- ══════════════════════════════════════════
-- POST VERSIONS  (edit history / audit trail)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS post_versions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  changed_by  TEXT REFERENCES users(id),
  snapshot    TEXT NOT NULL,      -- JSON snapshot of all post fields
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ══════════════════════════════════════════
-- ASSETS  (R2 registry)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  post_id       TEXT REFERENCES posts(id),
  client_id     TEXT NOT NULL REFERENCES clients(id),
  r2_key        TEXT UNIQUE NOT NULL,
  r2_bucket     TEXT NOT NULL,    -- 'MEDIA'|'IMAGES'
  filename      TEXT,
  content_type  TEXT,
  size_bytes    INTEGER,
  source        TEXT,             -- 'upload'|'generated'|'google_drive'
  original_url  TEXT,             -- Google Drive URL if sourced externally
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ══════════════════════════════════════════
-- POSTING JOBS  (each posting run)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS posting_jobs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  triggered_by    TEXT,           -- 'cron'|'manual'|'api'
  mode            TEXT NOT NULL,  -- 'dry_run'|'real'
  client_filter   TEXT,
  platform_filter TEXT,
  limit_count     INTEGER,
  status          TEXT NOT NULL DEFAULT 'running', -- 'running'|'completed'|'failed'
  stats_json      TEXT,           -- {processed, posted, skipped, blocked, failed}
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at    INTEGER
);

-- ══════════════════════════════════════════
-- POSTING ATTEMPTS  (per post × platform × job)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS posting_attempts (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  job_id          TEXT NOT NULL REFERENCES posting_jobs(id),
  post_id         TEXT NOT NULL REFERENCES posts(id),
  platform        TEXT NOT NULL,
  client_id       TEXT NOT NULL REFERENCES clients(id),
  result          TEXT NOT NULL,  -- 'posted'|'skipped'|'blocked'|'failed'|'idempotent'
  reason          TEXT,
  tracking_id     TEXT,
  idempotency_key TEXT,
  error_body      TEXT,
  http_status     INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ══════════════════════════════════════════
-- GENERATION RUNS  (weekly content generation sessions)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS generation_runs (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  phase             INTEGER NOT NULL,         -- 1|2
  triggered_by      TEXT,
  week_start        TEXT NOT NULL,            -- 'YYYY-MM-DD'
  client_filter     TEXT,
  status            TEXT NOT NULL DEFAULT 'running',
  clients_processed TEXT,                     -- JSON array of slugs
  posts_created     INTEGER DEFAULT 0,
  posts_updated     INTEGER DEFAULT 0,
  overwrite_existing INTEGER NOT NULL DEFAULT 0,
  error_log         TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at      INTEGER
);

-- ══════════════════════════════════════════
-- AUDIT LOGS
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT REFERENCES users(id),
  action      TEXT NOT NULL,              -- 'post.approve'|'post.publish'|'client.create'|...
  entity_type TEXT,                       -- 'post'|'client'|'asset'
  entity_id   TEXT,
  old_value   TEXT,                       -- JSON
  new_value   TEXT,                       -- JSON
  ip          TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ══════════════════════════════════════════
-- INDEXES
-- ══════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_posts_client        ON posts(client_id);
CREATE INDEX IF NOT EXISTS idx_posts_status        ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_publish_date  ON posts(publish_date);
CREATE INDEX IF NOT EXISTS idx_posts_ready         ON posts(ready_for_automation, asset_delivered, status);
CREATE INDEX IF NOT EXISTS idx_post_platforms_post ON post_platforms(post_id);
CREATE INDEX IF NOT EXISTS idx_posting_attempts_job ON posting_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity        ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_assets_post         ON assets(post_id);
CREATE INDEX IF NOT EXISTS idx_assets_client       ON assets(client_id);
CREATE INDEX IF NOT EXISTS idx_client_platforms    ON client_platforms(client_id, platform);
CREATE INDEX IF NOT EXISTS idx_gbp_locations       ON client_gbp_locations(client_id);
