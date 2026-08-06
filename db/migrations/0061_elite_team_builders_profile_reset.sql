-- Install the owner-approved Elite Team Builders profile and Premium-package August plan.

UPDATE clients
SET canonical_name = 'Elite Team Builders Inc.',
    notes = 'Multi-state residential remodeling and construction company serving approved markets in Washington, Oregon, and California. Focus content on craftsmanship, transparent communication, homeowner goals, project outcomes, functionality, and a well-managed remodeling experience. Use project stories, jobsite updates, transformations, and outcomes only when verified. Do not invent credentials, project facts, prices, timelines, permits, offers, guarantees, or property-value outcomes. Oregon Google Business publishing remains paused until live verification is confirmed.',
    brand_json = '{"company_name":"Elite Team Builders Inc.","primary_color":"#1a1a2e","accent_color":"#c8a04a","brand_overview":"Multi-state residential remodeling and construction company serving Washington, Oregon, and California.","editorial_identity":"Premium contractor with an experienced project-manager and construction-expert voice centered on craftsmanship, transparency, communication, and quality workmanship","personality":["professional","trustworthy","experienced","helpful","transparent","detail-oriented","solution-focused"],"messaging_focus":["home improvement benefits","quality craftsmanship","verified project outcomes","functionality improvements","property-value considerations without guarantees","project communication","reducing avoidable remodeling stress"],"preferred_phrases":["Our team recently completed...","Many homeowners ask us...","Here''s what we recommend...","This renovation created...","Built with quality and designed to last."],"audience":{"age_range":"35-70","household_income":"$125,000+","home_value":"$500,000+","type":"homeowners"},"content_evidence_policy":"Real project stories, jobsite updates, homeowner goals, design recommendations, construction insights, before-and-after transformations, and craftsmanship highlights require verified project details and approved assets.","service_tiers":{"tier_1":["Kitchen Remodeling","Bathroom Remodeling","ADU Construction","Room Additions"],"tier_2":["Roofing","Decks & Patios","Garage Remodeling","Landscaping & Hardscaping"],"tier_3":["Flooring","Painting","HVAC & Insulation","Windows","Electrical & Plumbing","Mold Remediation"]},"markets":{"Washington":["Seattle","Bellevue","Kirkland","Redmond","Tacoma","Greater Seattle Area"],"Oregon":["Portland","Beaverton","Hillsboro","Lake Oswego","Tigard"],"California":["Los Angeles","Pasadena","Glendale","Burbank","San Fernando Valley"]},"multi_market_positioning":{"Seattle":"Premium remodeling and home improvement solutions","Portland":"Whole-home upgrades and renovations","Los Angeles":"Kitchen, bathroom, ADU, roofing, and room addition projects"},"phone":"(888) 821-3548","profile_source":"owner-profile-2026-08-06"}',
    cta_text = 'Get Your Free Estimate',
    cta_label = 'Get Your Free Estimate',
    industry = 'Multi-State Residential Remodeling and Construction',
    state = 'WA / OR / CA',
    profile_approval_status = 'approved',
    profile_approved_by = 'owner-profile-2026-08-06',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug = 'elite-team-builders';

INSERT INTO client_intelligence
    (client_id, brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals,
     service_priorities, content_angles, seasonal_notes, competitor_notes, audience_notes,
     primary_keyword, secondary_keywords, local_seo_themes, generation_language,
     humanization_style, monthly_snapshot, feedback_summary, last_research_at, created_at, updated_at)
SELECT id,
       'Write as an experienced Elite Team Builders project manager, builder, or owner helping homeowners make informed construction and remodeling decisions. Be professional, trustworthy, experienced, helpful, transparent, detail-oriented, solution-focused, educational, human, and consultative. Avoid corporate, generic, or overly promotional language.',
       '["professional","trustworthy","experienced","helpful","transparent","detail-oriented","solution-focused","educational","human","consultative"]',
       '["Cheapest Contractor","Lowest Price Guaranteed","Cheap Remodeling","Budget Contractor","Best Price In Town","Act Now!!!","Limited Time Only!!!","Lowest Bid","Standalone Waterproofing Services","Basement Remodeling","Americas Professional Builders"]',
       '["Get Your Free Estimate","Schedule Your Consultation","Contact Our Team Today","Start Your Remodeling Project","Request A Project Review","Explore Your Options","Speak With Our Experts","Book Your Free Consultation"]',
       '["Generate consultations","Generate estimate requests","Build trust","Demonstrate expertise","Increase local visibility","Showcase project quality"]',
       '[{"tier":1,"services":["Kitchen Remodeling","Bathroom Remodeling","ADU Construction","Room Additions"]},{"tier":2,"services":["Roofing","Decks & Patios","Garage Remodeling","Landscaping & Hardscaping"]},{"tier":3,"services":["Flooring","Painting","HVAC & Insulation","Windows","Electrical & Plumbing","Mold Remediation"]}]',
       '["Verified project transformation","Homeowner goal and recommended solution","Approved jobsite update","Design recommendation","Construction process insight","Before-and-after result with approved assets","Craftsmanship detail","Functionality improvement","Multi-market project planning","Communication and project coordination"]',
       'Use seasonal angles only when tied to a confirmed homeowner need, verified project condition, or broadly applicable planning decision. Never invent storm damage, urgency, offers, deadlines, inspections, permit outcomes, costs, savings, or construction timelines.',
       'Keep Elite Team Builders distinct from Americas Professional Builders. Do not use unsupported licensing, warranty, experience-duration, ranking, value, energy-savings, health, safety, or performance claims. One post should teach one concrete homeowner decision or project step.',
       'Homeowners ages 35-70 with household income of $125,000+ and homes valued at $500,000+ in approved Washington, Oregon, and California markets. Pain points include outdated kitchens, aging bathrooms, limited living space, rising home prices, expansion needs, limited storage, energy inefficiency, roofing concerns, outdoor living upgrades, and finding a trusted contractor.',
       'Home Remodeling Contractor',
       '["Kitchen Remodeling","Bathroom Remodeling","ADU Construction","Room Addition Contractor","Roofing Contractor","Garage Remodel","Deck Builder","Patio Contractor","General Contractor","Home Renovation Services","Remodeling Contractor"]',
       '["Seattle","Bellevue","Kirkland","Redmond","Tacoma","Greater Seattle Area","Portland","Beaverton","Hillsboro","Lake Oswego","Tigard","Los Angeles","Pasadena","Glendale","Burbank","San Fernando Valley"]',
       'en',
       'Every post should sound like a real project manager, builder, or company owner. Use a specific homeowner goal, design decision, construction step, material consideration, or verified outcome. Project-story wording requires approved project facts and assets; otherwise frame the content as general homeowner guidance.',
       '{"month":"2026-08","package":"premium","advertised_posts_per_month":69,"nominal_topic_slots":70,"content_types":{"image":17,"video":9,"reel":22,"blog":22},"weekly_schedule":{"monday":["video","reel","blog"],"tuesday":["image","reel","blog"],"wednesday":["video","blog","reel"],"thursday":["reel","image","blog"],"friday":["reel","blog","image"],"saturday":["image"]},"calendar_note":"The package type allocations total 70 nominal topics; the scheduler applies calendar availability and package caps when creating a run."}',
       'Owner-approved profile received 2026-08-06. Remove stale water-damage, restoration, commercial-construction, waterproofing, basement, licensing, warranty, ranking, urgency, wrong-phone, and generic research claims from generation. Preserve Oregon GBP hold until live verification succeeds.',
       unixepoch(), unixepoch(), unixepoch()
