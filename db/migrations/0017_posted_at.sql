-- Migration 0017: Add posted_at timestamp to posts
-- Stores the unix timestamp when a post was confirmed published (status → posted).
ALTER TABLE posts ADD COLUMN posted_at INTEGER;
