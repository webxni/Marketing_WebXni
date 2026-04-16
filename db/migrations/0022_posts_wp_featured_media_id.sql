-- Migration 0022: add wp_featured_media_id to posts when missing in production
ALTER TABLE posts ADD COLUMN wp_featured_media_id INTEGER;
