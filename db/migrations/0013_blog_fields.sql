-- Migration 0013: blog_excerpt + wp_featured_media_id
-- blog_excerpt: plain-text excerpt for WordPress (separate from master_caption)
-- wp_featured_media_id: WP media library ID of the uploaded featured image
ALTER TABLE posts ADD COLUMN blog_excerpt         TEXT;
ALTER TABLE posts ADD COLUMN wp_featured_media_id INTEGER;