FROM clients WHERE slug = 'elite-team-builders'
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
WHERE client_id = (SELECT id FROM clients WHERE slug = 'elite-team-builders');

INSERT INTO client_research_notes
    (client_id, source, research_json, freshness_date, brand_name, source_url, source_domain,
     source_title, entity_match, geography_match, service_match, prohibited_service_detected,
     confidence, review_status, reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
SELECT id,
       'owner_profile',
       '{"brand":"Elite Team Builders Inc.","business_type":"Multi-state residential remodeling and construction company","services":["Kitchen Remodeling","Bathroom Remodeling","ADU Construction","Room Additions","Roofing","Decks & Patios","Garage Remodeling","Landscaping & Hardscaping","Flooring","Painting","HVAC & Insulation","Windows","Electrical & Plumbing","Mold Remediation"],"markets":{"Washington":["Seattle","Bellevue","Kirkland","Redmond","Tacoma","Greater Seattle Area"],"Oregon":["Portland","Beaverton","Hillsboro","Lake Oswego","Tigard"],"California":["Los Angeles","Pasadena","Glendale","Burbank","San Fernando Valley"]},"primary_keyword":"Home Remodeling Contractor","editorial_policy":"Helpful project-manager guidance using only approved project facts, services, areas, keywords, CTAs, and verified destinations."}',
       '2026-08-06',
       'Elite Team Builders Inc.',
       'internal://elite-team-builders-owner-profile-2026-08-06',
       'internal',
       'Owner-approved Elite Team Builders brand profile',
       1, 1, 1, 0, 'high', 'approved', 'owner-profile-2026-08-06', unixepoch(),
       '2027-02-06',
       'Canonical owner-supplied profile. Revalidate services, areas, destinations, and claims before expiration.',
       unixepoch(), unixepoch()
FROM clients WHERE slug = 'elite-team-builders';

DELETE FROM client_services
WHERE client_id = (SELECT id FROM clients WHERE slug = 'elite-team-builders');

WITH service_data(name, normalized_name, service_pillar, description, editorial_notes, sort_order) AS (VALUES
  ('Kitchen Remodeling', 'kitchen remodeling', 'tier_1', 'Kitchen layout, cabinetry, surfaces, lighting, storage, and remodeling coordination.', 'Tier 1 priority service; project outcomes and material selections require evidence.', 0),
  ('Bathroom Remodeling', 'bathroom remodeling', 'tier_1', 'Bathroom layout, waterproofing preparation, fixtures, materials, storage, lighting, and remodeling coordination.', 'Tier 1 priority service; waterproofing may be discussed only as part of a confirmed bathroom scope, not as a standalone promoted service.', 1),
  ('ADU Construction', 'adu construction', 'tier_1', 'Planning, design coordination, and construction of accessory dwelling units.', 'Tier 1 priority; do not state zoning, permit, feasibility, cost, value, rental-income, or timeline outcomes without verified evidence.', 2),
  ('Room Additions', 'room additions', 'tier_1', 'Planning and construction coordination for additional residential living space.', 'Tier 1 priority; avoid unsupported feasibility, structural, permit, value, and schedule claims.', 3),
  ('Roofing', 'roofing', 'tier_2', 'Roofing planning, repair, replacement, and coordination within confirmed residential project scope.', 'Tier 2 priority; no diagnosis, warranty, lifespan, or weather-readiness guarantee without evidence.', 4),
  ('Decks & Patios', 'decks and patios', 'tier_2', 'Outdoor living planning and construction for decks and patios.', 'Tier 2 priority; do not claim permit approval, product lifespan, or property-value outcomes.', 5),
  ('Garage Remodeling', 'garage remodeling', 'tier_2', 'Garage layout, storage, finishes, systems coordination, and remodeling.', 'Tier 2 priority; do not present a garage remodel as an approved living-space conversion unless that scope is verified.', 6),
  ('Landscaping & Hardscaping', 'landscaping and hardscaping', 'tier_2', 'Outdoor circulation, use zones, landscape, and hardscape planning within confirmed projects.', 'Tier 2 priority; do not add unapproved pools or guarantee drainage, maintenance, or value outcomes.', 7),
  ('Flooring', 'flooring', 'tier_3', 'Flooring selection, preparation, transitions, installation, and maintenance considerations.', 'Tier 3 supporting service; no product durability or warranty claims without evidence.', 8),
  ('Painting', 'painting', 'tier_3', 'Interior and exterior preparation, color, finish, and painting considerations.', 'Tier 3 supporting service; no product durability, coverage, or warranty claims without evidence.', 9),
  ('HVAC & Insulation', 'hvac and insulation', 'tier_3', 'HVAC and insulation coordination within confirmed remodeling and construction scope.', 'Tier 3 supporting service; no energy-savings, rebate, comfort, code, or performance guarantees.', 10),
  ('Windows', 'windows', 'tier_3', 'Window selection and installation considerations within residential projects.', 'Tier 3 supporting service; no energy-savings, rebate, product-performance, or warranty guarantees.', 11),
  ('Electrical & Plumbing', 'electrical and plumbing', 'tier_3', 'Electrical and plumbing coordination within confirmed remodeling and construction scope.', 'Tier 3 supporting service; no diagnosis, code-compliance, capacity, or safety guarantee without verified professional assessment.', 12),
  ('Mold Remediation', 'mold remediation', 'tier_3', 'Mold remediation planning and coordination only within confirmed project scope.', 'Tier 3 supporting service; no health, safety, clearance, cause, insurance, or completion claim without verified specialist evidence.', 13)
)
INSERT INTO client_services
    (id, client_id, name, normalized_name, service_pillar, description, approval_status,
     approved_by, approved_at, editorial_notes, active, sort_order, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, d.name, d.normalized_name, d.service_pillar, d.description,
       'approved', 'owner-profile-2026-08-06', unixepoch(), d.editorial_notes, 1, d.sort_order,
       unixepoch(), unixepoch()
FROM service_data d CROSS JOIN clients c
WHERE c.slug = 'elite-team-builders';

DELETE FROM client_service_areas
WHERE client_id = (SELECT id FROM clients WHERE slug = 'elite-team-builders');

WITH area_data(city, state, primary_area, sort_order) AS (VALUES
  ('Seattle', 'WA', 1, 0),
  ('Bellevue', 'WA', 0, 1),
  ('Kirkland', 'WA', 0, 2),
  ('Redmond', 'WA', 0, 3),
  ('Tacoma', 'WA', 0, 4),
  ('Greater Seattle Area', 'WA', 0, 5),
  ('Portland', 'OR', 1, 6),
  ('Beaverton', 'OR', 0, 7),
  ('Hillsboro', 'OR', 0, 8),
  ('Lake Oswego', 'OR', 0, 9),
  ('Tigard', 'OR', 0, 10),
  ('Los Angeles', 'CA', 1, 11),
  ('Pasadena', 'CA', 0, 12),
  ('Glendale', 'CA', 0, 13),
  ('Burbank', 'CA', 0, 14),
  ('San Fernando Valley', 'CA', 0, 15)
)
INSERT INTO client_service_areas
    (id, client_id, city, state, primary_area, sort_order, approval_status, approved_by,
     approved_at, editorial_notes, created_at)
SELECT lower(hex(randomblob(16))), c.id, d.city, d.state, d.primary_area, d.sort_order,
       'approved', 'owner-profile-2026-08-06', unixepoch(),
       CASE WHEN d.primary_area = 1 THEN 'Owner-approved anchor market for this state.' ELSE 'Owner-approved supporting market.' END,
       unixepoch()
FROM area_data d CROSS JOIN clients c
WHERE c.slug = 'elite-team-builders';

UPDATE client_keywords
SET status = 'archived',
    approval_status = 'rejected',
    approved_by = NULL,
    approved_at = NULL,
    opportunity_notes = 'Superseded by the owner-approved Elite Team Builders keyword set.',
    updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'elite-team-builders');

WITH keyword_data(keyword, normalized_keyword, kw_type, search_intent, service_pillar, notes) AS (VALUES
  ('Home Remodeling Contractor', 'home remodeling contractor', 'primary', 'transactional', 'tier_1', 'Owner-approved primary keyword.'),
  ('Kitchen Remodeling', 'kitchen remodeling', 'service', 'transactional', 'tier_1', 'Kitchen remodeling service intent.'),
  ('Bathroom Remodeling', 'bathroom remodeling', 'service', 'transactional', 'tier_1', 'Bathroom remodeling service intent.'),
  ('ADU Construction', 'adu construction', 'service', 'transactional', 'tier_1', 'ADU construction service intent.'),
  ('Room Addition Contractor', 'room addition contractor', 'service', 'transactional', 'tier_1', 'Room addition service intent.'),
  ('Roofing Contractor', 'roofing contractor', 'service', 'transactional', 'tier_2', 'Roofing service intent.'),
  ('Garage Remodel', 'garage remodel', 'service', 'transactional', 'tier_2', 'Garage remodeling service intent.'),
  ('Deck Builder', 'deck builder', 'service', 'transactional', 'tier_2', 'Deck construction service intent.'),
  ('Patio Contractor', 'patio contractor', 'service', 'transactional', 'tier_2', 'Patio construction service intent.'),
  ('General Contractor', 'general contractor', 'service', 'transactional', 'tier_1', 'General contractor service intent.'),
  ('Home Renovation Services', 'home renovation services', 'service', 'transactional', 'tier_1', 'Residential renovation service intent.'),
  ('Remodeling Contractor', 'remodeling contractor', 'service', 'transactional', 'tier_1', 'Residential remodeling service intent.')
)
INSERT INTO client_keywords
    (client_id, keyword, normalized_keyword, kw_type, search_intent, service_pillar, locality,
     brand_owner, confidence, source, approval_status, approved_by, approved_at,
     opportunity_notes, status, created_at, updated_at)
SELECT c.id, d.keyword, d.normalized_keyword, d.kw_type, d.search_intent, d.service_pillar,
       NULL, 'elite-team-builders', 'high', 'owner_profile_2026_08_06', 'approved',
       'owner-profile-2026-08-06', unixepoch(), d.notes, 'active', unixepoch(), unixepoch()
FROM keyword_data d CROSS JOIN clients c
WHERE c.slug = 'elite-team-builders'
ON CONFLICT(client_id, keyword) DO UPDATE SET
  normalized_keyword = excluded.normalized_keyword,
  kw_type = excluded.kw_type,
  search_intent = excluded.search_intent,
  service_pillar = excluded.service_pillar,
  locality = NULL,
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
WHERE client_id = (SELECT id FROM clients WHERE slug = 'elite-team-builders');

WITH restriction(term) AS (VALUES
  ('Cheapest Contractor'),
  ('Lowest Price Guaranteed'),
  ('Cheap Remodeling'),
  ('Budget Contractor'),
  ('Best Price In Town'),
  ('Act Now!!!'),
  ('Limited Time Only!!!'),
  ('Lowest Bid'),
  ('Standalone Waterproofing Services'),
  ('Basement Remodeling'),
  ('Americas Professional Builders')
)
INSERT INTO client_restrictions (client_id, term)
SELECT c.id, r.term
FROM restriction r CROSS JOIN clients c
WHERE c.slug = 'elite-team-builders';

UPDATE client_strategy_plans
SET status = 'archived', updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'elite-team-builders')
  AND period_start <= '2026-08-31'
  AND period_end >= '2026-08-01';

