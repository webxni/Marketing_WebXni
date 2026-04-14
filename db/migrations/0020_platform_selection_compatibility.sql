-- Content-type-first platform compatibility and automation rerun support

ALTER TABLE posts ADD COLUMN platform_manual_override INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN automation_slot_key TEXT;
ALTER TABLE generation_runs ADD COLUMN overwrite_existing INTEGER NOT NULL DEFAULT 0;

-- Normalize legacy ETB multi-location GBP fields to actual post column / tracking keys.
UPDATE client_gbp_locations
SET caption_field = 'cap_gbp_la',
    posted_field  = 'gbp_la'
WHERE lower(label) = 'la';

UPDATE client_gbp_locations
SET caption_field = 'cap_gbp_wa',
    posted_field  = 'gbp_wa'
WHERE lower(label) = 'wa';

UPDATE client_gbp_locations
SET caption_field = 'cap_gbp_or',
    posted_field  = 'gbp_or'
WHERE lower(label) = 'or';

-- Backfill automation slot keys for existing automation-generated posts.
UPDATE posts
SET automation_slot_key = client_id || ':' || substr(publish_date, 1, 10) || ':' || content_type || ':0'
WHERE scheduled_by_automation = 1
  AND publish_date IS NOT NULL
  AND automation_slot_key IS NULL;

-- Correct existing automation-generated posts that were never manually overridden.
UPDATE posts
SET platforms = '["website_blog"]'
WHERE scheduled_by_automation = 1
  AND platform_manual_override = 0
  AND content_type = 'blog';

UPDATE posts
SET platforms = '["google_business"]'
WHERE scheduled_by_automation = 1
  AND platform_manual_override = 0
  AND content_type = 'google_business';

UPDATE posts
SET platforms = (
  SELECT json_group_array(value)
  FROM json_each(posts.platforms)
  WHERE value IN ('facebook','instagram','linkedin','x','threads','pinterest','bluesky','google_business')
)
WHERE scheduled_by_automation = 1
  AND platform_manual_override = 0
  AND content_type = 'image';

UPDATE posts
SET platforms = (
  SELECT json_group_array(value)
  FROM json_each(posts.platforms)
  WHERE value IN ('instagram','facebook','tiktok','youtube','threads')
)
WHERE scheduled_by_automation = 1
  AND platform_manual_override = 0
  AND content_type = 'reel';

UPDATE posts
SET platforms = (
  SELECT json_group_array(value)
  FROM json_each(posts.platforms)
  WHERE value IN ('facebook','instagram','youtube','linkedin','x')
)
WHERE scheduled_by_automation = 1
  AND platform_manual_override = 0
  AND content_type = 'video';

-- Keep JSON arrays non-null after filtering.
UPDATE posts
SET platforms = '[]'
WHERE platforms IS NULL OR trim(platforms) = '';
