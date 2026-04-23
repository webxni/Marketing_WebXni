-- Blog body images — three generated Stability images per blog post.
-- Stored as JSON array: [{ slot, r2_key, prompt, wp_media_id, attempts, status }]
-- slot: 1 (after intro / hero), 2 (mid-content), 3 (before CTA)
-- status: 'generated' | 'failed' | 'pending'
ALTER TABLE posts ADD COLUMN blog_body_images TEXT;