INSERT INTO client_strategy_plans
    (client_id, period_start, period_end, strategy_json, status, created_at, updated_at)
SELECT id, '2026-08-01', '2026-08-31',
       '{"identity":"Multi-state residential contractor with an experienced project-manager voice and distinct Seattle, Portland, and Los Angeles positioning","objectives":["consultations","estimate requests","trust","expertise","local visibility","project-quality visibility"],"market_positioning":{"Seattle":"Premium remodeling and home improvement solutions","Portland":"Whole-home upgrades and renovations","Los Angeles":"Kitchen, bathroom, ADU, roofing, and room addition projects"},"service_mix":{"tier_1":"Kitchen remodeling, bathroom remodeling, ADU construction, and room additions lead the month","tier_2":"Roofing, decks and patios, garage remodeling, and landscaping and hardscaping support broader project needs","tier_3":"Flooring, painting, HVAC and insulation, windows, electrical and plumbing, and mold remediation remain selective supporting topics"},"editorial_rules":["Use only verified project stories and approved assets","Lead with one homeowner goal, design decision, construction step, or material consideration","Keep each post tied to one approved market and one approved service","Use one approved primary keyword and up to two supporting keywords naturally","Use only approved CTAs","Do not invent credentials, testimonials, diagnoses, prices, timelines, permits, warranties, savings, value increases, offers, or guarantees","Do not mix Elite Team Builders with Americas Professional Builders"],"package":{"slug":"premium","advertised_posts_per_month":69,"nominal_topics":70,"image":17,"video":9,"reel":22,"blog":22}}',
       'approved', unixepoch(), unixepoch()
