-- Migration 0028: Align LinkedIn client mappings with 2026-04-23 audit
-- Safe to run multiple times.

-- Canonical Upload-Post profiles for merged + legacy slugs
UPDATE clients SET upload_post_profile = 'Elite_Team_Builders'
WHERE slug = 'elite-team-builders';

UPDATE clients SET upload_post_profile = '7_24_Locksmith'
WHERE slug IN ('724-locksmith', '724-locksmith-ca');

UPDATE clients SET upload_post_profile = '24_7_Lockout'
WHERE slug IN ('247-lockout-locksmith', '247-lockout-pasadena');

UPDATE clients SET upload_post_profile = 'Golden_Touch_Roofing'
WHERE slug = 'golden-touch-roofing';

UPDATE clients SET upload_post_profile = 'Americas_Professional_Builders'
WHERE slug = 'americas-professional-builders';

UPDATE clients SET upload_post_profile = 'WebXni'
WHERE slug = 'webxni';

UPDATE clients SET upload_post_profile = 'UnlockD_Pros'
WHERE slug IN ('unlockd-pros', 'unlocked-pros');

UPDATE clients SET upload_post_profile = 'Daniels_Locks_Key'
WHERE slug IN ('daniels-locks-key', 'daniels-locksmith');

UPDATE clients SET upload_post_profile = 'Caliview_Builders'
WHERE slug = 'caliview-builders';

-- Clear stale LinkedIn "not linked" notes / pauses where the repo snapshot already has page IDs
UPDATE client_platforms
SET account_id = COALESCE(account_id, '12712'),
    paused = 0,
    paused_reason = NULL,
    paused_since = NULL,
    notes = NULL
WHERE platform = 'linkedin'
  AND client_id IN (
    SELECT id FROM clients
    WHERE slug IN ('elite-team-builders', 'caliview-builders', 'americas-professional-builders', 'unlockd-pros', 'unlocked-pros')
  )
  AND page_id IN ('111348080', '112288361', '112642026', '111968679');

-- Keep existing known LinkedIn page IDs explicit in repo-managed rows
UPDATE client_platforms
SET page_id = '111348080',
    account_id = COALESCE(account_id, '12712'),
    paused = 0,
    paused_reason = NULL,
    paused_since = NULL
WHERE platform = 'linkedin'
  AND client_id IN (SELECT id FROM clients WHERE slug = 'elite-team-builders');

UPDATE client_platforms
SET page_id = '112288361',
    account_id = COALESCE(account_id, '12712'),
    paused = 0,
    paused_reason = NULL,
    paused_since = NULL
WHERE platform = 'linkedin'
  AND client_id IN (SELECT id FROM clients WHERE slug = 'caliview-builders');

UPDATE client_platforms
SET page_id = '112642026',
    paused = 0,
    paused_reason = NULL,
    paused_since = NULL,
    notes = NULL
WHERE platform = 'linkedin'
  AND client_id IN (SELECT id FROM clients WHERE slug = 'americas-professional-builders');

UPDATE client_platforms
SET page_id = '112635151',
    paused = 0,
    paused_reason = NULL,
    paused_since = NULL
WHERE platform = 'linkedin'
  AND client_id IN (SELECT id FROM clients WHERE slug = 'golden-touch-roofing');

UPDATE client_platforms
SET page_id = '111968679',
    account_id = COALESCE(account_id, '12712'),
    paused = 0,
    paused_reason = NULL,
    paused_since = NULL,
    notes = NULL
WHERE platform = 'linkedin'
  AND client_id IN (
    SELECT id FROM clients
    WHERE slug IN ('unlockd-pros', 'unlocked-pros')
  );

-- Create explicit LinkedIn rows for expected clients that still have no recorded page ID.
-- These stay paused on purpose until the live Upload-Post audit supplies the real page_id.
INSERT OR IGNORE INTO client_platforms (
  id, client_id, platform, paused, paused_reason, notes
)
SELECT lower(hex(randomblob(16))), id, 'linkedin', 1,
  'LinkedIn page ID missing from repo snapshot — confirm the Upload-Post page selection before enabling automated posting.',
  'Expected LinkedIn page: 24/7 Lockout Locksmith Services'
FROM clients
WHERE slug IN ('247-lockout-locksmith', '247-lockout-pasadena');

INSERT OR IGNORE INTO client_platforms (
  id, client_id, platform, paused, paused_reason, notes
)
SELECT lower(hex(randomblob(16))), id, 'linkedin', 1,
  'LinkedIn page ID missing from repo snapshot — confirm the Upload-Post page selection before enabling automated posting.',
  'Expected LinkedIn page: 7/24 Locksmith'
FROM clients
WHERE slug IN ('724-locksmith', '724-locksmith-ca');

INSERT OR IGNORE INTO client_platforms (
  id, client_id, platform, paused, paused_reason, notes
)
SELECT lower(hex(randomblob(16))), id, 'linkedin', 1,
  'LinkedIn page ID missing from repo snapshot — confirm the Upload-Post page selection before enabling automated posting.',
  'Expected LinkedIn page: Daniel''s Lock & Keys'
FROM clients
WHERE slug IN ('daniels-locks-key', 'daniels-locksmith');

INSERT OR IGNORE INTO client_platforms (
  id, client_id, platform, paused, paused_reason, notes
)
SELECT lower(hex(randomblob(16))), id, 'linkedin', 1,
  'LinkedIn page ID missing from repo snapshot — confirm the Upload-Post page selection before enabling automated posting.',
  'Expected LinkedIn page: WebXni'
FROM clients
WHERE slug = 'webxni';

-- If the placeholder rows already existed, keep the expected page note and pause state explicit.
UPDATE client_platforms
SET paused = CASE WHEN page_id IS NULL THEN 1 ELSE paused END,
    paused_reason = CASE
      WHEN page_id IS NULL THEN 'LinkedIn page ID missing from repo snapshot — confirm the Upload-Post page selection before enabling automated posting.'
      ELSE paused_reason
    END
WHERE platform = 'linkedin'
  AND client_id IN (
    SELECT id FROM clients
    WHERE slug IN ('247-lockout-locksmith', '247-lockout-pasadena', '724-locksmith', '724-locksmith-ca', 'daniels-locks-key', 'daniels-locksmith', 'webxni')
  );
