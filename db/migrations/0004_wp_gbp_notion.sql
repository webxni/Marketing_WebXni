-- Migration 0004: WordPress credentials, GBP post fields, Notion IDs, wp_templates
-- Run: wrangler d1 execute webxni-db --file=db/migrations/0004_wp_gbp_notion.sql --remote
-- Generated: 2026-04-10

-- ─── CLIENTS: extended WordPress credential fields ─────────────────────────────
-- Keep legacy wp_url / wp_auth for backwards compat; these new fields replace them
ALTER TABLE clients ADD COLUMN notion_page_id             TEXT;
ALTER TABLE clients ADD COLUMN wp_admin_url               TEXT;  -- 'https://example.com/wp-admin'
ALTER TABLE clients ADD COLUMN wp_base_url                TEXT;  -- 'https://example.com'
ALTER TABLE clients ADD COLUMN wp_rest_base               TEXT DEFAULT '/wp-json/wp/v2';
ALTER TABLE clients ADD COLUMN wp_username                TEXT;  -- WP login username
ALTER TABLE clients ADD COLUMN wp_application_password    TEXT;  -- WP Application Password (not login pw)
ALTER TABLE clients ADD COLUMN wp_default_post_status     TEXT DEFAULT 'draft';  -- 'draft'|'publish'
ALTER TABLE clients ADD COLUMN wp_default_author_id       INTEGER;
ALTER TABLE clients ADD COLUMN wp_default_category_ids    TEXT;  -- JSON array of ints e.g. [1,5,12]
ALTER TABLE clients ADD COLUMN wp_template_key            TEXT;  -- references wp_templates.template_key
ALTER TABLE clients ADD COLUMN wp_featured_image_mode     TEXT DEFAULT 'upload';  -- 'upload'|'url'|'none'
ALTER TABLE clients ADD COLUMN wp_excerpt_mode            TEXT DEFAULT 'auto';    -- 'auto'|'manual'|'none'

-- ─── POSTS: GBP advanced fields + Notion back-sync ────────────────────────────
ALTER TABLE posts ADD COLUMN notion_page_id       TEXT;    -- Notion page ID for status write-back
ALTER TABLE posts ADD COLUMN gbp_topic_type       TEXT;    -- 'STANDARD'|'EVENT'|'OFFER'
ALTER TABLE posts ADD COLUMN gbp_cta_type         TEXT;    -- 'LEARN_MORE'|'BOOK'|'ORDER'|'SHOP'|'SIGN_UP'|'CALL'
ALTER TABLE posts ADD COLUMN gbp_cta_url          TEXT;
ALTER TABLE posts ADD COLUMN gbp_event_title      TEXT;
ALTER TABLE posts ADD COLUMN gbp_event_start_date TEXT;
ALTER TABLE posts ADD COLUMN gbp_event_start_time TEXT;
ALTER TABLE posts ADD COLUMN gbp_event_end_date   TEXT;
ALTER TABLE posts ADD COLUMN gbp_event_end_time   TEXT;
ALTER TABLE posts ADD COLUMN gbp_coupon_code      TEXT;
ALTER TABLE posts ADD COLUMN gbp_redeem_url       TEXT;
ALTER TABLE posts ADD COLUMN gbp_terms            TEXT;
ALTER TABLE posts ADD COLUMN wp_post_id           INTEGER; -- WP post ID after creation/draft
ALTER TABLE posts ADD COLUMN wp_post_status       TEXT;    -- 'draft'|'publish'|'private'

-- ─── WP TEMPLATES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wp_templates (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id     TEXT REFERENCES clients(id) ON DELETE CASCADE,  -- NULL = global template
  template_key  TEXT NOT NULL,    -- 'etb'|'locksmith'|'caliview'|'default'
  name          TEXT NOT NULL,    -- human display name
  html_template TEXT NOT NULL,    -- HTML with {{token}} placeholders
  css           TEXT,             -- optional scoped CSS
  description   TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0,  -- 1 = default for this client (or global)
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(client_id, template_key)
);

-- ─── NOTION SYNC LOG ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notion_sync_log (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  direction      TEXT NOT NULL,   -- 'import'|'export'
  entity_type    TEXT NOT NULL,   -- 'client'|'post'
  entity_id      TEXT,            -- local DB id
  notion_page_id TEXT,
  status         TEXT NOT NULL,   -- 'success'|'skipped'|'error'
  details        TEXT,            -- human-readable message or error
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wp_templates_client ON wp_templates(client_id);
CREATE INDEX IF NOT EXISTS idx_clients_notion      ON clients(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_posts_notion        ON posts(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_notion_sync         ON notion_sync_log(entity_type, entity_id);