FROM clients WHERE slug = 'elite-team-builders';

INSERT INTO client_monthly_content_plans
    (client_id, plan_month, monthly_focus, promotion_notes, priority_services, notes, created_by,
     status, expected_slots, approved_by, approved_at, created_at, updated_at)
SELECT id, '2026-08',
       'Project-manager guidance that shows how approved remodeling and construction services solve real homeowner needs across Seattle, Portland, and Los Angeles markets.',
       'No offer, price, discount, deadline, value increase, savings, urgency, or guarantee may be invented. Use only the approved CTA set.',
       '["Kitchen Remodeling","Bathroom Remodeling","ADU Construction","Room Additions","Roofing","Decks & Patios","Garage Remodeling","Landscaping & Hardscaping","Flooring","Painting","HVAC & Insulation","Windows","Electrical & Plumbing","Mold Remediation"]',
       'The Premium package advertises approximately 69 posts per month while its content-type allocations define 70 nominal core topics: 17 images, 9 videos, 22 reels, and 22 blogs. The scheduler applies calendar availability and package caps when creating the actual run. Project-specific statements require verified proof.',
       'owner-profile-2026-08-06', 'approved', 70, 'owner-profile-2026-08-06', unixepoch(), unixepoch(), unixepoch()
FROM clients WHERE slug = 'elite-team-builders'
ON CONFLICT(client_id, plan_month) DO UPDATE SET
  monthly_focus = excluded.monthly_focus,
  promotion_notes = excluded.promotion_notes,
  priority_services = excluded.priority_services,
  notes = excluded.notes,
  created_by = excluded.created_by,
  status = 'approved',
  expected_slots = 70,
  approved_by = 'owner-profile-2026-08-06',
  approved_at = unixepoch(),
  updated_at = unixepoch();

DELETE FROM client_monthly_topics
WHERE client_id = (SELECT id FROM clients WHERE slug = 'elite-team-builders')
  AND plan_month = '2026-08';

