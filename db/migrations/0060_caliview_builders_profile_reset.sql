-- Install the owner-approved Cali View Builders profile and Medium-package August plan.

UPDATE clients
SET canonical_name = 'Cali View Builders',
    notes = 'Family-owned Los Angeles general contractor serving the approved Los Angeles County markets. Focus content on verified project transformations, homeowner goals, functionality, craftsmanship, customer experience, and clear design-build coordination. Do not invent credentials, project facts, prices, timelines, permit outcomes, offers, or guarantees.',
    brand_json = '{"company_name":"Cali View Builders","primary_color":"#1a3c6e","accent_color":"#f59e0b","brand_overview":"Family-owned Los Angeles general contractor specializing in residential remodeling, ADUs, garage conversions, room additions, renovations, and new construction.","editorial_identity":"Experienced remodeling and construction expert helping homeowners make confident decisions","personality":["professional","trustworthy","knowledgeable","family-oriented","transparent","solution-focused","detail-oriented"],"messaging_focus":["project transformations","home value improvements without guarantees","functionality improvements","professional craftsmanship","customer experience","design-build solutions","reducing avoidable remodeling stress"],"preferred_phrases":["Our clients wanted...","Here''s how we transformed this space...","One thing homeowners often ask us...","This project added both functionality and value...","Let''s bring your vision to life."],"audience":{"age_range":"35-70","household_income":"$150,000+","home_value":"$750,000+","type":"homeowners"},"content_evidence_policy":"Use real project stories, construction progress, design challenges, before-and-after results, material selections, homeowner goals, and project outcomes only when supporting project details or assets are verified.","service_tiers":{"tier_1":["ADUs","Garage Conversions","Kitchen Remodeling","Bathroom Remodeling"],"tier_2":["Room Additions","Major Renovations","New Construction"],"tier_3":["Roofing","Foundation Retrofit","Insulation","Windows","Painting","Landscape Projects"]},"primary_areas":["Los Angeles","Pasadena","Glendale","Burbank","North Hollywood","Sherman Oaks"],"secondary_areas":["Beverly Hills","West Hollywood","Culver City","Inglewood","Santa Monica","Monterey Park","San Gabriel","Studio City"],"phone":"(323) 484-8458","profile_source":"owner-profile-2026-08-06"}',
    cta_text = 'Book Your Free Consultation',
    cta_label = 'Book Your Free Consultation',
    industry = 'Residential General Contractor',
    state = 'CA',
    profile_approval_status = 'approved',
    profile_approved_by = 'owner-profile-2026-08-06',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug = 'caliview-builders';

INSERT INTO client_intelligence
    (client_id, brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals,
     service_priorities, content_angles, seasonal_notes, competitor_notes, audience_notes,
     primary_keyword, secondary_keywords, local_seo_themes, generation_language,
     humanization_style, monthly_snapshot, feedback_summary, last_research_at, created_at, updated_at)
