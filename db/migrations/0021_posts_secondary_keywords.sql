-- Migration 0021: add secondary_keywords to posts for blog SEO persistence
ALTER TABLE posts ADD COLUMN secondary_keywords TEXT;