WITH topic_data(slot_number, topic, pillar, service, area, keyword, supporting_keywords, content_type, notes) AS (VALUES
  (1, 'Kitchen planning starts with the way a Seattle household actually cooks', 'homeowner_goals', 'Kitchen Remodeling', 'Seattle', 'Kitchen Remodeling', '["Home Remodeling Contractor","Remodeling Contractor"]', 'image', 'Map prep, cooking, cleanup, storage, and gathering needs before discussing finishes.'),
  (2, 'A Portland bathroom layout should solve daily routines before following trends', 'design_education', 'Bathroom Remodeling', 'Portland', 'Bathroom Remodeling', '["Home Renovation Services"]', 'image', 'Connect layout, storage, lighting, ventilation, and fixture choices to real routines.'),
  (3, 'Four homeowner decisions that shape a Los Angeles ADU conversation', 'homeowner_goals', 'ADU Construction', 'Los Angeles', 'ADU Construction', '["General Contractor","Home Remodeling Contractor"]', 'image', 'Cover intended use, privacy, access, and relationship to the main home without feasibility claims.'),
  (4, 'How a Bellevue room addition should connect to the existing home', 'design_education', 'Room Additions', 'Bellevue', 'Room Addition Contractor', '["Home Remodeling Contractor"]', 'image', 'Discuss circulation, daylight, rooflines, transitions, and finish continuity.'),
  (5, 'Roofing decisions belong inside the Portland whole-home project plan', 'systems_coordination', 'Roofing', 'Portland', 'Roofing Contractor', '["Home Renovation Services","General Contractor"]', 'image', 'Explain how roofing may coordinate with drainage, ventilation, exterior work, and sequencing.'),
  (6, 'Planning a Kirkland deck around movement, seating, and everyday use', 'outdoor_living', 'Decks & Patios', 'Kirkland', 'Deck Builder', '["Patio Contractor","Remodeling Contractor"]', 'image', 'Start with household use, circulation, shade preferences, maintenance, and connection to the home.'),
  (7, 'A Glendale garage remodel can start with zones instead of more storage bins', 'functionality', 'Garage Remodeling', 'Glendale', 'Garage Remodel', '["Home Remodeling Contractor"]', 'image', 'Explain zones for parking, tools, storage, access, and confirmed utility needs.'),
  (8, 'Outdoor planning in Tigard should connect the yard to the way the home is used', 'outdoor_living', 'Landscaping & Hardscaping', 'Tigard', 'Remodeling Contractor', '["Patio Contractor","Home Renovation Services"]', 'image', 'Discuss paths, gathering areas, transitions, maintenance preferences, and confirmed drainage planning.'),
  (9, 'Flooring transitions can make a Los Angeles renovation feel intentional', 'craftsmanship', 'Flooring', 'Los Angeles', 'Home Renovation Services', '["Remodeling Contractor"]', 'image', 'Explain sightlines, material transitions, room connections, preparation, and daily wear needs.'),
  (10, 'Paint sheen is a practical decision in a Lake Oswego renovation', 'material_education', 'Painting', 'Lake Oswego', 'Home Renovation Services', '["Remodeling Contractor"]', 'image', 'Relate sheen, light, cleaning needs, surface preparation, and room use.'),
  (11, 'When Seattle remodeling plans should coordinate HVAC and insulation early', 'systems_coordination', 'HVAC & Insulation', 'Seattle', 'Home Remodeling Contractor', '["General Contractor","Home Renovation Services"]', 'image', 'Show why layout and envelope decisions should be coordinated before walls and finishes close.'),
  (12, 'Window planning in a Beaverton renovation goes beyond frame color', 'material_education', 'Windows', 'Beaverton', 'Home Renovation Services', '["Remodeling Contractor"]', 'image', 'Discuss opening type, placement, daylight, ventilation goals, and finish integration.'),
  (13, 'Electrical and plumbing questions to resolve before a Pasadena layout is final', 'systems_coordination', 'Electrical & Plumbing', 'Pasadena', 'General Contractor', '["Home Remodeling Contractor"]', 'image', 'Explain how appliance, fixture, lighting, outlet, and access decisions affect coordination.'),
  (14, 'What Tacoma homeowners should document before a mold-remediation project review', 'process_transparency', 'Mold Remediation', 'Tacoma', 'General Contractor', '["Home Renovation Services"]', 'image', 'Focus on visible conditions, affected areas, prior moisture events, and specialist documentation without diagnosis.'),
  (15, 'Cabinet planning for a Burbank kitchen should follow the household inventory', 'functionality', 'Kitchen Remodeling', 'Burbank', 'Kitchen Remodeling', '["Remodeling Contractor"]', 'image', 'Organize storage around frequently used items, appliances, prep, cleanup, and access.'),
  (16, 'Bathroom lighting layers for practical routines in a Redmond home', 'design_education', 'Bathroom Remodeling', 'Redmond', 'Bathroom Remodeling', '["Home Remodeling Contractor"]', 'image', 'Explain task, ambient, accent, and low-level lighting as planning categories.'),
  (17, 'A Hillsboro room-addition brief should define the space problem first', 'homeowner_goals', 'Room Additions', 'Hillsboro', 'Room Addition Contractor', '["Home Renovation Services"]', 'image', 'Clarify who uses the room, what is not working now, and how circulation should improve.'),

  (18, 'How Elite Team Builders approaches an ADU planning conversation in Seattle', 'process_transparency', 'ADU Construction', 'Seattle', 'ADU Construction', '["Home Remodeling Contractor","General Contractor"]', 'video', 'Walk through use goals, site information, design coordination, selections, and property-specific review.'),
  (19, 'From space need to coordinated plan: a Portland room-addition overview', 'process_transparency', 'Room Additions', 'Portland', 'Room Addition Contractor', '["Home Renovation Services"]', 'video', 'Explain goal discovery, existing-condition review, design coordination, selections, construction, and communication.'),
  (20, 'Kitchen remodeling decisions from layout through finishes in Los Angeles', 'design_build', 'Kitchen Remodeling', 'Los Angeles', 'Kitchen Remodeling', '["Home Remodeling Contractor","Remodeling Contractor"]', 'video', 'Show the decision sequence from layout and systems to cabinetry, surfaces, lighting, and finish details.'),
  (21, 'What a Bellevue homeowner can expect from an initial roofing project review', 'process_transparency', 'Roofing', 'Bellevue', 'Roofing Contractor', '["General Contractor"]', 'video', 'Explain documentation, observations, questions, scope clarification, and coordination without diagnosing the roof.'),
  (22, 'A Lake Oswego bathroom plan from homeowner priorities to coordinated details', 'design_build', 'Bathroom Remodeling', 'Lake Oswego', 'Bathroom Remodeling', '["Home Renovation Services"]', 'video', 'Connect routines, layout, preparation, fixtures, lighting, storage, and finish selections.'),
  (23, 'Deck and patio planning questions for a Pasadena outdoor project', 'outdoor_living', 'Decks & Patios', 'Pasadena', 'Deck Builder', '["Patio Contractor","General Contractor"]', 'video', 'Cover use, access, sun, privacy, maintenance, and relationship to the home.'),
  (24, 'Garage remodeling from existing conditions to an organized Kirkland plan', 'process_transparency', 'Garage Remodeling', 'Kirkland', 'Garage Remodel', '["Remodeling Contractor"]', 'video', 'Explain inventory, zones, surfaces, lighting, access, and confirmed systems needs.'),
  (25, 'How Portland outdoor planning balances circulation and usable gathering space', 'outdoor_living', 'Landscaping & Hardscaping', 'Portland', 'Patio Contractor', '["Home Renovation Services"]', 'video', 'Use a project-manager walkthrough of paths, gathering zones, transitions, and maintenance preferences.'),
  (26, 'Flooring planning across connected rooms in a Burbank renovation', 'craftsmanship', 'Flooring', 'Burbank', 'Home Renovation Services', '["Remodeling Contractor"]', 'video', 'Explain subfloor information, room transitions, material priorities, installation sequence, and finish protection.'),

  (27, 'The first question behind a better Seattle bathroom plan', 'homeowner_goals', 'Bathroom Remodeling', 'Seattle', 'Bathroom Remodeling', '["Home Remodeling Contractor"]', 'reel', 'Open with the homeowner routine the room needs to support, then show the decisions that follow.'),
  (28, 'Three kitchen-flow checks before a Portland cabinet plan is approved', 'design_education', 'Kitchen Remodeling', 'Portland', 'Kitchen Remodeling', '["Home Renovation Services"]', 'reel', 'Cover circulation, landing space, and the relationship between prep, cooking, and cleanup.'),
  (29, 'ADU privacy planning without assuming one Los Angeles layout', 'design_education', 'ADU Construction', 'Los Angeles', 'ADU Construction', '["General Contractor"]', 'reel', 'Discuss entry, windows, shared outdoor space, sound, and connection to the main home.'),
  (30, 'A Redmond room addition should improve the route through the home', 'functionality', 'Room Additions', 'Redmond', 'Room Addition Contractor', '["Home Remodeling Contractor"]', 'reel', 'Show how circulation and room relationships matter alongside added square footage.'),
  (31, 'Roofing scope questions to ask during a Portland renovation', 'decision_guidance', 'Roofing', 'Portland', 'Roofing Contractor', '["General Contractor"]', 'reel', 'Give homeowners a neutral list covering observed conditions, related exterior work, materials, and sequencing.'),
  (32, 'Deck or patio: start with how a Glendale household uses the outdoors', 'decision_guidance', 'Decks & Patios', 'Glendale', 'Patio Contractor', '["Deck Builder"]', 'reel', 'Compare use, connection, grade, maintenance preferences, and design goals without declaring one answer.'),
  (33, 'Garage storage that protects the main path through a Bellevue home', 'functionality', 'Garage Remodeling', 'Bellevue', 'Garage Remodel', '["Remodeling Contractor"]', 'reel', 'Explain clear zones, vertical storage, access, and the path between vehicles and the house.'),
  (34, 'A Lake Oswego outdoor plan needs transition zones, not isolated features', 'outdoor_living', 'Landscaping & Hardscaping', 'Lake Oswego', 'Patio Contractor', '["Home Renovation Services"]', 'reel', 'Connect doors, paths, gathering spaces, planting zones, and confirmed hardscape scope.'),
  (35, 'Three flooring details that affect a Pasadena renovation', 'craftsmanship', 'Flooring', 'Pasadena', 'Home Renovation Services', '["Remodeling Contractor"]', 'reel', 'Cover preparation, transitions, and how the material meets stairs, cabinets, and adjacent rooms.'),
  (36, 'Why Tacoma painting results begin before the first finish coat', 'craftsmanship', 'Painting', 'Tacoma', 'Remodeling Contractor', '["Home Renovation Services"]', 'reel', 'Focus on surface evaluation, preparation, protection, lighting, and finish selection.'),
  (37, 'Portland remodel sequencing: when HVAC and insulation decisions enter the plan', 'systems_coordination', 'HVAC & Insulation', 'Portland', 'General Contractor', '["Home Renovation Services"]', 'reel', 'Explain coordination timing without promising savings, performance, rebates, or compliance.'),
  (38, 'Window placement questions for a Burbank room redesign', 'design_education', 'Windows', 'Burbank', 'Home Remodeling Contractor', '["Home Renovation Services"]', 'reel', 'Discuss daylight, ventilation goals, furniture, privacy, exterior context, and finish continuity.'),
  (39, 'Plan electrical and plumbing around a Seattle kitchen routine', 'systems_coordination', 'Electrical & Plumbing', 'Seattle', 'General Contractor', '["Kitchen Remodeling"]', 'reel', 'Connect appliance locations, fixtures, lighting, outlets, and maintenance access to the layout.'),
  (40, 'Mold-remediation conversations should separate observations from conclusions', 'trust_process', 'Mold Remediation', 'Los Angeles', 'General Contractor', '["Home Renovation Services"]', 'reel', 'Explain documentation and specialist review without health, safety, cause, insurance, or clearance claims.'),
  (41, 'A Kirkland kitchen material palette should support the way the room works', 'material_education', 'Kitchen Remodeling', 'Kirkland', 'Kitchen Remodeling', '["Home Remodeling Contractor"]', 'reel', 'Connect surfaces, cabinetry, hardware, lighting, cleaning, and visual continuity to homeowner priorities.'),
  (42, 'Bathroom storage in Beaverton starts with what needs to stay within reach', 'functionality', 'Bathroom Remodeling', 'Beaverton', 'Bathroom Remodeling', '["Remodeling Contractor"]', 'reel', 'Use routines and inventory to explain vanity, linen, shower, and concealed storage decisions.'),
  (43, 'Questions for a San Fernando Valley ADU design consultation', 'faq', 'ADU Construction', 'San Fernando Valley', 'ADU Construction', '["General Contractor","Home Remodeling Contractor"]', 'reel', 'Cover intended use, access, privacy, property information, and must-have features without eligibility claims.'),
  (44, 'How a Hillsboro addition can respect the proportions of the existing home', 'craftsmanship', 'Room Additions', 'Hillsboro', 'Room Addition Contractor', '["Home Renovation Services"]', 'reel', 'Discuss massing, rooflines, openings, transitions, and finish continuity as design considerations.'),
  (45, 'Seattle roofing communication: what homeowners should expect between milestones', 'trust_process', 'Roofing', 'Seattle', 'Roofing Contractor', '["General Contractor"]', 'reel', 'Explain scope confirmation, access, updates, questions, documentation, and completion review.'),
  (46, 'Patio planning for a Tigard home starts at the back door', 'outdoor_living', 'Decks & Patios', 'Tigard', 'Patio Contractor', '["Deck Builder"]', 'reel', 'Follow the path from interior use to threshold, circulation, seating, and landscape connections.'),
  (47, 'A Los Angeles garage remodel should define what must remain flexible', 'homeowner_goals', 'Garage Remodeling', 'Los Angeles', 'Garage Remodel', '["Remodeling Contractor"]', 'reel', 'Discuss changing storage, parking, workspace, access, and confirmed utility needs.'),
  (48, 'Portland paint-color decisions change under real room lighting', 'material_education', 'Painting', 'Portland', 'Home Renovation Services', '["Remodeling Contractor"]', 'reel', 'Explain sampling across daylight, evening light, adjacent finishes, and different wall planes.'),

  (49, 'Seattle kitchen remodeling guide: from household goals to coordinated construction', 'design_build', 'Kitchen Remodeling', 'Seattle', 'Kitchen Remodeling', '["Home Remodeling Contractor","General Contractor"]', 'blog', 'Provide a practical sequence for goals, existing conditions, layout, systems, selections, construction, and communication.'),
  (50, 'Planning a Portland bathroom renovation around function and maintainability', 'design_build', 'Bathroom Remodeling', 'Portland', 'Bathroom Remodeling', '["Home Renovation Services","Remodeling Contractor"]', 'blog', 'Explain routines, layout, preparation, fixtures, lighting, storage, materials, and maintenance considerations.'),
  (51, 'Los Angeles ADU planning: questions to answer before design decisions begin', 'faq', 'ADU Construction', 'Los Angeles', 'ADU Construction', '["General Contractor","Home Remodeling Contractor"]', 'blog', 'Cover intended use, occupants, access, privacy, site information, utilities, budget discussion, and property-specific review.'),
  (52, 'Bellevue room-addition planning from space needs to finish continuity', 'design_build', 'Room Additions', 'Bellevue', 'Room Addition Contractor', '["Home Remodeling Contractor"]', 'blog', 'Explain the path from goals and existing conditions through design, coordination, construction, and transitions.'),
  (53, 'Roofing inside a Portland whole-home renovation: coordination points to discuss', 'systems_coordination', 'Roofing', 'Portland', 'Roofing Contractor', '["Home Renovation Services","General Contractor"]', 'blog', 'Cover observed conditions, drainage, ventilation, exterior interfaces, access, materials, and sequencing without diagnosis.'),
  (54, 'Kirkland deck planning guide for a better connection between home and yard', 'outdoor_living', 'Decks & Patios', 'Kirkland', 'Deck Builder', '["Patio Contractor","Remodeling Contractor"]', 'blog', 'Discuss use, access, grade, circulation, privacy, shade, material priorities, and maintenance preferences.'),
  (55, 'Glendale garage remodeling guide: storage, access, surfaces, and flexibility', 'functionality', 'Garage Remodeling', 'Glendale', 'Garage Remodel', '["Home Remodeling Contractor"]', 'blog', 'Help homeowners define zones and priorities without assuming an approved conversion to living space.'),
  (56, 'Tigard landscape and hardscape planning around everyday outdoor routines', 'outdoor_living', 'Landscaping & Hardscaping', 'Tigard', 'Patio Contractor', '["Home Renovation Services"]', 'blog', 'Organize the discussion around access, gathering, transitions, maintenance, and confirmed site needs.'),
  (57, 'Flooring decisions in a Los Angeles renovation: preparation through transitions', 'craftsmanship', 'Flooring', 'Los Angeles', 'Home Renovation Services', '["Remodeling Contractor"]', 'blog', 'Explain existing conditions, preparation, material priorities, layout direction, transitions, installation sequence, and protection.'),
  (58, 'Painting during a Lake Oswego renovation: preparation, sheen, and sequence', 'craftsmanship', 'Painting', 'Lake Oswego', 'Remodeling Contractor', '["Home Renovation Services"]', 'blog', 'Explain how surfaces, light, room use, adjacent work, protection, and finish selection shape the plan.'),
  (59, 'Coordinating HVAC and insulation during a Seattle home remodel', 'systems_coordination', 'HVAC & Insulation', 'Seattle', 'General Contractor', '["Home Remodeling Contractor","Home Renovation Services"]', 'blog', 'Show when comfort goals, existing conditions, layout changes, envelope work, access, and sequencing enter the conversation.'),
  (60, 'Window planning for a Beaverton renovation: light, ventilation, and continuity', 'design_education', 'Windows', 'Beaverton', 'Home Renovation Services', '["Remodeling Contractor"]', 'blog', 'Discuss opening types, placement, privacy, exterior context, interior finishes, installation coordination, and maintenance priorities.'),
  (61, 'Electrical and plumbing coordination before a Pasadena remodel reaches finishes', 'systems_coordination', 'Electrical & Plumbing', 'Pasadena', 'General Contractor', '["Home Remodeling Contractor"]', 'blog', 'Explain fixture and appliance planning, access, lighting, outlets, layout dependencies, and professional scope confirmation.'),
  (62, 'Mold remediation in a Tacoma renovation: documentation and coordination questions', 'trust_process', 'Mold Remediation', 'Tacoma', 'General Contractor', '["Home Renovation Services"]', 'blog', 'Explain observations, specialist records, affected scope, communication, and sequencing without making health or clearance claims.'),
  (63, 'Burbank kitchen remodeling checklist for layout, storage, and selections', 'faq', 'Kitchen Remodeling', 'Burbank', 'Kitchen Remodeling', '["Remodeling Contractor"]', 'blog', 'Provide a homeowner checklist ordered from routines and layout through systems, cabinetry, surfaces, lighting, hardware, and review.'),
  (64, 'Redmond bathroom remodeling questions for a clearer project brief', 'faq', 'Bathroom Remodeling', 'Redmond', 'Bathroom Remodeling', '["Home Remodeling Contractor"]', 'blog', 'Help homeowners document routines, storage, access, lighting, fixtures, material preferences, and maintenance needs.'),
  (65, 'Portland ADU planning for flexible household needs', 'homeowner_goals', 'ADU Construction', 'Portland', 'ADU Construction', '["Home Renovation Services","General Contractor"]', 'blog', 'Discuss intended use, privacy, accessibility goals, storage, shared outdoor space, and future flexibility without eligibility claims.'),
  (66, 'San Fernando Valley room additions: planning for circulation and long-term use', 'functionality', 'Room Additions', 'San Fernando Valley', 'Room Addition Contractor', '["Home Remodeling Contractor"]', 'blog', 'Explain household needs, room relationships, circulation, daylight, transitions, systems coordination, and future use.'),
  (67, 'Seattle roofing project questions that improve scope and communication', 'trust_process', 'Roofing', 'Seattle', 'Roofing Contractor', '["General Contractor"]', 'blog', 'Offer a neutral question list covering observations, scope, materials, access, related work, updates, documentation, and review.'),
  (68, 'Los Angeles patio planning around indoor-outdoor circulation', 'outdoor_living', 'Decks & Patios', 'Los Angeles', 'Patio Contractor', '["Deck Builder","Remodeling Contractor"]', 'blog', 'Explain thresholds, paths, use zones, seating, shade preferences, privacy, maintenance, and connections to the home.'),
  (69, 'Landscaping and hardscaping as part of a Seattle home-improvement plan', 'design_build', 'Landscaping & Hardscaping', 'Seattle', 'Home Remodeling Contractor', '["Patio Contractor","Home Renovation Services"]', 'blog', 'Connect exterior circulation, gathering, confirmed site needs, material transitions, maintenance preferences, and project sequencing.'),
  (70, 'Portland garage remodeling questions for a more useful and organized space', 'faq', 'Garage Remodeling', 'Portland', 'Garage Remodel', '["Remodeling Contractor","Home Renovation Services"]', 'blog', 'Provide a checklist for parking, storage, work zones, surfaces, lighting, access, confirmed systems, and future flexibility.')
)
INSERT INTO client_monthly_topics
    (client_id, plan_month, topic_title, service_category, target_keyword, content_type_preference,
     preferred_platforms, priority, status, notes, created_by, created_at, updated_at, slot_number,
     content_pillar, working_title, primary_service, primary_area, supporting_keywords, format,
     offer_or_event, image_requirement, proof_requirement, claim_requirement, approval_status,
     approved_by, approved_at)