SELECT id,
       'Write as an experienced Cali View project manager, builder, or owner helping homeowners make confident remodeling and construction decisions. Be professional, trustworthy, knowledgeable, family-oriented, transparent, solution-focused, detail-oriented, human, helpful, educational, honest, and experienced without sounding corporate or overly promotional.',
       '["professional","trustworthy","knowledgeable","family-oriented","transparent","solution-focused","detail-oriented","human","helpful","educational","honest","experienced"]',
       '["Cheapest Contractor","Lowest Price","Budget Remodel","Cheap Construction","Guaranteed Lowest Cost","Act Now!!!","Limited Time Only!!!","Best Price In California"]',
       '["Book Your Free Consultation","Get Your Free Estimate","Start Your Project","Contact Our Team Today","Request A Consultation","Explore Your Remodeling Options","Schedule Your Free Project Review","See What''s Possible For Your Home"]',
       '["Generate consultation requests","Generate estimate requests","Build trust and authority","Showcase project quality","Increase local visibility","Generate ADU and remodeling leads"]',
       '[{"tier":1,"services":["ADUs","Garage Conversions","Kitchen Remodeling","Bathroom Remodeling"]},{"tier":2,"services":["Room Additions","Major Renovations","New Construction"]},{"tier":3,"services":["Roofing","Foundation Retrofit","Insulation","Windows","Painting","Landscape Projects"]}]',
       '["Verified project transformation","Homeowner goal and recommended solution","Construction progress with approved footage","Design challenge and resolution","Before-and-after result with approved assets","Material selection education","Functionality improvement","Design-build process transparency","Customer experience without fabricated testimonials"]',
       'Use seasonal angles only when tied to a verified project need, confirmed local condition, or relevant planning decision. Never invent an offer, deadline, event, urgency, permit outcome, or construction timeline.',
       'Avoid generic contractor copy, corporate language, unsupported credentials, value guarantees, price-led positioning, and interchangeable service lists. Explain one real homeowner decision, project step, or construction consideration at a time.',
       'Homeowners ages 35-70 with household income of $150,000+ and homes valued at $750,000+ in approved Los Angeles County markets. Pain points include limited living space, outdated kitchens and bathrooms, aging homes, multigenerational needs, rental-income goals without guaranteed returns, poor floor plans, rising housing costs, and limited moving inventory.',
       'Los Angeles General Contractor',
       '["ADU Builder Los Angeles","Garage Conversion Los Angeles","Kitchen Remodeling Los Angeles","Bathroom Remodeling Los Angeles","Room Addition Los Angeles","Home Renovation Los Angeles","General Contractor Los Angeles","ADU Construction Los Angeles","Home Remodeling Los Angeles","Major Renovations Los Angeles"]',
       '["Los Angeles","Pasadena","Glendale","Burbank","North Hollywood","Sherman Oaks","Beverly Hills","West Hollywood","Culver City","Inglewood","Santa Monica","Monterey Park","San Gabriel","Studio City"]',
       'en',
       'Every post should sound like a real Cali View project manager, builder, or owner. Use a specific homeowner goal, design decision, construction step, material consideration, or verified project outcome. Project-story language requires verified details and assets; otherwise present the topic as general homeowner guidance.',
       '{"month":"2026-08","package":"medium","expected_slots":26,"content_types":{"image":9,"video":4,"reel":9,"blog":4},"weekly_schedule":{"monday":["video"],"tuesday":["image"],"wednesday":["reel"],"thursday":["image","blog"],"friday":["reel"]}}',
       'Owner-approved profile received 2026-08-06. Remove stale licensing, bonding, insurance, experience-duration, bilingual or identity claims, unsupported permit guidance, seasonal urgency, unapproved service areas, and generic research keywords from generation.',
       unixepoch(), unixepoch(), unixepoch()
FROM clients WHERE slug = 'caliview-builders'
ON CONFLICT(client_id) DO UPDATE SET
  brand_voice = excluded.brand_voice,
  tone_keywords = excluded.tone_keywords,
  prohibited_terms = excluded.prohibited_terms,
  approved_ctas = excluded.approved_ctas,
  content_goals = excluded.content_goals,
  service_priorities = excluded.service_priorities,
  content_angles = excluded.content_angles,
  seasonal_notes = excluded.seasonal_notes,
  competitor_notes = excluded.competitor_notes,
  audience_notes = excluded.audience_notes,
  primary_keyword = excluded.primary_keyword,
  secondary_keywords = excluded.secondary_keywords,
  local_seo_themes = excluded.local_seo_themes,
  generation_language = excluded.generation_language,
  humanization_style = excluded.humanization_style,
  monthly_snapshot = excluded.monthly_snapshot,
  feedback_summary = excluded.feedback_summary,
  last_research_at = excluded.last_research_at,
  updated_at = unixepoch();

UPDATE client_research_notes
SET review_status = 'quarantined',
    entity_match = 0,
    geography_match = 0,
    service_match = 0,
    confidence = 'low',
    reviewed_by = 'owner-profile-2026-08-06',
    reviewed_at = unixepoch(),
    notes = 'Superseded by the owner-approved 2026-08-06 profile; excluded from generation.',
    updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'caliview-builders');

