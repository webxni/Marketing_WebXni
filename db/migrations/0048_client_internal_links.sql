-- 0048: Internal-link library per client, auto-pulled from each site's live
-- WordPress pages/posts (URL + anchor keyword). Consumed by blog rendering to
-- weave inline internal links and a "Related Resources" section into every blog.
-- Additive only. Never deletes; manual/pinned links survive re-sync.

CREATE TABLE IF NOT EXISTS client_internal_links (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,                       -- absolute permalink on the client site
  anchor_keyword TEXT NOT NULL,                       -- suggested anchor text / target keyword
  title          TEXT,                                -- source page/post title
  wp_type        TEXT,                                -- page|post
  wp_id          INTEGER,                             -- source WP object id
  priority       INTEGER NOT NULL DEFAULT 100,        -- lower = surfaced first
  source         TEXT NOT NULL DEFAULT 'wp_sync',     -- wp_sync|manual
  active         INTEGER NOT NULL DEFAULT 1,          -- 0 to hide from linking
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_client_internal_links_client ON client_internal_links(client_id, active);
-- Dedupe key so re-syncs refresh rows instead of piling duplicates per client.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_internal_link ON client_internal_links(client_id, url);
