-- Replace stale locksmith profile narratives with the approved portfolio profiles.

UPDATE clients
SET notes = 'Pasadena-area residential lockout, rekeying, lock repair, deadbolt, smart-lock, and limited car-lockout assistance. Use only approved Pasadena-area coverage and neutral availability language.',
    brand_json = '{"editorial_identity":"Pasadena emergency and residential lockout specialist","approved_service_pillars":["residential","commercial","automotive lockout assistance only"],"approved_areas":["Pasadena","South Pasadena","Altadena","San Marino","Arcadia","Sierra Madre"],"approved_services":["House lockout assistance","Apartment and condo lockout assistance","Home rekeying","Residential lock repair","Deadbolt installation and repair","Car lockout assistance"],"automotive_scope":"Vehicle entry and car lockout assistance only","prohibited_services":["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key"],"claims_policy":"Use only approved claims. Otherwise use the neutral approved CTA.","profile_source":"owner-locksmith-policy-2026-08-06"}',
    cta_text = 'Call to confirm current availability, service coverage, and scheduling.',
    cta_label = 'Call to confirm',
    profile_approval_status = 'approved',
    profile_approved_by = 'portfolio-reset',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug = '247-lockout-pasadena';

UPDATE clients
SET notes = 'North Hollywood, Burbank, and Studio City residential and commercial lock service with approved San Fernando Valley coverage. Automotive scope is vehicle entry and car lockout assistance only.',
    brand_json = '{"editorial_identity":"North Hollywood, Burbank, and Studio City residential and commercial lock service","approved_service_pillars":["residential","commercial","automotive lockout assistance only"],"approved_areas":["North Hollywood","Burbank","Studio City","Valley Village","Valley Glen","Sherman Oaks","Van Nuys","Glendale","Encino"],"approved_services":["Residential lock repair","Home rekeying","Storefront lock repair","Commercial rekeying","Commercial door hardware","Car lockout assistance"],"automotive_scope":"Vehicle entry and car lockout assistance only","prohibited_services":["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key"],"claims_policy":"Use only approved claims. Otherwise use the neutral approved CTA.","profile_source":"owner-locksmith-policy-2026-08-06"}',
    cta_text = 'Call to confirm current availability, service coverage, and scheduling.',
    cta_label = 'Call to confirm',
    profile_approval_status = 'approved',
    profile_approved_by = 'portfolio-reset',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug = '724-locksmith-ca';

UPDATE clients
SET notes = 'Hollywood-area owner-operated rekeying, residential lock repair, deadbolt, smart-lock, limited commercial, and car-lockout assistance. Pasadena, Sherman Oaks, and Burbank targeting remains held.',
    brand_json = '{"editorial_identity":"Hollywood-area owner-operated rekeying, lock repair, deadbolt, and smart-lock service","approved_service_pillars":["residential","commercial","automotive lockout assistance only"],"approved_areas":["Hollywood","Los Angeles"],"approved_services":["Home rekeying","Residential lock repair","Deadbolt installation and repair","Smart-lock installation","House and apartment lockout assistance"],"automotive_scope":"One limited Hollywood car-lockout education topic; vehicle entry only","prohibited_services":["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key"],"claims_policy":"Use only approved claims. Otherwise use the neutral approved CTA.","profile_source":"owner-locksmith-policy-2026-08-06"}',
    cta_text = 'Call to confirm current availability, service coverage, and scheduling.',
    cta_label = 'Call to confirm',
    profile_approval_status = 'approved',
    profile_approved_by = 'portfolio-reset',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug = 'daniels-locksmith';

UPDATE clients
SET notes = 'Pasadena commercial and property-management lock service. Electronic-lock, access-control, offer, and location-specific claims remain held until their evidence and destination records are approved.',
    brand_json = '{"editorial_identity":"Pasadena commercial and property-management lock service","approved_service_pillars":["residential","commercial","automotive lockout assistance only"],"approved_areas":["Pasadena"],"approved_services":["Commercial rekeying","Storefront lock repair","Office lock repair","Commercial door hardware","Property-management rekeying","Apartment-building lock service"],"automotive_scope":"Limited secondary car-lockout assistance; vehicle entry only","prohibited_services":["key copying","key duplication","duplicate keys","key cutting","car key replacement","vehicle key replacement","remote key","coded key","digital key","key fob","fob creation","key programming","reprogramming","transponder","chip key","ignition repair","ignition replacement","motorcycle key"],"claims_policy":"Use only approved claims. Otherwise use the neutral approved CTA.","profile_source":"owner-locksmith-policy-2026-08-06"}',
    cta_text = 'Call to confirm current availability, service coverage, and scheduling.',
    cta_label = 'Call to confirm',
    profile_approval_status = 'approved',
    profile_approved_by = 'portfolio-reset',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug = 'unlocked-pros';