INSERT INTO client_research_notes
    (client_id, source, research_json, freshness_date, brand_name, source_url, source_domain,
     source_title, entity_match, geography_match, service_match, prohibited_service_detected,
     confidence, review_status, reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
SELECT id,
       'owner_profile',
       '{"brand":"Cali View Builders","business_type":"Family-owned Los Angeles residential general contractor","services":["ADUs","Garage Conversions","Kitchen Remodeling","Bathroom Remodeling","Room Additions","Major Renovations","New Construction","Roofing","Foundation Retrofit","Insulation","Windows","Painting","Landscape Projects"],"primary_areas":["Los Angeles","Pasadena","Glendale","Burbank","North Hollywood","Sherman Oaks"],"secondary_areas":["Beverly Hills","West Hollywood","Culver City","Inglewood","Santa Monica","Monterey Park","San Gabriel","Studio City"],"primary_keyword":"Los Angeles General Contractor","audience":{"age_range":"35-70","household_income":"$150,000+","home_value":"$750,000+"},"editorial_policy":"Helpful builder and project-manager guidance using only verified project facts and approved services, areas, keywords, and CTAs."}',
       '2026-08-06',
       'Cali View Builders',
       'internal://caliview-owner-profile-2026-08-06',
       'internal',
       'Owner-approved Cali View Builders brand profile',
       1, 1, 1, 0, 'high', 'approved', 'owner-profile-2026-08-06', unixepoch(),
       '2027-02-06',
       'Canonical owner-supplied profile. Revalidate services, areas, destinations, and claims before expiration.',
       unixepoch(), unixepoch()
FROM clients WHERE slug = 'caliview-builders';

DELETE FROM client_services
WHERE client_id = (SELECT id FROM clients WHERE slug = 'caliview-builders');

WITH service_data(name, normalized_name, service_pillar, description, editorial_notes, sort_order) AS (VALUES
  ('ADUs', 'adus', 'tier_1', 'Planning, design, coordination, and construction of accessory dwelling units.', 'Tier 1 priority; do not state permit, zoning, value, income, cost, or schedule outcomes without verified evidence.', 0),
  ('Garage Conversions', 'garage conversions', 'tier_1', 'Converting existing garage space into functional living space.', 'Tier 1 priority; avoid unsupported feasibility and permit claims.', 1),
  ('Kitchen Remodeling', 'kitchen remodeling', 'tier_1', 'Kitchen layout, cabinetry, surfaces, lighting, storage, and remodeling coordination.', 'Tier 1 priority service.', 2),
  ('Bathroom Remodeling', 'bathroom remodeling', 'tier_1', 'Bathroom layout, waterproofing, fixtures, materials, storage, lighting, and remodeling coordination.', 'Tier 1 priority service.', 3),
  ('Room Additions', 'room additions', 'tier_2', 'Planning and construction coordination for additional living space.', 'Tier 2 priority; avoid unsupported feasibility and schedule claims.', 4),
  ('Major Renovations', 'major renovations', 'tier_2', 'Coordinated renovation of multiple rooms, systems, layouts, and finishes.', 'Tier 2 priority service.', 5),
  ('New Construction', 'new construction', 'tier_2', 'Full-service planning, design coordination, and construction through project completion.', 'Tier 2 priority; do not claim specific approvals, costs, or timelines.', 6),
  ('Roofing', 'roofing', 'tier_3', 'Roofing considerations within confirmed residential construction and renovation scope.', 'Tier 3 supporting service; no warranty or condition claim without evidence.', 7),
  ('Foundation Retrofit', 'foundation retrofit', 'tier_3', 'Foundation retrofit evaluation and confirmed construction scope.', 'Tier 3 supporting service; no structural diagnosis or safety guarantee without verified assessment.', 8),
  ('Insulation', 'insulation', 'tier_3', 'Insulation considerations within confirmed residential construction and renovation scope.', 'Tier 3 supporting service; no performance or savings guarantee.', 9),
  ('Windows', 'windows', 'tier_3', 'Window selection and installation considerations within residential projects.', 'Tier 3 supporting service; no product performance guarantee.', 10),
  ('Painting', 'painting', 'tier_3', 'Interior and exterior preparation, color, finish, and painting considerations.', 'Tier 3 supporting service.', 11),
  ('Landscape Projects', 'landscape projects', 'tier_3', 'Landscape planning and construction topics tied to confirmed residential projects.', 'Tier 3 supporting service; do not expand into unapproved pool or masonry services.', 12)
)
INSERT INTO client_services
    (id, client_id, name, normalized_name, service_pillar, description, approval_status,
     approved_by, approved_at, editorial_notes, active, sort_order, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, d.name, d.normalized_name, d.service_pillar, d.description,
       'approved', 'owner-profile-2026-08-06', unixepoch(), d.editorial_notes, 1, d.sort_order,
       unixepoch(), unixepoch()
FROM service_data d CROSS JOIN clients c
WHERE c.slug = 'caliview-builders';

DELETE FROM client_service_areas
WHERE client_id = (SELECT id FROM clients WHERE slug = 'caliview-builders');

WITH area_data(city, primary_area, sort_order) AS (VALUES
  ('Los Angeles', 1, 0),
  ('Pasadena', 1, 1),
  ('Glendale', 1, 2),
  ('Burbank', 1, 3),
  ('North Hollywood', 1, 4),
  ('Sherman Oaks', 1, 5),
  ('Beverly Hills', 0, 6),
  ('West Hollywood', 0, 7),
  ('Culver City', 0, 8),
  ('Inglewood', 0, 9),
  ('Santa Monica', 0, 10),
  ('Monterey Park', 0, 11),
  ('San Gabriel', 0, 12),
  ('Studio City', 0, 13)
)
INSERT INTO client_service_areas
    (id, client_id, city, state, primary_area, sort_order, approval_status, approved_by,
     approved_at, editorial_notes, created_at)
SELECT lower(hex(randomblob(16))), c.id, d.city, 'CA', d.primary_area, d.sort_order,
       'approved', 'owner-profile-2026-08-06', unixepoch(),
       CASE WHEN d.primary_area = 1 THEN 'Owner-approved primary local SEO area.' ELSE 'Owner-approved secondary local SEO area.' END,
       unixepoch()
FROM area_data d CROSS JOIN clients c
WHERE c.slug = 'caliview-builders';

UPDATE client_keywords
SET status = 'archived',
    approval_status = 'rejected',
    approved_by = NULL,
    approved_at = NULL,
    opportunity_notes = 'Superseded by the owner-approved Cali View keyword set.',
    updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'caliview-builders');

WITH keyword_data(keyword, normalized_keyword, kw_type, search_intent, service_pillar, locality, notes) AS (VALUES
  ('Los Angeles General Contractor', 'los angeles general contractor', 'primary', 'transactional', 'tier_1', 'Los Angeles', 'Owner-approved primary keyword.'),
  ('ADU Builder Los Angeles', 'adu builder los angeles', 'local', 'transactional', 'tier_1', 'Los Angeles', 'ADU service intent.'),
  ('Garage Conversion Los Angeles', 'garage conversion los angeles', 'local', 'transactional', 'tier_1', 'Los Angeles', 'Garage conversion service intent.'),
  ('Kitchen Remodeling Los Angeles', 'kitchen remodeling los angeles', 'local', 'transactional', 'tier_1', 'Los Angeles', 'Kitchen remodeling service intent.'),
  ('Bathroom Remodeling Los Angeles', 'bathroom remodeling los angeles', 'local', 'transactional', 'tier_1', 'Los Angeles', 'Bathroom remodeling service intent.'),
  ('Room Addition Los Angeles', 'room addition los angeles', 'local', 'transactional', 'tier_2', 'Los Angeles', 'Room addition service intent.'),
  ('Home Renovation Los Angeles', 'home renovation los angeles', 'local', 'transactional', 'tier_2', 'Los Angeles', 'Home renovation service intent.'),
  ('General Contractor Los Angeles', 'general contractor los angeles', 'local', 'transactional', 'tier_1', 'Los Angeles', 'Owner-approved local variant.'),
  ('ADU Construction Los Angeles', 'adu construction los angeles', 'local', 'transactional', 'tier_1', 'Los Angeles', 'ADU construction service intent.'),
  ('Home Remodeling Los Angeles', 'home remodeling los angeles', 'local', 'transactional', 'tier_2', 'Los Angeles', 'Home remodeling service intent.'),
  ('Major Renovations Los Angeles', 'major renovations los angeles', 'local', 'transactional', 'tier_2', 'Los Angeles', 'Major renovation service intent.')
)
INSERT INTO client_keywords
    (client_id, keyword, normalized_keyword, kw_type, search_intent, service_pillar, locality,
     brand_owner, confidence, source, approval_status, approved_by, approved_at,
     opportunity_notes, status, created_at, updated_at)
SELECT c.id, d.keyword, d.normalized_keyword, d.kw_type, d.search_intent, d.service_pillar,
       d.locality, 'caliview-builders', 'high', 'owner_profile_2026_08_06', 'approved',
       'owner-profile-2026-08-06', unixepoch(), d.notes, 'active', unixepoch(), unixepoch()
FROM keyword_data d CROSS JOIN clients c
WHERE c.slug = 'caliview-builders'
ON CONFLICT(client_id, keyword) DO UPDATE SET
  normalized_keyword = excluded.normalized_keyword,
  kw_type = excluded.kw_type,
  search_intent = excluded.search_intent,
  service_pillar = excluded.service_pillar,
  locality = excluded.locality,
  brand_owner = excluded.brand_owner,
  confidence = excluded.confidence,
  source = excluded.source,
  approval_status = 'approved',
  approved_by = 'owner-profile-2026-08-06',
  approved_at = unixepoch(),
  opportunity_notes = excluded.opportunity_notes,
  status = 'active',
  updated_at = unixepoch();

DELETE FROM client_restrictions
WHERE client_id = (SELECT id FROM clients WHERE slug = 'caliview-builders');

WITH restriction(term) AS (VALUES
  ('Cheapest Contractor'),
  ('Lowest Price'),
  ('Budget Remodel'),
  ('Cheap Construction'),
  ('Guaranteed Lowest Cost'),
  ('Act Now!!!'),
  ('Limited Time Only!!!'),
  ('Best Price In California'),
  ('financing'),
  ('solar')
)
INSERT INTO client_restrictions (client_id, term)
SELECT c.id, r.term
FROM restriction r CROSS JOIN clients c
WHERE c.slug = 'caliview-builders';

UPDATE client_strategy_plans
SET status = 'archived', updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'caliview-builders')
  AND period_start <= '2026-08-31'
  AND period_end >= '2026-08-01';

