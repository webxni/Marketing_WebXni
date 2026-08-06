-- Portfolio intelligence reset generated from content-strategy-reset/*.csv.

UPDATE clients
SET owner_group = 'gabriel-locksmiths',
    owner_name = 'Gabriel Algrably',
    never_mix_with = '["247-lockout-pasadena","724-locksmith-ca","daniels-locksmith","unlocked-pros"]',
    profile_approval_status = 'approved',
    profile_approved_by = 'portfolio-reset',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug IN ('247-lockout-pasadena', '724-locksmith-ca', 'daniels-locksmith', 'unlocked-pros');

UPDATE client_research_notes
SET review_status = 'quarantined', entity_match = 0, geography_match = 0, service_match = 0,
    prohibited_service_detected = 1, confidence = 'low', reviewed_by = 'portfolio-reset',
    reviewed_at = unixepoch(), notes = 'Quarantined during Gabriel portfolio reset; excluded from generation.', updated_at = unixepoch()
WHERE client_id IN (SELECT id FROM clients WHERE slug IN ('247-lockout-pasadena', '724-locksmith-ca', 'daniels-locksmith', 'unlocked-pros'));

INSERT INTO client_research_notes
    (client_id, source, research_json, freshness_date, brand_name, source_url, source_domain, source_title,
     entity_match, geography_match, service_match, prohibited_service_detected, confidence, review_status,
     reviewed_by, reviewed_at, expires_at, notes)
  SELECT id, 'owner_editorial_policy', '{"brand":"24/7 Lockout","editorial_source":"Owner editorial policy","allowed_pillars":["residential","commercial","automotive lockout assistance only"],"prohibited_services":["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key"],"note":"Only Pasadena-area approved services and restrictions"}', '2026-08-06', '24/7 Lockout', 'internal://owner-locksmith-policy-2026-08-06',
         'internal', 'Owner editorial policy', 1, 1, 1, 0, 'high', 'approved',
         'portfolio-reset', unixepoch('2026-08-06'), '2026-11-30', 'Only Pasadena-area approved services and restrictions'
  FROM clients WHERE slug = '247-lockout-pasadena';

INSERT INTO client_research_notes
    (client_id, source, research_json, freshness_date, brand_name, source_url, source_domain, source_title,
     entity_match, geography_match, service_match, prohibited_service_detected, confidence, review_status,
     reviewed_by, reviewed_at, expires_at, notes)
  SELECT id, 'owner_editorial_policy', '{"brand":"7/24 Locksmith","editorial_source":"Owner editorial policy","allowed_pillars":["residential","commercial","automotive lockout assistance only"],"prohibited_services":["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key"],"note":"Only SFV approved services and restrictions"}', '2026-08-06', '7/24 Locksmith', 'internal://owner-locksmith-policy-2026-08-06',
         'internal', 'Owner editorial policy', 1, 1, 1, 0, 'high', 'approved',
         'portfolio-reset', unixepoch('2026-08-06'), '2026-11-30', 'Only SFV approved services and restrictions'
  FROM clients WHERE slug = '724-locksmith-ca';

INSERT INTO client_research_notes
    (client_id, source, research_json, freshness_date, brand_name, source_url, source_domain, source_title,
     entity_match, geography_match, service_match, prohibited_service_detected, confidence, review_status,
     reviewed_by, reviewed_at, expires_at, notes)
  SELECT id, 'owner_editorial_policy', '{"brand":"Daniel''s Locks & Key","editorial_source":"Owner editorial policy","allowed_pillars":["residential","commercial","automotive lockout assistance only"],"prohibited_services":["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key"],"note":"Virginia entity research quarantined"}', '2026-08-06', 'Daniel''s Locks & Key', 'internal://owner-locksmith-policy-2026-08-06',
         'internal', 'Owner editorial policy', 1, 1, 1, 0, 'high', 'approved',
         'portfolio-reset', unixepoch('2026-08-06'), '2026-11-30', 'Virginia entity research quarantined'
  FROM clients WHERE slug = 'daniels-locksmith';

INSERT INTO client_research_notes
    (client_id, source, research_json, freshness_date, brand_name, source_url, source_domain, source_title,
     entity_match, geography_match, service_match, prohibited_service_detected, confidence, review_status,
     reviewed_by, reviewed_at, expires_at, notes)
  SELECT id, 'owner_editorial_policy', '{"brand":"Unlock''D Pros","editorial_source":"Owner editorial policy","allowed_pillars":["residential","commercial","automotive lockout assistance only"],"prohibited_services":["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key"],"note":"Canadian detailing entity research quarantined"}', '2026-08-06', 'Unlock''D Pros', 'internal://owner-locksmith-policy-2026-08-06',
         'internal', 'Owner editorial policy', 1, 1, 1, 0, 'high', 'approved',
         'portfolio-reset', unixepoch('2026-08-06'), '2026-11-30', 'Canadian detailing entity research quarantined'
  FROM clients WHERE slug = 'unlocked-pros';

UPDATE client_services
SET active = 0, approval_status = 'rejected', editorial_notes = 'Replaced by approved portfolio allowlist.', updated_at = unixepoch()
WHERE client_id IN (SELECT id FROM clients WHERE slug IN ('247-lockout-pasadena', '724-locksmith-ca', 'daniels-locksmith', 'unlocked-pros'));

WITH service_data(slug, name, normalized_name, service_pillar, approval_status, editorial_notes, sort_order) AS (VALUES
  ('247-lockout-pasadena', 'House lockout assistance', 'house lockout assistance', 'residential', 'approved', 'Pasadena-area residential focus', '0'),
  ('247-lockout-pasadena', 'Apartment and condo lockout assistance', 'apartment condo lockout assistance', 'residential', 'approved', 'Tenant or owner authorization guidance', '1'),
  ('247-lockout-pasadena', 'Home rekeying', 'home rekeying', 'residential', 'approved', 'No key-copying language', '2'),
  ('247-lockout-pasadena', 'New-home rekeying', 'new home rekeying', 'residential', 'approved', 'Move-in security education', '3'),
  ('247-lockout-pasadena', 'Residential lock repair', 'residential lock repair', 'residential', 'approved', NULL, '4'),
  ('247-lockout-pasadena', 'Residential lock replacement', 'residential lock replacement', 'residential', 'approved', NULL, '5'),
  ('247-lockout-pasadena', 'Deadbolt installation and repair', 'deadbolt installation repair', 'residential', 'approved', NULL, '6'),
  ('247-lockout-pasadena', 'Broken-key extraction from residential locks', 'broken key extraction residential locks', 'residential', 'approved', 'Do not convert to replacement-key content', '7'),
  ('247-lockout-pasadena', 'Property turnover rekeying', 'property turnover rekeying', 'commercial', 'approved', 'Residential rentals only', '8'),
  ('247-lockout-pasadena', 'Car lockout assistance', 'car lockout assistance', 'automotive', 'approved', 'Vehicle entry only', '9'),
  ('247-lockout-pasadena', 'Keys locked inside a car', 'keys locked inside car', 'automotive', 'approved', 'No key generation', '10'),
  ('247-lockout-pasadena', 'Emergency vehicle entry', 'emergency vehicle entry', 'automotive', 'approved', 'No ignition or fob service', '11'),
  ('724-locksmith-ca', 'House lockout assistance', 'house lockout assistance', 'residential', 'approved', NULL, '12'),
  ('724-locksmith-ca', 'Apartment lockout assistance', 'apartment lockout assistance', 'residential', 'approved', NULL, '13'),
  ('724-locksmith-ca', 'Home rekeying', 'home rekeying', 'residential', 'approved', NULL, '14'),
  ('724-locksmith-ca', 'Residential lock repair', 'residential lock repair', 'residential', 'approved', NULL, '15'),
  ('724-locksmith-ca', 'Residential lock replacement', 'residential lock replacement', 'residential', 'approved', NULL, '16'),
  ('724-locksmith-ca', 'Deadbolt installation and repair', 'deadbolt installation repair', 'residential', 'approved', NULL, '17'),
  ('724-locksmith-ca', 'Smart-lock installation', 'smart lock installation', 'residential', 'approved', 'Questions and compatibility only', '18'),
  ('724-locksmith-ca', 'Commercial lockout assistance', 'commercial lockout assistance', 'commercial', 'approved', NULL, '19'),
  ('724-locksmith-ca', 'Office and storefront lockouts', 'office storefront lockouts', 'commercial', 'approved', NULL, '20'),
  ('724-locksmith-ca', 'Commercial rekeying', 'commercial rekeying', 'commercial', 'approved', NULL, '21'),
  ('724-locksmith-ca', 'Storefront lock repair', 'storefront lock repair', 'commercial', 'approved', NULL, '22'),
  ('724-locksmith-ca', 'Office lock repair', 'office lock repair', 'commercial', 'approved', NULL, '23'),
  ('724-locksmith-ca', 'Commercial door hardware', 'commercial door hardware', 'commercial', 'approved', NULL, '24'),
  ('724-locksmith-ca', 'Property-management rekeying', 'property management rekeying', 'commercial', 'approved', NULL, '25'),
  ('724-locksmith-ca', 'Car lockout assistance', 'car lockout assistance', 'automotive', 'approved', 'Vehicle entry only', '26'),
  ('724-locksmith-ca', 'Emergency vehicle entry', 'emergency vehicle entry', 'automotive', 'approved', 'No automotive key services', '27'),
  ('daniels-locksmith', 'Home rekeying', 'home rekeying', 'residential', 'approved', 'Primary service', '28'),
  ('daniels-locksmith', 'New-home rekeying', 'new home rekeying', 'residential', 'approved', NULL, '29'),
  ('daniels-locksmith', 'Tenant-change rekeying', 'tenant change rekeying', 'residential', 'approved', NULL, '30'),
  ('daniels-locksmith', 'Residential lock repair', 'residential lock repair', 'residential', 'approved', 'Primary service', '31'),
  ('daniels-locksmith', 'Residential lock replacement', 'residential lock replacement', 'residential', 'approved', NULL, '32'),
  ('daniels-locksmith', 'Deadbolt installation and repair', 'deadbolt installation repair', 'residential', 'approved', NULL, '33'),
  ('daniels-locksmith', 'Smart-lock installation', 'smart lock installation', 'residential', 'approved', 'Compatibility guidance only', '34'),
  ('daniels-locksmith', 'Broken-key extraction from residential locks', 'broken key extraction residential locks', 'residential', 'approved', 'No replacement-key service', '35'),
  ('daniels-locksmith', 'House and apartment lockout assistance', 'house apartment lockout assistance', 'residential', 'approved', 'Secondary emphasis', '36'),
  ('daniels-locksmith', 'Commercial lock repair', 'commercial lock repair', 'commercial', 'approved', 'Hollywood-area only', '37'),
  ('daniels-locksmith', 'Commercial rekeying', 'commercial rekeying', 'commercial', 'approved', 'Hollywood-area only', '38'),
  ('daniels-locksmith', 'Car lockout assistance', 'car lockout assistance', 'automotive', 'approved', 'One limited monthly topic', '39'),
  ('unlocked-pros', 'Commercial lockout assistance', 'commercial lockout assistance', 'commercial', 'approved', NULL, '40'),
  ('unlocked-pros', 'Office and storefront lockouts', 'office storefront lockouts', 'commercial', 'approved', NULL, '41'),
  ('unlocked-pros', 'Commercial rekeying', 'commercial rekeying', 'commercial', 'approved', 'Primary service', '42'),
  ('unlocked-pros', 'Storefront lock repair', 'storefront lock repair', 'commercial', 'approved', NULL, '43'),
  ('unlocked-pros', 'Office lock repair', 'office lock repair', 'commercial', 'approved', NULL, '44'),
  ('unlocked-pros', 'Commercial lock replacement', 'commercial lock replacement', 'commercial', 'approved', NULL, '45'),
  ('unlocked-pros', 'Commercial door hardware', 'commercial door hardware', 'commercial', 'approved', NULL, '46'),
  ('unlocked-pros', 'Master-key systems', 'master key systems', 'commercial', 'approved', 'Planning and authorization only', '47'),
  ('unlocked-pros', 'Property-management rekeying', 'property management rekeying', 'commercial', 'approved', 'Primary service', '48'),
  ('unlocked-pros', 'Apartment-building lock service', 'apartment building lock service', 'commercial', 'approved', NULL, '49'),
  ('unlocked-pros', 'Residential lock repair', 'residential lock repair', 'residential', 'approved', 'Secondary service', '50'),
  ('unlocked-pros', 'Home rekeying', 'home rekeying', 'residential', 'approved', 'Secondary service', '51'),
  ('unlocked-pros', 'Car lockout assistance', 'car lockout assistance', 'automotive', 'approved', 'Limited vehicle-entry content only', '52'),
  ('unlocked-pros', 'Electronic locks and access control', 'electronic locks access control', 'commercial', 'pending', 'Inactive until capability evidence is approved', '53')
)
INSERT INTO client_services
  (id, client_id, name, normalized_name, service_pillar, approval_status, approved_by, approved_at,
   editorial_notes, active, sort_order, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, d.name, d.normalized_name, d.service_pillar, d.approval_status,
       CASE WHEN d.approval_status = 'approved' THEN 'portfolio-reset' ELSE NULL END,
       CASE WHEN d.approval_status = 'approved' THEN unixepoch() ELSE NULL END,
       d.editorial_notes, CASE WHEN d.approval_status = 'approved' THEN 1 ELSE 0 END,
       d.sort_order, unixepoch(), unixepoch()
FROM service_data d JOIN clients c ON c.slug = d.slug;

UPDATE client_service_areas
SET approval_status = 'rejected', editorial_notes = 'Replaced by approved portfolio area list.'
WHERE client_id IN (SELECT id FROM clients WHERE slug IN ('247-lockout-pasadena', '724-locksmith-ca', 'daniels-locksmith', 'unlocked-pros'));

WITH area_data(slug, city, sort_order) AS (VALUES
  ('247-lockout-pasadena', 'Pasadena', '0'),
  ('247-lockout-pasadena', 'South Pasadena', '1'),
  ('247-lockout-pasadena', 'Altadena', '2'),
  ('247-lockout-pasadena', 'San Marino', '3'),
  ('247-lockout-pasadena', 'Arcadia', '4'),
  ('247-lockout-pasadena', 'Sierra Madre', '5'),
  ('724-locksmith-ca', 'North Hollywood', '0'),
  ('724-locksmith-ca', 'Burbank', '1'),
  ('724-locksmith-ca', 'Studio City', '2'),
  ('724-locksmith-ca', 'Valley Village', '3'),
  ('724-locksmith-ca', 'Valley Glen', '4'),
  ('724-locksmith-ca', 'Sherman Oaks', '5'),
  ('724-locksmith-ca', 'Van Nuys', '6'),
  ('724-locksmith-ca', 'Glendale', '7'),
  ('724-locksmith-ca', 'Encino', '8'),
  ('daniels-locksmith', 'Hollywood', '0'),
  ('daniels-locksmith', 'Los Angeles', '1'),
  ('unlocked-pros', 'Pasadena', '0')
)
INSERT INTO client_service_areas
  (id, client_id, city, state, primary_area, sort_order, approval_status, approved_by, approved_at, editorial_notes, created_at)
SELECT lower(hex(randomblob(16))), c.id, d.city, 'CA', CASE WHEN d.sort_order = 0 THEN 1 ELSE 0 END,
       d.sort_order, 'approved', 'portfolio-reset', unixepoch(), 'Owner-directed approved coverage.', unixepoch()
FROM area_data d JOIN clients c ON c.slug = d.slug;

UPDATE client_keywords
SET status = 'archived', approval_status = 'rejected', opportunity_notes = 'Replaced by curated portfolio keyword set.', updated_at = unixepoch()
WHERE client_id IN (SELECT id FROM clients WHERE slug IN ('247-lockout-pasadena', '724-locksmith-ca', 'daniels-locksmith', 'unlocked-pros'));

WITH keyword_data(slug, keyword, normalized_keyword, intent, service_pillar, locality, brand_owner, confidence, source, approval_status, notes) AS (VALUES
  ('247-lockout-pasadena', 'Pasadena house lockout', 'pasadena house lockout', 'transactional', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'Pasadena home lockout', 'pasadena home lockout', 'transactional', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'apartment lockout Pasadena', 'apartment lockout pasadena', 'transactional', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'condo lockout Pasadena', 'condo lockout pasadena', 'transactional', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'home rekeying Pasadena', 'home rekeying pasadena', 'transactional', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'new-home rekeying Pasadena', 'new home rekeying pasadena', 'commercial', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'residential lock repair Pasadena', 'residential lock repair pasadena', 'transactional', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'deadbolt repair Pasadena', 'deadbolt repair pasadena', 'transactional', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'lock replacement Pasadena', 'lock replacement pasadena', 'transactional', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'property rekeying Pasadena', 'property rekeying pasadena', 'commercial', 'commercial', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'car lockout Pasadena', 'car lockout pasadena', 'transactional', 'automotive', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', 'Vehicle entry only'),
  ('247-lockout-pasadena', 'South Pasadena home lockout', 'south pasadena home lockout', 'transactional', 'residential', 'South Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'Altadena house lockout', 'altadena house lockout', 'transactional', 'residential', 'Altadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'San Marino home rekeying', 'san marino home rekeying', 'commercial', 'residential', 'San Marino', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'Arcadia residential lock repair', 'arcadia residential lock repair', 'transactional', 'residential', 'Arcadia', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'Sierra Madre house lockout', 'sierra madre house lockout', 'transactional', 'residential', 'Sierra Madre', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'Pasadena rental rekeying', 'pasadena rental rekeying', 'commercial', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'Pasadena deadbolt alignment', 'pasadena deadbolt alignment', 'informational', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'proof of access locksmith Pasadena', 'proof of access locksmith pasadena', 'informational', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', NULL),
  ('247-lockout-pasadena', 'broken key extraction Pasadena', 'broken key extraction pasadena', 'transactional', 'residential', 'Pasadena', '247-lockout-pasadena', 'high', 'owner_policy', 'approved', 'Residential lock only'),
  ('724-locksmith-ca', 'North Hollywood house lockout', 'north hollywood house lockout', 'transactional', 'residential', 'North Hollywood', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'North Hollywood lock rekeying', 'north hollywood lock rekeying', 'transactional', 'residential', 'North Hollywood', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'North Hollywood residential lock repair', 'north hollywood residential lock repair', 'transactional', 'residential', 'North Hollywood', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'smart-lock installation North Hollywood', 'smart lock installation north hollywood', 'commercial', 'residential', 'North Hollywood', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Burbank storefront lock repair', 'burbank storefront lock repair', 'transactional', 'commercial', 'Burbank', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Burbank office lockout', 'burbank office lockout', 'transactional', 'commercial', 'Burbank', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'car lockout Burbank', 'car lockout burbank', 'transactional', 'automotive', 'Burbank', '724-locksmith-ca', 'high', 'owner_policy', 'approved', 'Vehicle entry only'),
  ('724-locksmith-ca', 'Studio City commercial rekeying', 'studio city commercial rekeying', 'transactional', 'commercial', 'Studio City', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Studio City car lockout', 'studio city car lockout', 'transactional', 'automotive', 'Studio City', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Valley Village apartment lock repair', 'valley village apartment lock repair', 'transactional', 'residential', 'Valley Village', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Valley Glen home rekeying', 'valley glen home rekeying', 'transactional', 'residential', 'Valley Glen', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Sherman Oaks commercial lock repair', 'sherman oaks commercial lock repair', 'transactional', 'commercial', 'Sherman Oaks', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Van Nuys property rekeying', 'van nuys property rekeying', 'commercial', 'commercial', 'Van Nuys', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Glendale office lock repair', 'glendale office lock repair', 'transactional', 'commercial', 'Glendale', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Glendale residential lock repair', 'glendale residential lock repair', 'transactional', 'residential', 'Glendale', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'Encino deadbolt repair', 'encino deadbolt repair', 'transactional', 'residential', 'Encino', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'property-management rekeying SFV', 'property management rekeying sfv', 'commercial', 'commercial', 'San Fernando Valley', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'commercial door hardware North Hollywood', 'commercial door hardware north hollywood', 'commercial', 'commercial', 'North Hollywood', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'storefront cylinder replacement Burbank', 'storefront cylinder replacement burbank', 'transactional', 'commercial', 'Burbank', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'office lock maintenance Studio City', 'office lock maintenance studio city', 'informational', 'commercial', 'Studio City', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('724-locksmith-ca', 'apartment rekeying North Hollywood', 'apartment rekeying north hollywood', 'transactional', 'residential', 'North Hollywood', '724-locksmith-ca', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'Hollywood lock rekeying', 'hollywood lock rekeying', 'transactional', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'Los Angeles residential lock repair', 'los angeles residential lock repair', 'transactional', 'residential', 'Los Angeles', 'daniels-locksmith', 'high', 'owner_policy', 'approved', 'Confirmed Hollywood-area use only'),
  ('daniels-locksmith', 'smart-lock installation Hollywood', 'smart lock installation hollywood', 'commercial', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'deadbolt repair Hollywood', 'deadbolt repair hollywood', 'transactional', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'apartment rekeying Los Angeles', 'apartment rekeying los angeles', 'transactional', 'residential', 'Los Angeles', 'daniels-locksmith', 'high', 'owner_policy', 'approved', 'Confirmed coverage only'),
  ('daniels-locksmith', 'move-in rekeying Hollywood', 'move in rekeying hollywood', 'commercial', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'commercial lock repair Hollywood', 'commercial lock repair hollywood', 'transactional', 'commercial', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'car lockout Hollywood', 'car lockout hollywood', 'transactional', 'automotive', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', 'Vehicle entry only'),
  ('daniels-locksmith', 'lock cylinder replacement Hollywood', 'lock cylinder replacement hollywood', 'transactional', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'tenant-change rekeying Hollywood', 'tenant change rekeying hollywood', 'commercial', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'broken key extraction Hollywood', 'broken key extraction hollywood', 'transactional', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', 'Residential lock only'),
  ('daniels-locksmith', 'deadbolt alignment Hollywood', 'deadbolt alignment hollywood', 'informational', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'lock repair versus replacement Hollywood', 'lock repair versus replacement hollywood', 'informational', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'smart-lock compatibility Hollywood', 'smart lock compatibility hollywood', 'informational', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'apartment lockout Hollywood', 'apartment lockout hollywood', 'transactional', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'home lockout Hollywood', 'home lockout hollywood', 'transactional', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'owner-operated locksmith Hollywood', 'owner operated locksmith hollywood', 'commercial', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', 'Process positioning only'),
  ('daniels-locksmith', 'commercial rekeying Hollywood', 'commercial rekeying hollywood', 'transactional', 'commercial', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'residential lock replacement Hollywood', 'residential lock replacement hollywood', 'transactional', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('daniels-locksmith', 'new-home rekeying Hollywood', 'new home rekeying hollywood', 'transactional', 'residential', 'Hollywood', 'daniels-locksmith', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'Pasadena commercial rekeying', 'pasadena commercial rekeying', 'transactional', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', 'Usable only after destination verification'),
  ('unlocked-pros', 'Pasadena storefront lock repair', 'pasadena storefront lock repair', 'transactional', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', 'Usable only after destination verification'),
  ('unlocked-pros', 'office lock repair Pasadena', 'office lock repair pasadena', 'transactional', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'property-management rekeying Pasadena', 'property management rekeying pasadena', 'transactional', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'apartment-building lock service Pasadena', 'apartment building lock service pasadena', 'transactional', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'commercial door hardware Pasadena', 'commercial door hardware pasadena', 'commercial', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'office lockout Pasadena', 'office lockout pasadena', 'transactional', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'master-key planning Pasadena', 'master key planning pasadena', 'commercial', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'storefront cylinder repair Pasadena', 'storefront cylinder repair pasadena', 'transactional', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'commercial lock replacement Pasadena', 'commercial lock replacement pasadena', 'transactional', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'apartment turnover rekeying Pasadena', 'apartment turnover rekeying pasadena', 'commercial', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'multi-unit lock maintenance Pasadena', 'multi unit lock maintenance pasadena', 'commercial', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'property access documentation Pasadena', 'property access documentation pasadena', 'informational', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'commercial door alignment Pasadena', 'commercial door alignment pasadena', 'informational', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'residential lock repair Pasadena', 'residential lock repair pasadena', 'transactional', 'residential', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', 'Secondary role'),
  ('unlocked-pros', 'home rekeying Pasadena commercial owner', 'home rekeying pasadena commercial owner', 'commercial', 'residential', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', 'Distinct landlord audience'),
  ('unlocked-pros', 'car lockout Pasadena business district', 'car lockout pasadena business district', 'transactional', 'automotive', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', 'Vehicle entry only'),
  ('unlocked-pros', 'commercial access planning Pasadena', 'commercial access planning pasadena', 'commercial', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'storefront lock maintenance Pasadena', 'storefront lock maintenance pasadena', 'informational', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL),
  ('unlocked-pros', 'property-manager locksmith Pasadena', 'property manager locksmith pasadena', 'commercial', 'commercial', 'Pasadena', 'unlocked-pros', 'high', 'owner_policy', 'approved', NULL)
)
INSERT INTO client_keywords
  (client_id, keyword, normalized_keyword, kw_type, search_intent, service_pillar, locality, brand_owner,
   confidence, source, approval_status, approved_by, approved_at, opportunity_notes, status, created_at, updated_at)
SELECT c.id, d.keyword, d.normalized_keyword, CASE WHEN d.intent = 'transactional' THEN 'local' ELSE 'secondary' END,
       d.intent, d.service_pillar, d.locality, d.brand_owner, d.confidence, d.source, d.approval_status,
       'portfolio-reset', unixepoch(), d.notes, 'active', unixepoch(), unixepoch()
FROM keyword_data d JOIN clients c ON c.slug = d.slug
ON CONFLICT(client_id, keyword) DO UPDATE SET
  normalized_keyword = excluded.normalized_keyword,
  kw_type = excluded.kw_type,
  search_intent = excluded.search_intent,
  service_pillar = excluded.service_pillar,
  locality = excluded.locality,
  brand_owner = excluded.brand_owner,
  confidence = excluded.confidence,
  source = excluded.source,
  approval_status = excluded.approval_status,
  approved_by = excluded.approved_by,
  approved_at = excluded.approved_at,
  opportunity_notes = excluded.opportunity_notes,
  status = 'active',
  updated_at = unixepoch();

INSERT INTO client_intelligence
    (client_id, brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals, service_priorities,
     content_angles, seasonal_notes, competitor_notes, audience_notes, primary_keyword, secondary_keywords,
     local_seo_themes, generation_language, humanization_style, feedback_summary, last_research_at, created_at, updated_at)
  SELECT id, 'Calm during urgent situations; residential-first; practical authorization and preparation guidance; locally specific; no hype or panic language.', '["calm","practical","educational","local"]',
         '["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key","20 minute arrival","25 minute arrival","starting at $50","cheapest locksmith","lowest price","nearly 500 reviews","5.0 rating","guaranteed arrival","fastest locksmith"]', '["Call to confirm current availability, service coverage, and scheduling."]',
         'Build Pasadena residential trust and generate qualified lockout rekeying and repair calls without unsupported claims.', '["House lockout assistance","Apartment and condo lockout assistance","Home rekeying","Residential lock repair","Deadbolt installation and repair","Car lockout assistance"]', '["Preparation","Authorization","Door protection","Repair versus replacement","Rental turnover","Pasadena education"]',
         'August topics must connect directly to an approved service.',
         'Sibling brands must remain distinct and portfolio duplicate cooldowns apply.', 'Homeowners renters landlords and drivers in approved Pasadena-area communities.',
         'Pasadena house lockout', '["Pasadena home lockout","apartment lockout Pasadena","condo lockout Pasadena","home rekeying Pasadena","new-home rekeying Pasadena","residential lock repair Pasadena","deadbolt repair Pasadena","lock replacement Pasadena","property rekeying Pasadena","car lockout Pasadena","South Pasadena home lockout","Altadena house lockout","San Marino home rekeying","Arcadia residential lock repair","Sierra Madre house lockout","Pasadena rental rekeying","Pasadena deadbolt alignment","proof of access locksmith Pasadena","broken key extraction Pasadena"]', '["Pasadena","South Pasadena","Altadena","San Marino","Arcadia","Sierra Madre"]',
         'en', 'clear and human', 'Use only approved source records; preserve rejected-topic memory.', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = '247-lockout-pasadena'
  ON CONFLICT(client_id) DO UPDATE SET
    brand_voice = excluded.brand_voice, tone_keywords = excluded.tone_keywords,
    prohibited_terms = excluded.prohibited_terms, approved_ctas = excluded.approved_ctas,
    content_goals = excluded.content_goals, service_priorities = excluded.service_priorities,
    content_angles = excluded.content_angles, seasonal_notes = excluded.seasonal_notes,
    competitor_notes = excluded.competitor_notes, audience_notes = excluded.audience_notes,
    primary_keyword = excluded.primary_keyword, secondary_keywords = excluded.secondary_keywords,
    local_seo_themes = excluded.local_seo_themes, generation_language = excluded.generation_language,
    humanization_style = excluded.humanization_style, feedback_summary = excluded.feedback_summary,
    last_research_at = excluded.last_research_at, updated_at = unixepoch();

INSERT INTO client_intelligence
    (client_id, brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals, service_priorities,
     content_angles, seasonal_notes, competitor_notes, audience_notes, primary_keyword, secondary_keywords,
     local_seo_themes, generation_language, humanization_style, feedback_summary, last_research_at, created_at, updated_at)
  SELECT id, 'Practical service-oriented and educational; balanced residential and commercial voice; clear mobile-service expectations.', '["calm","practical","educational","local"]',
         '["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key","20 minute arrival","25 minute arrival","starting at $50","cheapest locksmith","lowest price","nearly 500 reviews","5.0 rating","guaranteed arrival","fastest locksmith"]', '["Call to confirm current availability, service coverage, and scheduling."]',
         'Own qualified North Hollywood Burbank and Studio City residential and commercial lock-service demand.', '["Residential lock repair","Home rekeying","Storefront lock repair","Commercial rekeying","Commercial door hardware","Car lockout assistance"]', '["Maintenance","Property-manager workflow","Door hardware","Service preparation","Repair decisions","SFV local education"]',
         'August topics must connect directly to an approved service.',
         'Sibling brands must remain distinct and portfolio duplicate cooldowns apply.', 'Households storefronts offices landlords and property managers in approved SFV markets.',
         'North Hollywood house lockout', '["North Hollywood lock rekeying","North Hollywood residential lock repair","smart-lock installation North Hollywood","Burbank storefront lock repair","Burbank office lockout","car lockout Burbank","Studio City commercial rekeying","Studio City car lockout","Valley Village apartment lock repair","Valley Glen home rekeying","Sherman Oaks commercial lock repair","Van Nuys property rekeying","Glendale office lock repair","Glendale residential lock repair","Encino deadbolt repair","property-management rekeying SFV","commercial door hardware North Hollywood","storefront cylinder replacement Burbank","office lock maintenance Studio City","apartment rekeying North Hollywood"]', '["North Hollywood","Burbank","Studio City","Valley Village","Valley Glen","Sherman Oaks","Van Nuys","Glendale","Encino"]',
         'en', 'clear and human', 'Use only approved source records; preserve rejected-topic memory.', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = '724-locksmith-ca'
  ON CONFLICT(client_id) DO UPDATE SET
    brand_voice = excluded.brand_voice, tone_keywords = excluded.tone_keywords,
    prohibited_terms = excluded.prohibited_terms, approved_ctas = excluded.approved_ctas,
    content_goals = excluded.content_goals, service_priorities = excluded.service_priorities,
    content_angles = excluded.content_angles, seasonal_notes = excluded.seasonal_notes,
    competitor_notes = excluded.competitor_notes, audience_notes = excluded.audience_notes,
    primary_keyword = excluded.primary_keyword, secondary_keywords = excluded.secondary_keywords,
    local_seo_themes = excluded.local_seo_themes, generation_language = excluded.generation_language,
    humanization_style = excluded.humanization_style, feedback_summary = excluded.feedback_summary,
    last_research_at = excluded.last_research_at, updated_at = unixepoch();

INSERT INTO client_intelligence
    (client_id, brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals, service_priorities,
     content_angles, seasonal_notes, competitor_notes, audience_notes, primary_keyword, secondary_keywords,
     local_seo_themes, generation_language, humanization_style, feedback_summary, last_research_at, created_at, updated_at)
  SELECT id, 'Owner-operated personal educational and detail-oriented; less emergency-heavy than sibling brands.', '["calm","practical","educational","local"]',
         '["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key","20 minute arrival","25 minute arrival","starting at $50","cheapest locksmith","lowest price","nearly 500 reviews","5.0 rating","guaranteed arrival","fastest locksmith"]', '["Call to confirm current availability, service coverage, and scheduling."]',
         'Build Hollywood-area authority for rekeying lock repair deadbolts and confirmed smart-lock service.', '["Home rekeying","Residential lock repair","Deadbolt installation and repair","Smart-lock installation","House and apartment lockout assistance"]', '["Component diagnosis","Compatibility","Move-in planning","Tenant changes","Owner communication","Repair versus replacement"]',
         'August topics must connect directly to an approved service.',
         'Sibling brands must remain distinct and portfolio duplicate cooldowns apply.', 'Hollywood-area homeowners renters small property operators and limited local commercial clients.',
         'Hollywood lock rekeying', '["Los Angeles residential lock repair","smart-lock installation Hollywood","deadbolt repair Hollywood","apartment rekeying Los Angeles","move-in rekeying Hollywood","commercial lock repair Hollywood","car lockout Hollywood","lock cylinder replacement Hollywood","tenant-change rekeying Hollywood","broken key extraction Hollywood","deadbolt alignment Hollywood","lock repair versus replacement Hollywood","smart-lock compatibility Hollywood","apartment lockout Hollywood","home lockout Hollywood","owner-operated locksmith Hollywood","commercial rekeying Hollywood","residential lock replacement Hollywood","new-home rekeying Hollywood"]', '["Hollywood","Los Angeles"]',
         'en', 'clear and human', 'Use only approved source records; preserve rejected-topic memory.', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = 'daniels-locksmith'
  ON CONFLICT(client_id) DO UPDATE SET
    brand_voice = excluded.brand_voice, tone_keywords = excluded.tone_keywords,
    prohibited_terms = excluded.prohibited_terms, approved_ctas = excluded.approved_ctas,
    content_goals = excluded.content_goals, service_priorities = excluded.service_priorities,
    content_angles = excluded.content_angles, seasonal_notes = excluded.seasonal_notes,
    competitor_notes = excluded.competitor_notes, audience_notes = excluded.audience_notes,
    primary_keyword = excluded.primary_keyword, secondary_keywords = excluded.secondary_keywords,
    local_seo_themes = excluded.local_seo_themes, generation_language = excluded.generation_language,
    humanization_style = excluded.humanization_style, feedback_summary = excluded.feedback_summary,
    last_research_at = excluded.last_research_at, updated_at = unixepoch();

INSERT INTO client_intelligence
    (client_id, brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals, service_priorities,
     content_angles, seasonal_notes, competitor_notes, audience_notes, primary_keyword, secondary_keywords,
     local_seo_themes, generation_language, humanization_style, feedback_summary, last_research_at, created_at, updated_at)
  SELECT id, 'Professional systems-oriented and documentation-focused; commercial and property-management first; planned rather than emergency-heavy.', '["calm","practical","educational","local"]',
         '["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key","20 minute arrival","25 minute arrival","starting at $50","cheapest locksmith","lowest price","nearly 500 reviews","5.0 rating","guaranteed arrival","fastest locksmith"]', '["Call to confirm current availability, service coverage, and scheduling."]',
         'Build Pasadena commercial and property-management authority after authoritative GBP mapping is approved.', '["Commercial rekeying","Storefront lock repair","Office lock repair","Commercial door hardware","Property-management rekeying","Apartment-building lock service"]', '["Access changes","Documentation","Multi-unit workflow","Hardware inventory","Maintenance planning","Authorization"]',
         'August topics must connect directly to an approved service.',
         'Sibling brands must remain distinct and portfolio duplicate cooldowns apply.', 'Property managers storefront operators office administrators and building owners in the verified Pasadena market.',
         'Pasadena commercial rekeying', '["Pasadena storefront lock repair","office lock repair Pasadena","property-management rekeying Pasadena","apartment-building lock service Pasadena","commercial door hardware Pasadena","office lockout Pasadena","master-key planning Pasadena","storefront cylinder repair Pasadena","commercial lock replacement Pasadena","apartment turnover rekeying Pasadena","multi-unit lock maintenance Pasadena","property access documentation Pasadena","commercial door alignment Pasadena","residential lock repair Pasadena","home rekeying Pasadena commercial owner","car lockout Pasadena business district","commercial access planning Pasadena","storefront lock maintenance Pasadena","property-manager locksmith Pasadena"]', '["Pasadena"]',
         'en', 'clear and human', 'Use only approved source records; preserve rejected-topic memory.', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = 'unlocked-pros'
  ON CONFLICT(client_id) DO UPDATE SET
    brand_voice = excluded.brand_voice, tone_keywords = excluded.tone_keywords,
    prohibited_terms = excluded.prohibited_terms, approved_ctas = excluded.approved_ctas,
    content_goals = excluded.content_goals, service_priorities = excluded.service_priorities,
    content_angles = excluded.content_angles, seasonal_notes = excluded.seasonal_notes,
    competitor_notes = excluded.competitor_notes, audience_notes = excluded.audience_notes,
    primary_keyword = excluded.primary_keyword, secondary_keywords = excluded.secondary_keywords,
    local_seo_themes = excluded.local_seo_themes, generation_language = excluded.generation_language,
    humanization_style = excluded.humanization_style, feedback_summary = excluded.feedback_summary,
    last_research_at = excluded.last_research_at, updated_at = unixepoch();

WITH restricted(term) AS (VALUES
  ('key copying'),
  ('key duplication'),
  ('duplicate keys'),
  ('key cutting'),
  ('car key replacement'),
  ('vehicle key replacement'),
  ('remote key'),
  ('coded key'),
  ('digital key'),
  ('key fob'),
  ('fob creation'),
  ('key programming'),
  ('reprogramming'),
  ('transponder'),
  ('chip key'),
  ('ignition repair'),
  ('ignition replacement'),
  ('motorcycle key'),
  ('20 minute arrival'),
  ('25 minute arrival'),
  ('starting at $50'),
  ('cheapest locksmith'),
  ('lowest price'),
  ('nearly 500 reviews'),
  ('5.0 rating'),
  ('guaranteed arrival'),
  ('fastest locksmith')
)
INSERT OR IGNORE INTO client_restrictions (client_id, term)
SELECT c.id, r.term FROM clients c CROSS JOIN restricted r WHERE c.slug IN ('247-lockout-pasadena', '724-locksmith-ca', 'daniels-locksmith', 'unlocked-pros');

UPDATE client_strategy_plans
SET status = 'archived', updated_at = unixepoch()
WHERE client_id IN (SELECT id FROM clients WHERE slug IN ('247-lockout-pasadena', '724-locksmith-ca', 'daniels-locksmith', 'unlocked-pros'))
  AND period_start <= '2026-08-31' AND period_end >= '2026-08-01';

INSERT INTO client_strategy_plans
    (client_id, period_start, period_end, strategy_json, status, created_at, updated_at)
  SELECT id, '2026-08-01', '2026-08-31', '{"identity":"Pasadena emergency and residential lockout specialist","mix":"8 residential lockout; 5 rekey/repair; 3 apartment/rental; 3 car lockout; 3 local; 2 trust/process; 1 offer; 1 seasonal","policy":"content-strategy-reset/01-global-editorial-policy.md"}',
         'approved', unixepoch(), unixepoch() FROM clients WHERE slug = '247-lockout-pasadena';

INSERT INTO client_strategy_plans
    (client_id, period_start, period_end, strategy_json, status, created_at, updated_at)
  SELECT id, '2026-08-01', '2026-08-31', '{"identity":"North Hollywood Burbank and Studio City residential and commercial lock service","mix":"7 residential; 6 commercial; 4 rekey/repair; 3 car lockout; 3 local; 2 trust/process; 1 offer","policy":"content-strategy-reset/01-global-editorial-policy.md"}',
         'approved', unixepoch(), unixepoch() FROM clients WHERE slug = '724-locksmith-ca';

INSERT INTO client_strategy_plans
    (client_id, period_start, period_end, strategy_json, status, created_at, updated_at)
  SELECT id, '2026-08-01', '2026-08-31', '{"identity":"Hollywood owner-operated rekeying lock repair and smart-lock service","mix":"7 rekeying; 6 repair; 4 smart-lock/deadbolt; 3 residential lockout; 2 commercial; 2 trust; 1 car lockout; 1 seasonal","policy":"content-strategy-reset/01-global-editorial-policy.md"}',
         'approved', unixepoch(), unixepoch() FROM clients WHERE slug = 'daniels-locksmith';

INSERT INTO client_strategy_plans
    (client_id, period_start, period_end, strategy_json, status, created_at, updated_at)
  SELECT id, '2026-08-01', '2026-08-31', '{"identity":"Pasadena commercial property-management and conditional electronic-lock service","mix":"8 commercial; 6 property/multi-unit; 4 conditional electronic; 3 residential; 2 car lockout; 2 trust; 1 offer","policy":"content-strategy-reset/01-global-editorial-policy.md"}',
         'approved', unixepoch(), unixepoch() FROM clients WHERE slug = 'unlocked-pros';

INSERT INTO client_monthly_content_plans
    (client_id, plan_month, monthly_focus, promotion_notes, priority_services, notes, created_by,
     status, expected_slots, approved_by, approved_at, created_at, updated_at)
  SELECT id, '2026-08', 'Pasadena emergency and residential lockout specialist', 'No offer may generate until approved_offer_terms is approved.',
         '["House lockout assistance","Apartment and condo lockout assistance","Home rekeying","Residential lock repair","Deadbolt installation and repair","Car lockout assistance"]', '8 residential lockout; 5 rekey/repair; 3 apartment/rental; 3 car lockout; 3 local; 2 trust/process; 1 offer; 1 seasonal', 'portfolio-reset',
         'approved', 26, 'portfolio-reset', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = '247-lockout-pasadena'
  ON CONFLICT(client_id, plan_month) DO UPDATE SET
    monthly_focus = excluded.monthly_focus, promotion_notes = excluded.promotion_notes,
    priority_services = excluded.priority_services, notes = excluded.notes, created_by = excluded.created_by,
    status = 'approved', expected_slots = 26, approved_by = 'portfolio-reset',
    approved_at = unixepoch(), updated_at = unixepoch();

INSERT INTO client_monthly_content_plans
    (client_id, plan_month, monthly_focus, promotion_notes, priority_services, notes, created_by,
     status, expected_slots, approved_by, approved_at, created_at, updated_at)
  SELECT id, '2026-08', 'North Hollywood Burbank and Studio City residential and commercial lock service', 'No offer may generate until approved_offer_terms is approved.',
         '["Residential lock repair","Home rekeying","Storefront lock repair","Commercial rekeying","Commercial door hardware","Car lockout assistance"]', '7 residential; 6 commercial; 4 rekey/repair; 3 car lockout; 3 local; 2 trust/process; 1 offer', 'portfolio-reset',
         'approved', 26, 'portfolio-reset', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = '724-locksmith-ca'
  ON CONFLICT(client_id, plan_month) DO UPDATE SET
    monthly_focus = excluded.monthly_focus, promotion_notes = excluded.promotion_notes,
    priority_services = excluded.priority_services, notes = excluded.notes, created_by = excluded.created_by,
    status = 'approved', expected_slots = 26, approved_by = 'portfolio-reset',
    approved_at = unixepoch(), updated_at = unixepoch();

INSERT INTO client_monthly_content_plans
    (client_id, plan_month, monthly_focus, promotion_notes, priority_services, notes, created_by,
     status, expected_slots, approved_by, approved_at, created_at, updated_at)
  SELECT id, '2026-08', 'Hollywood owner-operated rekeying lock repair and smart-lock service', 'No offer may generate until approved_offer_terms is approved.',
         '["Home rekeying","Residential lock repair","Deadbolt installation and repair","Smart-lock installation","House and apartment lockout assistance"]', '7 rekeying; 6 repair; 4 smart-lock/deadbolt; 3 residential lockout; 2 commercial; 2 trust; 1 car lockout; 1 seasonal', 'portfolio-reset',
         'approved', 26, 'portfolio-reset', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = 'daniels-locksmith'
  ON CONFLICT(client_id, plan_month) DO UPDATE SET
    monthly_focus = excluded.monthly_focus, promotion_notes = excluded.promotion_notes,
    priority_services = excluded.priority_services, notes = excluded.notes, created_by = excluded.created_by,
    status = 'approved', expected_slots = 26, approved_by = 'portfolio-reset',
    approved_at = unixepoch(), updated_at = unixepoch();

INSERT INTO client_monthly_content_plans
    (client_id, plan_month, monthly_focus, promotion_notes, priority_services, notes, created_by,
     status, expected_slots, approved_by, approved_at, created_at, updated_at)
  SELECT id, '2026-08', 'Pasadena commercial property-management and conditional electronic-lock service', 'No offer may generate until approved_offer_terms is approved.',
         '["Commercial rekeying","Storefront lock repair","Office lock repair","Commercial door hardware","Property-management rekeying","Apartment-building lock service"]', '8 commercial; 6 property/multi-unit; 4 conditional electronic; 3 residential; 2 car lockout; 2 trust; 1 offer', 'portfolio-reset',
         'approved', 26, 'portfolio-reset', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = 'unlocked-pros'
  ON CONFLICT(client_id, plan_month) DO UPDATE SET
    monthly_focus = excluded.monthly_focus, promotion_notes = excluded.promotion_notes,
    priority_services = excluded.priority_services, notes = excluded.notes, created_by = excluded.created_by,
    status = 'approved', expected_slots = 26, approved_by = 'portfolio-reset',
    approved_at = unixepoch(), updated_at = unixepoch();

INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, 'neutral_availability', 'Call to confirm current availability service coverage and scheduling', 'cta', NULL,
         'Owner-directed neutral fallback', 'approved', 'portfolio-reset',
         unixepoch('2026-08-06'), '2026-11-30', 'No response-time or 24/7 availability implication', unixepoch(), unixepoch()
  FROM clients WHERE slug = '247-lockout-pasadena'
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();

INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, 'neutral_availability', 'Call to confirm current availability service coverage and scheduling', 'cta', NULL,
         'Owner-directed neutral fallback', 'approved', 'portfolio-reset',
         unixepoch('2026-08-06'), '2026-11-30', 'No response-time or 24/7 availability implication', unixepoch(), unixepoch()
  FROM clients WHERE slug = '724-locksmith-ca'
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();

INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, 'neutral_availability', 'Call to confirm current availability service coverage and scheduling', 'cta', NULL,
         'Owner-directed neutral fallback', 'approved', 'portfolio-reset',
         unixepoch('2026-08-06'), '2026-11-30', 'No response-time implication', unixepoch(), unixepoch()
  FROM clients WHERE slug = 'daniels-locksmith'
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();

INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, 'neutral_availability', 'Call to confirm current availability service coverage and scheduling', 'cta', NULL,
         'Owner-directed neutral fallback', 'approved', 'portfolio-reset',
         unixepoch('2026-08-06'), '2026-11-30', 'No response-time implication', unixepoch(), unixepoch()
  FROM clients WHERE slug = 'unlocked-pros'
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();

INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, 'approved_offer_terms', 'Owner-approved offer terms', 'promotion', NULL,
         'Price discount eligibility exclusions dates and redemption not supplied', 'pending', NULL,
         NULL, '2026-08-31', 'Blocks offer-slot generation', unixepoch(), unixepoch()
  FROM clients WHERE slug = '247-lockout-pasadena'
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();

INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, 'approved_offer_terms', 'Owner-approved offer terms', 'promotion', NULL,
         'Price discount eligibility exclusions dates and redemption not supplied', 'pending', NULL,
         NULL, '2026-08-31', 'Blocks offer-slot generation', unixepoch(), unixepoch()
  FROM clients WHERE slug = '724-locksmith-ca'
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();

INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, 'approved_offer_terms', 'Owner-approved seasonal terms', 'promotion', NULL,
         'Terms not supplied', 'pending', NULL,
         NULL, '2026-08-31', 'Blocks seasonal promotion generation', unixepoch(), unixepoch()
  FROM clients WHERE slug = 'daniels-locksmith'
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();

INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, 'approved_offer_terms', 'Owner-approved offer terms', 'promotion', NULL,
         'Terms not supplied', 'pending', NULL,
         NULL, '2026-08-31', 'Blocks offer-slot generation', unixepoch(), unixepoch()
  FROM clients WHERE slug = 'unlocked-pros'
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();

INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, 'electronic_lock_service_confirmation', 'Confirmed electronic-lock and access-control scope', 'service_evidence', NULL,
         'Service capability not yet evidenced', 'pending', NULL,
         NULL, NULL, 'Blocks four conditional slots', unixepoch(), unixepoch()
  FROM clients WHERE slug = 'unlocked-pros'
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();

UPDATE client_platforms
SET verification_status = CASE
      WHEN platform = 'google_business' THEN 'pending_identity'
      WHEN connection_status = 'connected' AND paused = 0 THEN 'verified'
      ELSE 'provider_unhealthy'
    END,
    provider_destination_id = COALESCE(page_id, upload_post_board_id, account_id, username),
    verified_business_name = CASE WHEN platform = 'google_business' THEN NULL ELSE COALESCE(profile_username, username) END,
    verified_phone = NULL,
    verified_market = NULL,
    verified_at = CASE WHEN platform != 'google_business' AND connection_status = 'connected' AND paused = 0 THEN unixepoch() ELSE NULL END,
    verification_notes = CASE
      WHEN platform = 'google_business' THEN 'Live business name phone and market verification required.'
      ELSE 'Upload-Post account was connected during the August portfolio audit.'
    END
WHERE client_id IN (SELECT id FROM clients WHERE slug IN ('247-lockout-pasadena', '724-locksmith-ca', 'daniels-locksmith', 'unlocked-pros'));

UPDATE client_platforms
SET verified_market = CASE
      WHEN client_id = (SELECT id FROM clients WHERE slug = '247-lockout-pasadena') THEN 'Pasadena'
      WHEN client_id = (SELECT id FROM clients WHERE slug = '724-locksmith-ca') THEN 'North Hollywood'
      ELSE verified_market
    END
WHERE platform = 'google_business'
  AND client_id IN (SELECT id FROM clients WHERE slug IN ('247-lockout-pasadena', '724-locksmith-ca'));

UPDATE client_platforms SET upload_post_board_id = '1129981431446007095', verification_status = 'verified', verified_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = '724-locksmith-ca') AND platform = 'pinterest';

UPDATE client_platforms
SET username = 'accounts_112906754238408611175', upload_post_location_id = 'locations/908727413318428834',
    provider_destination_id = 'locations/908727413318428834', connection_status = 'connected',
    verification_status = 'pending_identity', verified_business_name = NULL, verified_phone = NULL,
    verified_market = 'Hollywood', verified_at = NULL,
    verification_notes = 'Canonical live ID replaced stale mapping; identity check still required.'
WHERE client_id = (SELECT id FROM clients WHERE slug = 'daniels-locksmith') AND platform = 'google_business';

UPDATE client_platforms
SET verification_status = 'pending_identity', verified_business_name = NULL, verified_phone = NULL,
    verified_market = 'Pasadena', verified_at = NULL,
    verification_notes = 'Two live profiles require distinct identity approval before GBP publishing.'
WHERE client_id = (SELECT id FROM clients WHERE slug = 'unlocked-pros') AND platform = 'google_business';

UPDATE client_gbp_locations
SET label = CASE upload_post_profile WHEN 'UnlockD_Pros' THEN 'Pasadena Primary' ELSE 'Pasadena Secondary' END,
    verification_status = 'pending_identity', verified_business_name = NULL, verified_phone = NULL,
    verified_address = NULL, verified_market = 'Pasadena', verified_at = NULL,
    verification_notes = 'Profile-specific business name phone address and market must be verified live.'
WHERE client_id = (SELECT id FROM clients WHERE slug = 'unlocked-pros');
