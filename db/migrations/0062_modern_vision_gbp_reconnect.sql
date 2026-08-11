-- Reconnect Modern Vision Google Business after Upload-Post live destination verification.
-- Upload-Post profile Modern_Vision currently returns locations/18011830171106063821
-- for Modern Vision Remodeling Experts. The row had been marked failed/identity_mismatch,
-- which excluded google_business from package platform selection.

UPDATE client_platforms
SET connection_status = 'connected',
    verification_status = 'verified',
    provider_destination_id = 'locations/18011830171106063821',
    upload_post_location_id = 'locations/18011830171106063821',
    verified_business_name = 'Modern Vision Remodeling Experts',
    verified_market = 'Austin',
    verified_at = unixepoch(),
    verification_notes = 'Verified through Upload-Post Google Business locations endpoint on 2026-08-11.',
    notes = 'Modern Vision Remodeling Experts'
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling')
  AND platform = 'google_business';