INSERT INTO client_strategy_plans
    (client_id, period_start, period_end, strategy_json, status, created_at, updated_at)
SELECT id, '2026-08-01', '2026-08-31',
       '{"identity":"Family-owned Los Angeles residential general contractor with an experienced builder and project-manager voice","objectives":["consultation requests","estimate requests","trust and authority","project-quality visibility","local visibility","ADU and remodeling leads"],"service_mix":{"tier_1":"ADUs, garage conversions, kitchen remodeling, and bathroom remodeling lead the month","tier_2":"Room additions, major renovations, and new construction support larger homeowner needs","tier_3":"Roofing, foundation retrofit, insulation, windows, painting, and landscape projects remain selective supporting topics"},"editorial_rules":["Use only verified project stories and assets","Lead with one homeowner goal, design challenge, or construction decision","Explain one concrete recommendation or project step","Use one approved primary keyword naturally","Use only approved CTAs","Do not invent credentials, testimonials, prices, value increases, rental returns, permit outcomes, timelines, offers, or guarantees"],"package":{"slug":"medium","slots":26,"image":9,"video":4,"reel":9,"blog":4}}',
       'approved', unixepoch(), unixepoch()
FROM clients WHERE slug = 'caliview-builders';

INSERT INTO client_monthly_content_plans
    (client_id, plan_month, monthly_focus, promotion_notes, priority_services, notes, created_by,
     status, expected_slots, approved_by, approved_at, created_at, updated_at)