SELECT c.id, '2026-08', d.topic, d.service, d.keyword, d.content_type,
       CASE d.content_type
         WHEN 'image' THEN '["facebook","instagram","linkedin","x","threads","pinterest","bluesky","google_business"]'
         WHEN 'reel' THEN '["facebook","instagram","tiktok","youtube","threads"]'
         WHEN 'video' THEN '["facebook","instagram","youtube","linkedin","x"]'
         ELSE '["website_blog"]'
       END,
       1000 - d.slot_number, 'approved', d.notes, 'owner-profile-2026-08-06', unixepoch(), unixepoch(),
       d.slot_number, d.pillar, d.topic, d.service, d.area, d.supporting_keywords,
       CASE d.content_type
         WHEN 'image' THEN 'educational single-image post'
         WHEN 'video' THEN 'horizontal educational video'
         WHEN 'reel' THEN 'short-form vertical video script'
         ELSE 'local educational guide'
       END,
       'none',
       CASE d.content_type
         WHEN 'image' THEN 'Use approved Elite Team Builders project media or a neutral educational visual. Never fabricate a before-and-after transformation or client project.'
         WHEN 'video' THEN 'Use approved horizontal project, process, material, or team footage. If project proof is unavailable, use neutral educational footage and remove project-specific wording.'
         WHEN 'reel' THEN 'Use approved vertical project, process, material, or team footage. If project proof is unavailable, use neutral educational footage and remove project-specific wording.'
         ELSE 'No automatic image requirement. Any added image must be approved, relevant to the market and service, and cleared for use.'
       END,
       'Project-specific facts, homeowner stories, locations, progress, transformations, materials, and outcomes require verified records and approved assets. Otherwise present the topic as general guidance.',
       'Do not invent credentials, diagnoses, prices, discounts, permits, timelines, warranties, savings, value increases, health or safety outcomes, offers, testimonials, rankings, or guarantees.',
       'approved', 'owner-profile-2026-08-06', unixepoch()
FROM topic_data d CROSS JOIN clients c
WHERE c.slug = 'elite-team-builders';
