-- Migration 0027: multi-image posts — ordered assets
-- Image posts can now carry multiple images (carousel / slideshow).
-- The assets table already links assets to posts; we just add an explicit
-- sort_order column and backfill every existing asset_r2_key into that table
-- so the ordered-list read path works for legacy posts too.
--
-- Run: wrangler d1 execute webxni_db --file=db/migrations/0027_asset_sort_order.sql --remote

ALTER TABLE assets ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_assets_post_sort ON assets(post_id, sort_order);

-- Backfill: every post with a legacy asset_r2_key that doesn't already have a
-- matching assets row gets one, with sort_order=0. Uses NOT EXISTS for safety.
INSERT INTO assets (id, post_id, client_id, r2_key, r2_bucket, content_type, source, sort_order, created_at)
SELECT
  lower(hex(randomblob(16))),
  p.id,
  p.client_id,
  p.asset_r2_key,
  COALESCE(p.asset_r2_bucket, 'MEDIA'),
  CASE
    WHEN p.asset_type IN ('video','reel') THEN 'video/mp4'
    ELSE 'image/jpeg'
  END,
  'backfill',
  0,
  COALESCE(p.updated_at, unixepoch())
FROM posts p
WHERE p.asset_r2_key IS NOT NULL
  AND p.asset_r2_key != ''
  AND NOT EXISTS (
    SELECT 1 FROM assets a WHERE a.r2_key = p.asset_r2_key
  );