SELECT id, '2026-08',
       'Helpful builder and project-manager guidance for confident Los Angeles County remodeling and construction decisions.',
       'No offer, price, discount, deadline, value increase, rental return, or urgency may be invented. Use only the approved CTA set.',
       '["ADUs","Garage Conversions","Kitchen Remodeling","Bathroom Remodeling","Room Additions","Major Renovations","New Construction","Roofing","Foundation Retrofit","Insulation","Windows","Painting","Landscape Projects"]',
       'Exactly 26 core topics aligned to the nominal Medium package: 9 images, 4 videos, 9 reels, and 4 blogs. Project-specific statements require verified proof.',
       'owner-profile-2026-08-06', 'approved', 26, 'owner-profile-2026-08-06', unixepoch(), unixepoch(), unixepoch()
FROM clients WHERE slug = 'caliview-builders'
ON CONFLICT(client_id, plan_month) DO UPDATE SET
  monthly_focus = excluded.monthly_focus,
  promotion_notes = excluded.promotion_notes,
  priority_services = excluded.priority_services,
  notes = excluded.notes,
  created_by = excluded.created_by,
  status = 'approved',
  expected_slots = 26,
  approved_by = 'owner-profile-2026-08-06',
  approved_at = unixepoch(),
  updated_at = unixepoch();

DELETE FROM client_monthly_topics
WHERE client_id = (SELECT id FROM clients WHERE slug = 'caliview-builders')
  AND plan_month = '2026-08';

