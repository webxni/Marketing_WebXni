-- Multi-location ("two profile") Google Business setup.
-- Activates Elite Team Builders' WA location, repoints Unlock'D Pros' stale GBP
-- location, and registers Unlock'D Pros' two Google listings so each location
-- posts with its own caption (generation already emits per-location captions
-- when client_gbp_locations has >1 row with a caption_field).

-- 1) Elite Team Builders — activate WA (CA/LA already active), keep OR paused
--    (Oregon still pending Google verification).
UPDATE client_gbp_locations
SET paused = 0, paused_reason = NULL
WHERE client_id = '0d36aaa77c7f8b78543eed61d' AND lower(label) = 'wa';

UPDATE client_gbp_locations
SET paused = 1, paused_reason = 'Pending Google verification — do not post until confirmed'
WHERE client_id = '0d36aaa77c7f8b78543eed61d' AND lower(label) = 'or';

-- 2) Unlock'D Pros — the GBP platform row pointed at locations/5300424169079943677,
--    which is NOT present in the UnlockD_Pros Upload-Post profile (caused
--    connection_status=failed). Repoint to the primary listing in the profile.
UPDATE client_platforms
SET upload_post_location_id = 'locations/12106510679330317066'
WHERE client_id = 'f59263fc783c47e5b8d0ddf9dfe8cdd0' AND platform = 'google_business';

-- 3) Unlock'D Pros already has its two client_gbp_locations rows configured:
--      locations/12106510679330317066  profile UnlockD_Pros    caption cap_gbp_la
--      locations/3082714888579803430   profile UnlockD_Pros_2  caption cap_gbp_wa
--    (both active). No insert needed — adding rows here would duplicate them.
--    The repoint in step 2 aligns the GBP platform row with the primary listing.
