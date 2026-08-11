-- Ensure Modern Vision video/reel content includes Google Business now that the GBP destination is verified.

UPDATE packages
SET includes_gbp = 1,
    platforms_included = '["facebook","instagram","google_business"]',
    updated_at = unixepoch()
WHERE slug = (SELECT package FROM clients WHERE slug = 'modern-vision-remodeling');

UPDATE client_monthly_topics
SET preferred_platforms = '["facebook","instagram","google_business"]',
    updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling')
  AND content_type_preference IN ('reel','video')
  AND status IN ('planned','approved')
  AND (preferred_platforms IS NULL OR preferred_platforms NOT LIKE '%google_business%');

UPDATE posts
SET platforms = '["facebook","instagram","google_business"]',
    cap_google_business = 'Planning a room addition in Austin? Start with purpose, flow, utilities, and how the new space connects to the existing home. Modern Vision Remodeling Experts helps homeowners work through these decisions before design begins.',
    gbp_topic_type = COALESCE(gbp_topic_type, 'STANDARD'),
    updated_at = unixepoch()
WHERE id IN (
  SELECT p.id
  FROM posts p
  JOIN clients c ON c.id = p.client_id
  WHERE c.slug = 'modern-vision-remodeling'
    AND p.status IN ('draft','pending_approval','approved','ready','scheduled','failed')
    AND p.content_type IN ('reel','video')
    AND p.title = 'Purpose and Flow Decide How Your Room Addition Works'
);