WITH topic_data(slot_number, topic, pillar, service, area, keyword, supporting_keywords, content_type, format, media_requirement, proof_requirement, notes) AS (VALUES
  (1, 'Four decisions to make before planning a Los Angeles ADU', 'homeowner_goals', 'ADUs', 'Los Angeles', 'ADU Builder Los Angeles', '["ADU Construction Los Angeles"]', 'video', 'horizontal educational video', 'Use approved ADU planning or project footage; otherwise use neutral planning visuals.', 'Do not state zoning, permit, feasibility, cost, value, rental income, or timeline outcomes.', 'Cover intended use, privacy, access, and connection to the main home.'),
  (2, 'Kitchen layout choices that improve daily flow before finishes', 'design_education', 'Kitchen Remodeling', 'Pasadena', 'Kitchen Remodeling Los Angeles', '["Home Remodeling Los Angeles"]', 'image', 'educational single-image', 'Use an approved kitchen project or a clear workflow-planning visual.', 'Do not invent a client goal, before-and-after result, or product claim.', 'Explain work zones, circulation, storage, and seating before finish selections.'),
  (3, 'What turns a garage conversion into comfortable living space', 'space_planning', 'Garage Conversions', 'Glendale', 'Garage Conversion Los Angeles', '["Los Angeles General Contractor"]', 'reel', 'short-form video script', 'Use approved conversion footage or neutral visuals for light, comfort, and access.', 'Do not claim feasibility, code compliance, permit approval, cost, or timeline.', 'Discuss light, temperature, access, privacy, and visual continuity.'),
  (4, 'A bathroom remodel should start with routines, not a trend board', 'homeowner_goals', 'Bathroom Remodeling', 'Burbank', 'Bathroom Remodeling Los Angeles', '["Home Remodeling Los Angeles"]', 'image', 'educational single-image', 'Use an approved bathroom project or an honest layout-planning visual.', 'Do not fabricate a project story or homeowner quote.', 'Connect layout, storage, lighting, and fixtures to daily routines.'),
  (5, 'Planning a major renovation in an aging Los Angeles home', 'process_transparency', 'Major Renovations', 'Los Angeles', 'Major Renovations Los Angeles', '["Home Renovation Los Angeles","Los Angeles General Contractor"]', 'blog', 'local SEO guide', 'No automatic image requirement; use only properly licensed project media if added.', 'Do not diagnose conditions, promise scope, price, timeline, value, or permit outcomes.', 'Explain assessment, priorities, sequencing, selections, communication, and contingency planning.'),
  (6, 'Room addition or move: questions that clarify the real space problem', 'decision_guidance', 'Room Additions', 'North Hollywood', 'Room Addition Los Angeles', '["Home Remodeling Los Angeles"]', 'reel', 'comparison video script', 'Use approved addition footage or neutral space-planning visuals.', 'Do not promise feasibility, lower cost than moving, increased value, or a timeline.', 'Compare needs, circulation, household goals, and long-term use without financial claims.'),
  (7, 'What full-service new construction coordination means for homeowners', 'process_transparency', 'New Construction', 'Los Angeles', 'Los Angeles General Contractor', '["General Contractor Los Angeles"]', 'video', 'horizontal process video', 'Use approved planning, jobsite, or team footage without exposing private information.', 'Do not claim credentials, approvals, cost certainty, or schedule certainty.', 'Explain coordination from planning and design through construction and completion.'),
  (8, 'ADU design for multigenerational living without assuming one layout', 'homeowner_goals', 'ADUs', 'Sherman Oaks', 'ADU Construction Los Angeles', '["ADU Builder Los Angeles"]', 'image', 'educational single-image', 'Use approved ADU imagery or a neutral flexible-layout visual.', 'Do not invent occupants or promise feasibility, independence, value, or rental income.', 'Discuss privacy, accessibility goals, shared spaces, and future flexibility.'),
  (9, 'Kitchen remodeling progress: what homeowners should look for between milestones', 'construction_progress', 'Kitchen Remodeling', 'Studio City', 'Kitchen Remodeling Los Angeles', '["General Contractor Los Angeles"]', 'reel', 'progress-focused video script', 'Use verified progress footage from one approved project or neutral process visuals.', 'Do not invent a project stage, client, timeline, inspection, or outcome.', 'Explain how homeowners can follow decisions, installations, questions, and quality checks.'),
  (10, 'How a major renovation can improve a disconnected floor plan', 'functionality', 'Major Renovations', 'Beverly Hills', 'Home Renovation Los Angeles', '["Major Renovations Los Angeles"]', 'image', 'educational single-image', 'Use an approved floor-plan transformation or a neutral circulation diagram.', 'Do not claim structural feasibility, value increase, or a specific project outcome without proof.', 'Explain circulation, sightlines, room relationships, and natural light.'),
  (11, 'Garage conversion planning: access, privacy, light, and comfort', 'space_planning', 'Garage Conversions', 'Santa Monica', 'Garage Conversion Los Angeles', '["Los Angeles General Contractor"]', 'blog', 'local SEO planning guide', 'No automatic image requirement; use approved project media only if added.', 'Do not state permit, zoning, feasibility, cost, rental return, value, or schedule outcomes.', 'Give homeowners a clear property-specific question list before design begins.'),
  (12, 'Bathroom material selections for maintenance, comfort, and longevity', 'material_education', 'Bathroom Remodeling', 'Pasadena', 'Bathroom Remodeling Los Angeles', '["Home Remodeling Los Angeles"]', 'reel', 'material education video', 'Use a verified material palette or neutral product-category visuals.', 'Do not claim product performance, warranty, or a specific client selection without evidence.', 'Connect surfaces, fixtures, ventilation, and maintenance to homeowner priorities.'),
  (13, 'How a room addition should connect to the existing home', 'craftsmanship', 'Room Additions', 'Burbank', 'Room Addition Los Angeles', '["General Contractor Los Angeles"]', 'video', 'horizontal educational video', 'Use approved addition details or neutral transition examples.', 'Do not fabricate engineering decisions, project outcomes, or timelines.', 'Discuss rooflines, floor transitions, circulation, light, and finish continuity.'),
  (14, 'Kitchen storage planning around the household, not a showroom', 'homeowner_goals', 'Kitchen Remodeling', 'Glendale', 'Kitchen Remodeling Los Angeles', '["Home Remodeling Los Angeles"]', 'image', 'educational single-image', 'Use an approved kitchen project or a storage-planning visual.', 'Do not invent a household challenge or testimonial.', 'Show how frequently used items, appliances, prep, and cleanup influence cabinetry.'),
  (15, 'ADU consultation: goals first, property-specific requirements second', 'process_transparency', 'ADUs', 'North Hollywood', 'ADU Builder Los Angeles', '["ADU Construction Los Angeles"]', 'reel', 'FAQ video script', 'Use verified consultation or project footage, or neutral planning visuals.', 'Do not state permit, zoning, feasibility, cost, value, income, or timeline outcomes.', 'Explain how a team clarifies goals before confirming property-specific requirements.'),
  (16, 'Roofing decisions belong inside the whole-home project plan', 'systems_coordination', 'Roofing', 'Los Angeles', 'General Contractor Los Angeles', '["Home Renovation Los Angeles"]', 'image', 'educational single-image', 'Use approved roof documentation or a neutral systems-coordination visual.', 'Do not diagnose roof condition or promise warranty, lifespan, savings, or performance.', 'Connect roofing decisions to drainage, ventilation, envelope work, and project sequencing.'),
  (17, 'Bathroom remodeling guide: layout, waterproofing, lighting, and storage', 'design_education', 'Bathroom Remodeling', 'Culver City', 'Bathroom Remodeling Los Angeles', '["Home Remodeling Los Angeles"]', 'blog', 'local SEO guide', 'No automatic image requirement; use approved bathroom media only if added.', 'Do not invent costs, timelines, product performance, warranty, or project outcomes.', 'Provide a practical sequence for evaluating function, hidden preparation, and finishes.'),
  (18, 'What homeowners should know before discussing a foundation retrofit', 'decision_guidance', 'Foundation Retrofit', 'Pasadena', 'Los Angeles General Contractor', '["General Contractor Los Angeles"]', 'reel', 'FAQ video script', 'Use verified retrofit footage or neutral structural-evaluation visuals.', 'Do not diagnose a foundation, claim safety, prescribe scope, or promise compliance without a professional assessment.', 'Explain observations to document and questions to bring to a qualified project discussion.'),
  (19, 'Garage conversion planning from existing conditions to finished use', 'process_transparency', 'Garage Conversions', 'Inglewood', 'Garage Conversion Los Angeles', '["Home Remodeling Los Angeles"]', 'video', 'horizontal process video', 'Use approved conversion progress footage or neutral process visuals.', 'Do not invent an existing condition, inspection result, permit outcome, cost, or timeline.', 'Explain evaluation, design priorities, systems coordination, construction, and finish decisions.'),
  (20, 'Bathroom lighting layers for practical daily routines', 'design_education', 'Bathroom Remodeling', 'West Hollywood', 'Bathroom Remodeling Los Angeles', '["Home Renovation Los Angeles"]', 'image', 'educational single-image', 'Use an approved bathroom lighting image or a clear lighting-layer visual.', 'Do not state unverified product specifications or guaranteed performance.', 'Explain task, ambient, accent, and low-level lighting through homeowner routines.'),
  (21, 'Renovating an aging home without losing sight of the overall plan', 'process_transparency', 'Major Renovations', 'Santa Monica', 'Home Remodeling Los Angeles', '["Major Renovations Los Angeles"]', 'reel', 'process breakdown video', 'Use approved renovation progress footage or neutral sequencing visuals.', 'Do not diagnose conditions or promise cost, schedule, value, or uninterrupted access.', 'Show how priorities, discoveries, selections, and communication stay connected to the main goals.'),
  (22, 'Window decisions for comfort, light, ventilation, and design continuity', 'material_education', 'Windows', 'San Gabriel', 'General Contractor Los Angeles', '["Home Renovation Los Angeles"]', 'image', 'educational single-image', 'Use approved window project imagery or a neutral comparison visual.', 'Do not promise energy savings, product performance, rebates, or warranty terms.', 'Explain how opening type, placement, light, ventilation, and surrounding finishes affect the discussion.'),
  (23, 'Los Angeles ADU planning guide from homeowner goals to project coordination', 'design_build', 'ADUs', 'Los Angeles', 'ADU Construction Los Angeles', '["ADU Builder Los Angeles","Los Angeles General Contractor"]', 'blog', 'local SEO planning guide', 'No automatic image requirement; use approved ADU media only if added.', 'Do not state property eligibility, permit approval, cost, value, rental return, or timeline.', 'Explain the design-build conversation from use goals through property-specific review and coordination.'),
  (24, 'Painting is a finish decision and a preparation process', 'craftsmanship', 'Painting', 'Monterey Park', 'Home Renovation Los Angeles', '["General Contractor Los Angeles"]', 'reel', 'craftsmanship video script', 'Use approved preparation and finish footage or neutral process details.', 'Do not claim product durability, coverage, warranty, or a specific project result without evidence.', 'Explain surface preparation, sheen, lighting, transitions, and protection of adjacent work.'),
  (25, 'Landscape projects should connect outdoor function to the home', 'functionality', 'Landscape Projects', 'Los Angeles', 'Los Angeles General Contractor', '["Home Remodeling Los Angeles"]', 'image', 'educational single-image', 'Use an approved landscape project or a neutral circulation and use-zone visual.', 'Do not add unapproved pool, masonry, or outdoor-kitchen services or promise property value.', 'Connect access, gathering, shade, maintenance preferences, and indoor-outdoor circulation.'),
  (26, 'Insulation questions to include in a larger renovation conversation', 'systems_coordination', 'Insulation', 'Sherman Oaks', 'General Contractor Los Angeles', '["Home Renovation Los Angeles"]', 'reel', 'FAQ video script', 'Use approved insulation progress footage or neutral envelope visuals.', 'Do not promise energy savings, comfort results, rebates, product performance, or code compliance.', 'Explain where insulation fits into comfort goals, existing conditions, air sealing, and project sequencing.')
)
INSERT INTO client_monthly_topics
    (client_id, plan_month, topic_title, service_category, target_keyword, content_type_preference,
     preferred_platforms, priority, status, notes, created_by, created_at, updated_at, slot_number,
     content_pillar, working_title, primary_service, primary_area, supporting_keywords, format,
     offer_or_event, image_requirement, proof_requirement, claim_requirement, approval_status,
     approved_by, approved_at)
SELECT c.id, '2026-08', d.topic, d.service, d.keyword, d.content_type,
       CASE d.content_type
         WHEN 'image' THEN '["facebook","instagram","linkedin","threads","pinterest","bluesky","google_business"]'
         WHEN 'reel' THEN '["facebook","instagram","tiktok","youtube","threads"]'
         WHEN 'video' THEN '["facebook","instagram","youtube","linkedin"]'
         ELSE '["website_blog"]'
       END,
       1000 - d.slot_number, 'approved', d.notes, 'owner-profile-2026-08-06', unixepoch(), unixepoch(),
       d.slot_number, d.pillar, d.topic, d.service, d.area, d.supporting_keywords, d.format,
       'none', d.media_requirement, d.proof_requirement, 'none', 'approved',
       'owner-profile-2026-08-06', unixepoch()
FROM topic_data d CROSS JOIN clients c
WHERE c.slug = 'caliview-builders';
