-- Install the owner-approved Modern Vision profile and package-matched August plan.

UPDATE clients
SET canonical_name = 'Modern Vision Remodeling Experts',
    notes = 'Residential remodeling company serving the approved Austin-area markets. Focus content on homeowner goals, real project transformations, communication, craftsmanship, process transparency, and trust. Do not invent project facts, offers, prices, timelines, or guarantees.',
    brand_json = '{"brand_overview":"Modern Vision Remodeling Experts is a residential remodeling company serving approved Austin-area communities.","editorial_identity":"Experienced residential remodeling project manager guiding homeowners through clear decisions and real transformations","personality":["professional","trustworthy","experienced","friendly","helpful","educational","detail-oriented"],"messaging_focus":["homeowner goals","real project transformation","communication","quality craftsmanship","process transparency","trust"],"preferred_phrases":["Our client wanted...","One thing homeowners often ask...","During this project...","Here''s what we recommended...","Let''s bring your vision to life."],"audience":{"age_range":"35-65","household_income":"$120,000+","type":"homeowners"},"content_evidence_policy":"Use real project stories, homeowner challenges, before-and-after transformations, material selections, construction progress, and team involvement only when the supporting project details or assets are verified.","service_tiers":{"tier_1":["Bathroom Remodeling","Kitchen Remodeling","Full Home Remodeling"],"tier_2":["Room Additions","Accessory Dwelling Units (ADUs)","Garage Conversions"],"tier_3":["Attic Conversions","Deck Remodeling"]},"primary_areas":["Austin","Cedar Park","Leander","Round Rock","Georgetown"],"secondary_areas":["Pflugerville","Liberty Hill","Bee Cave","Lakeway","West Lake Hills","Lago Vista","Steiner Ranch"],"profile_source":"owner-profile-2026-08-06"}',
    cta_text = 'Schedule Your Free Consultation',
    cta_label = 'Schedule Your Free Consultation',
    industry = 'Residential Remodeling Company',
    state = 'TX',
    profile_approval_status = 'approved',
    profile_approved_by = 'owner-profile-2026-08-06',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug = 'modern-vision-remodeling';

INSERT INTO client_intelligence
    (client_id, brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals,
     service_priorities, content_angles, seasonal_notes, competitor_notes, audience_notes,
     primary_keyword, secondary_keywords, local_seo_themes, generation_language,
     humanization_style, monthly_snapshot, feedback_summary, last_research_at, created_at, updated_at)
SELECT id,
       'Write as an experienced Modern Vision project manager guiding homeowners through the remodeling process. Be professional, trustworthy, experienced, friendly, helpful, educational, detail-oriented, human, conversational, and confident without sounding salesy or corporate.',
       '["professional","trustworthy","experienced","friendly","helpful","educational","detail-oriented","human","conversational","confident"]',
       '["Cheapest","Lowest Price","Budget Contractor","Cheap Remodel","Guaranteed Lowest Price","Crazy Deal","Must Buy Today","Act Now!!!"]',
       '["Schedule Your Free Consultation","Request Your Free Estimate","Contact Our Team Today","Start Your Remodeling Journey","Book A Design Consultation","Send Us A Message","Learn More About Your Options","See What''s Possible In Your Home"]',
       '["Generate consultations","Generate estimate requests","Build trust","Showcase completed projects","Increase Google reviews","Improve local visibility"]',
       '[{"tier":1,"services":["Bathroom Remodeling","Kitchen Remodeling","Full Home Remodeling"]},{"tier":2,"services":["Room Additions","Accessory Dwelling Units (ADUs)","Garage Conversions"]},{"tier":3,"services":["Attic Conversions","Deck Remodeling"]}]',
       '["Real project stories with verified facts","Homeowner challenge and recommendation","Before-and-after transformation with approved assets","Material selection education","Construction progress with verified footage","Team involvement","Process transparency","Layout and function decisions"]',
       'Use seasonal angles only when they connect to a confirmed homeowner need, real project stage, or relevant local condition. Never invent an offer, event, deadline, or urgency.',
       'Avoid interchangeable contractor copy, corporate language, unsupported superlatives, and price-led positioning. Emphasize clear guidance, craftsmanship, communication, and evidence.',
       'Homeowners ages 35-65 with household income of $120,000+ in approved Austin-area markets. Pain points include outdated kitchens and bathrooms, limited space, poor layouts, contractor trust, budget planning, home value, and the need for more functional living space.',
       'Austin Home Remodeling',
       '["Bathroom Remodeling Austin","Kitchen Remodeling Austin","Home Remodeling Austin","Bathroom Remodel Cedar Park","Kitchen Remodel Cedar Park","Full Home Renovation Austin","Room Addition Austin","ADU Builder Austin","Garage Conversion Austin","Remodeler Cedar Park"]',
       '["Austin","Cedar Park","Leander","Round Rock","Georgetown","Pflugerville","Liberty Hill","Bee Cave","Lakeway","West Lake Hills","Lago Vista","Steiner Ranch"]',
       'en',
       'Every post should sound like a real Modern Vision team member. Use a specific homeowner question, design decision, project step, material consideration, or verified transformation. Project-story language requires verified details; otherwise present the content as general homeowner guidance.',
       '{"month":"2026-08","package":"modernvision","expected_slots":26,"content_types":{"image":13,"reel":13},"platforms":["facebook","instagram","google_business"]}',
       'Owner-approved profile received 2026-08-06. Remove stale high-end positioning, exterior-upgrade services, unverified experience claims, unsupported addresses, and generic research keywords from generation.',
       unixepoch(), unixepoch(), unixepoch()
FROM clients WHERE slug = 'modern-vision-remodeling'
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
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling');

INSERT INTO client_research_notes
    (client_id, source, research_json, freshness_date, brand_name, source_url, source_domain,
     source_title, entity_match, geography_match, service_match, prohibited_service_detected,
     confidence, review_status, reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
SELECT id,
       'owner_profile',
       '{"brand":"Modern Vision Remodeling Experts","business_type":"Residential remodeling company","services":["Bathroom Remodeling","Kitchen Remodeling","Full Home Remodeling","Room Additions","Accessory Dwelling Units (ADUs)","Garage Conversions","Attic Conversions","Deck Remodeling"],"primary_areas":["Austin","Cedar Park","Leander","Round Rock","Georgetown"],"secondary_areas":["Pflugerville","Liberty Hill","Bee Cave","Lakeway","West Lake Hills","Lago Vista","Steiner Ranch"],"primary_keyword":"Austin Home Remodeling","audience":{"age_range":"35-65","household_income":"$120,000+"},"editorial_policy":"Helpful project-manager guidance using only verified project facts and approved services, areas, keywords, and CTAs."}',
       '2026-08-06',
       'Modern Vision Remodeling Experts',
       'internal://modern-vision-owner-profile-2026-08-06',
       'internal',
       'Owner-approved Modern Vision brand profile',
       1, 1, 1, 0, 'high', 'approved', 'owner-profile-2026-08-06', unixepoch(),
       '2027-02-06',
       'Canonical owner-supplied profile. Revalidate services, areas, destinations, and claims before expiration.',
       unixepoch(), unixepoch()
FROM clients WHERE slug = 'modern-vision-remodeling';

DELETE FROM client_services
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling');

WITH service_data(name, normalized_name, service_pillar, description, editorial_notes, sort_order) AS (VALUES
  ('Bathroom Remodeling', 'bathroom remodeling', 'tier_1', 'Bathroom layout, materials, fixtures, function, and renovation process.', 'Tier 1 priority service.', 0),
  ('Kitchen Remodeling', 'kitchen remodeling', 'tier_1', 'Kitchen layout, cabinetry, surfaces, lighting, storage, and renovation process.', 'Tier 1 priority service.', 1),
  ('Full Home Remodeling', 'full home remodeling', 'tier_1', 'Coordinated whole-home layout, finish, and renovation planning.', 'Tier 1 priority service.', 2),
  ('Room Additions', 'room additions', 'tier_2', 'Planning and construction guidance for additional living space.', 'Tier 2 priority service.', 3),
  ('Accessory Dwelling Units (ADUs)', 'accessory dwelling units adus', 'tier_2', 'Planning and construction guidance for accessory dwelling units.', 'Tier 2 priority service; do not state permit or zoning outcomes without verified project evidence.', 4),
  ('Garage Conversions', 'garage conversions', 'tier_2', 'Converting garage space into functional living space.', 'Tier 2 priority service.', 5),
  ('Attic Conversions', 'attic conversions', 'tier_3', 'Evaluating and converting attic space for safe, functional use.', 'Tier 3 priority service; avoid unsupported feasibility claims.', 6),
  ('Deck Remodeling', 'deck remodeling', 'tier_3', 'Deck layout, material, repair, and remodeling guidance.', 'Tier 3 priority service.', 7)
)
INSERT INTO client_services
    (id, client_id, name, normalized_name, service_pillar, description, approval_status,
     approved_by, approved_at, editorial_notes, active, sort_order, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, d.name, d.normalized_name, d.service_pillar, d.description,
       'approved', 'owner-profile-2026-08-06', unixepoch(), d.editorial_notes, 1, d.sort_order,
       unixepoch(), unixepoch()
FROM service_data d CROSS JOIN clients c
WHERE c.slug = 'modern-vision-remodeling';

DELETE FROM client_service_areas
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling');

WITH area_data(city, primary_area, sort_order) AS (VALUES
  ('Austin', 1, 0),
  ('Cedar Park', 1, 1),
  ('Leander', 1, 2),
  ('Round Rock', 1, 3),
  ('Georgetown', 1, 4),
  ('Pflugerville', 0, 5),
  ('Liberty Hill', 0, 6),
  ('Bee Cave', 0, 7),
  ('Lakeway', 0, 8),
  ('West Lake Hills', 0, 9),
  ('Lago Vista', 0, 10),
  ('Steiner Ranch', 0, 11)
)
INSERT INTO client_service_areas
    (id, client_id, city, state, primary_area, sort_order, approval_status, approved_by,
     approved_at, editorial_notes, created_at)
SELECT lower(hex(randomblob(16))), c.id, d.city, 'TX', d.primary_area, d.sort_order,
       'approved', 'owner-profile-2026-08-06', unixepoch(),
       CASE WHEN d.primary_area = 1 THEN 'Owner-approved primary local SEO area.' ELSE 'Owner-approved secondary local SEO area.' END,
       unixepoch()
FROM area_data d CROSS JOIN clients c
WHERE c.slug = 'modern-vision-remodeling';

UPDATE client_keywords
SET status = 'archived',
    approval_status = 'rejected',
    approved_by = NULL,
    approved_at = NULL,
    opportunity_notes = 'Superseded by the owner-approved Modern Vision keyword set.',
    updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling');

WITH keyword_data(keyword, normalized_keyword, kw_type, search_intent, service_pillar, locality, notes) AS (VALUES
  ('Austin Home Remodeling', 'austin home remodeling', 'primary', 'transactional', 'tier_1', 'Austin', 'Owner-approved primary keyword.'),
  ('Bathroom Remodeling Austin', 'bathroom remodeling austin', 'local', 'transactional', 'tier_1', 'Austin', 'Bathroom remodeling service intent.'),
  ('Kitchen Remodeling Austin', 'kitchen remodeling austin', 'local', 'transactional', 'tier_1', 'Austin', 'Kitchen remodeling service intent.'),
  ('Home Remodeling Austin', 'home remodeling austin', 'local', 'transactional', 'tier_1', 'Austin', 'Owner-approved local variant.'),
  ('Bathroom Remodel Cedar Park', 'bathroom remodel cedar park', 'local', 'transactional', 'tier_1', 'Cedar Park', 'Bathroom remodeling service intent.'),
  ('Kitchen Remodel Cedar Park', 'kitchen remodel cedar park', 'local', 'transactional', 'tier_1', 'Cedar Park', 'Kitchen remodeling service intent.'),
  ('Full Home Renovation Austin', 'full home renovation austin', 'local', 'transactional', 'tier_1', 'Austin', 'Full-home renovation service intent.'),
  ('Room Addition Austin', 'room addition austin', 'local', 'transactional', 'tier_2', 'Austin', 'Room-addition service intent.'),
  ('ADU Builder Austin', 'adu builder austin', 'local', 'transactional', 'tier_2', 'Austin', 'ADU service intent; avoid unsupported feasibility or permit claims.'),
  ('Garage Conversion Austin', 'garage conversion austin', 'local', 'transactional', 'tier_2', 'Austin', 'Garage-conversion service intent.'),
  ('Remodeler Cedar Park', 'remodeler cedar park', 'local', 'transactional', 'tier_1', 'Cedar Park', 'General Cedar Park remodeling intent.')
)
INSERT INTO client_keywords
    (client_id, keyword, normalized_keyword, kw_type, search_intent, service_pillar, locality,
     brand_owner, confidence, source, approval_status, approved_by, approved_at,
     opportunity_notes, status, created_at, updated_at)
SELECT c.id, d.keyword, d.normalized_keyword, d.kw_type, d.search_intent, d.service_pillar,
       d.locality, 'modern-vision-remodeling', 'high', 'owner_profile_2026_08_06', 'approved',
       'owner-profile-2026-08-06', unixepoch(), d.notes, 'active', unixepoch(), unixepoch()
FROM keyword_data d CROSS JOIN clients c
WHERE c.slug = 'modern-vision-remodeling'
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
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling');

WITH restriction(term) AS (VALUES
  ('Cheapest'),
  ('Lowest Price'),
  ('Budget Contractor'),
  ('Cheap Remodel'),
  ('Guaranteed Lowest Price'),
  ('Crazy Deal'),
  ('Must Buy Today'),
  ('Act Now!!!')
)
INSERT INTO client_restrictions (client_id, term)
SELECT c.id, r.term
FROM restriction r CROSS JOIN clients c
WHERE c.slug = 'modern-vision-remodeling';

UPDATE client_strategy_plans
SET status = 'archived', updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling')
  AND period_start <= '2026-08-31'
  AND period_end >= '2026-08-01';

INSERT INTO client_strategy_plans
    (client_id, period_start, period_end, strategy_json, status, created_at, updated_at)
SELECT id, '2026-08-01', '2026-08-31',
       '{"identity":"Experienced Austin-area residential remodeling project manager","objectives":["consultations","estimate requests","trust","completed-project visibility","Google reviews","local visibility"],"service_mix":{"tier_1":"Bathroom, kitchen, and full-home remodeling lead the month","tier_2":"Room additions, ADUs, and garage conversions support expansion needs","tier_3":"Attic conversions and deck remodeling remain selective"},"editorial_rules":["Use only verified project stories and assets","Lead with one homeowner problem or decision","Explain one concrete recommendation or process step","Use one approved primary keyword naturally","Use only approved CTAs","Do not invent prices, timelines, guarantees, offers, permits, reviews, or project facts"],"package":{"slug":"modernvision","slots":26,"image":13,"reel":13,"schedule":"Monday, Wednesday, and Friday"}}',
       'approved', unixepoch(), unixepoch()
FROM clients WHERE slug = 'modern-vision-remodeling';

INSERT INTO client_monthly_content_plans
    (client_id, plan_month, monthly_focus, promotion_notes, priority_services, notes, created_by,
     status, expected_slots, approved_by, approved_at, created_at, updated_at)
SELECT id, '2026-08',
       'Helpful project-manager guidance for functional Austin-area home transformations.',
       'No offer, price, discount, deadline, or urgency may be invented. Use only the approved CTA set.',
       '["Bathroom Remodeling","Kitchen Remodeling","Full Home Remodeling","Room Additions","Accessory Dwelling Units (ADUs)","Garage Conversions","Attic Conversions","Deck Remodeling"]',
       'Exactly 26 core topics aligned to the ModernVision package: 13 image posts and 13 reels. Project-specific statements require verified proof.',
       'owner-profile-2026-08-06', 'approved', 26, 'owner-profile-2026-08-06', unixepoch(), unixepoch(), unixepoch()
FROM clients WHERE slug = 'modern-vision-remodeling'
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
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling')
  AND plan_month = '2026-08';

WITH topic_data(slot_number, topic, pillar, service, area, keyword, supporting_keywords, content_type, format, image_requirement, proof_requirement, notes) AS (VALUES
  (1, 'A bathroom remodel starts with the routines the room needs to support', 'homeowner_goals', 'Bathroom Remodeling', 'Austin', 'Bathroom Remodeling Austin', '["Austin Home Remodeling"]', 'image', 'educational single-image', 'Use an approved bathroom project photo or a clean layout-planning visual.', 'Do not describe a specific client unless the project brief and asset are verified.', 'Explain how daily routines shape layout, storage, lighting, and fixture decisions.'),
  (2, 'Questions to answer before planning a room addition', 'space_planning', 'Room Additions', 'Leander', 'Room Addition Austin', '["Austin Home Remodeling"]', 'reel', 'short-form video script', 'Use approved addition footage or process visuals that do not imply an unverified project.', 'Do not claim feasibility, permit approval, cost, or schedule without project evidence.', 'Guide homeowners through purpose, circulation, utilities, and connection to the existing home.'),
  (3, 'Kitchen workflow before finishes: planning the spaces between daily tasks', 'design_education', 'Kitchen Remodeling', 'Austin', 'Kitchen Remodeling Austin', '["Austin Home Remodeling"]', 'image', 'educational single-image', 'Use an approved kitchen project or a clear workflow planning visual.', 'No fabricated before-and-after story.', 'Teach workflow and function before discussing finishes.'),
  (4, 'The first ADU conversation: use, privacy, access, and utilities', 'space_planning', 'Accessory Dwelling Units (ADUs)', 'Austin', 'ADU Builder Austin', '["Home Remodeling Austin"]', 'reel', 'FAQ video script', 'Use approved ADU footage or neutral planning visuals.', 'Do not state zoning, permit, feasibility, value, cost, or timeline outcomes.', 'Frame this as early planning questions and recommend confirming property-specific requirements.'),
  (5, 'How to keep a full-home renovation visually connected from room to room', 'design_education', 'Full Home Remodeling', 'Austin', 'Full Home Renovation Austin', '["Home Remodeling Austin"]', 'image', 'educational single-image', 'Use approved whole-home project photography or a material palette from a verified project.', 'Name materials or client goals only when verified.', 'Explain continuity through sightlines, materials, lighting, and repeated details.'),
  (6, 'What makes a garage conversion feel like part of the home', 'space_planning', 'Garage Conversions', 'Austin', 'Garage Conversion Austin', '["Austin Home Remodeling"]', 'reel', 'short-form video script', 'Use approved conversion footage or neutral envelope and comfort-system visuals.', 'Do not claim feasibility, code compliance, cost, or schedule without evidence.', 'Discuss insulation, light, comfort, access, and visual continuity at a general level.'),
  (7, 'Bathroom layout or finish upgrade: where Cedar Park homeowners should begin', 'decision_guidance', 'Bathroom Remodeling', 'Cedar Park', 'Bathroom Remodel Cedar Park', '["Remodeler Cedar Park"]', 'image', 'comparison post', 'Use an approved bathroom image that clearly supports the chosen decision.', 'No unsupported client outcome or price claim.', 'Compare functional layout needs with cosmetic finish goals.'),
  (8, 'The communication rhythm that keeps a full-home remodel understandable', 'process_transparency', 'Full Home Remodeling', 'Cedar Park', 'Home Remodeling Austin', '["Remodeler Cedar Park"]', 'reel', 'trust and process video', 'Use verified team or project-progress footage; otherwise use neutral planning visuals.', 'Do not identify a client, team member, timeline, or milestone unless verified.', 'Show what homeowners should expect from updates, decisions, questions, and documentation.'),
  (9, 'Cabinet planning around the items a Cedar Park kitchen actually stores', 'homeowner_goals', 'Kitchen Remodeling', 'Cedar Park', 'Kitchen Remodel Cedar Park', '["Remodeler Cedar Park"]', 'image', 'educational single-image', 'Use an approved cabinet project or a storage-planning visual.', 'Do not invent a client storage problem.', 'Connect cabinet configuration to real household routines and frequently used items.'),
  (10, 'Attic conversion questions about headroom, comfort, access, and light', 'space_planning', 'Attic Conversions', 'Austin', 'Austin Home Remodeling', '["Home Remodeling Austin"]', 'reel', 'FAQ video script', 'Use approved attic footage or neutral evaluation visuals.', 'Do not claim the space is buildable or compliant without a verified assessment.', 'Teach the questions that determine whether deeper evaluation is worthwhile.'),
  (11, 'Deck remodeling decisions for sun, rain, traffic, and maintenance', 'material_education', 'Deck Remodeling', 'Lakeway', 'Remodeler Cedar Park', '["Austin Home Remodeling"]', 'image', 'educational single-image', 'Use approved deck photography or an honest material-comparison visual.', 'Do not claim material performance or warranty terms without verified product evidence.', 'Explain how exposure and homeowner maintenance preferences shape material discussions.'),
  (12, 'How a room addition should connect to the existing home', 'craftsmanship', 'Room Additions', 'Cedar Park', 'Room Addition Austin', '["Remodeler Cedar Park"]', 'reel', 'short-form video script', 'Use approved addition details or neutral transition examples.', 'No fabricated project story, engineering claim, or schedule.', 'Discuss rooflines, floor transitions, circulation, light, and finish continuity.'),
  (13, 'Bathroom waterproofing is a system, not a visible finish', 'craftsmanship', 'Bathroom Remodeling', 'Round Rock', 'Bathroom Remodeling Austin', '["Austin Home Remodeling"]', 'image', 'educational single-image', 'Use approved in-progress waterproofing documentation or an educational layer diagram.', 'Only identify a specific product or installation method when verified.', 'Explain why hidden preparation matters without making warranty guarantees.'),
  (14, 'What homeowners should expect during a coordinated full-home renovation', 'process_transparency', 'Full Home Remodeling', 'West Lake Hills', 'Full Home Renovation Austin', '["Home Remodeling Austin"]', 'reel', 'process breakdown video', 'Use approved progress footage or a neutral sequencing visual.', 'Do not promise a timeline or uninterrupted access.', 'Describe planning, selections, sequencing, communication, and change decisions.'),
  (15, 'Kitchen material selections should support the way the room is used', 'material_education', 'Kitchen Remodeling', 'Leander', 'Kitchen Remodeling Austin', '["Austin Home Remodeling"]', 'image', 'educational single-image', 'Use a verified material palette or approved kitchen project.', 'Do not name a client or product performance claim without evidence.', 'Connect surfaces, cabinetry, flooring, and hardware to maintenance and daily use.'),
  (16, 'Five planning details that shape a comfortable garage conversion', 'space_planning', 'Garage Conversions', 'Austin', 'Garage Conversion Austin', '["Austin Home Remodeling"]', 'reel', 'checklist video script', 'Use approved conversion footage or neutral planning details.', 'Do not claim the property qualifies or state permit outcomes.', 'Cover light, temperature, access, privacy, and storage tradeoffs.'),
  (17, 'An ADU plan should begin with the people who will use it', 'homeowner_goals', 'Accessory Dwelling Units (ADUs)', 'Austin', 'ADU Builder Austin', '["Home Remodeling Austin"]', 'image', 'educational single-image', 'Use approved ADU imagery or a neutral space-planning visual.', 'Do not invent occupants, rental income, permit results, value, cost, or timeline.', 'Compare needs for family, guests, work, and long-term flexibility without promising outcomes.'),
  (18, 'Deck remodeling: repair priorities versus a broader redesign', 'decision_guidance', 'Deck Remodeling', 'Steiner Ranch', 'Austin Home Remodeling', '["Home Remodeling Austin"]', 'reel', 'comparison video script', 'Use approved deck condition footage or neutral detail visuals.', 'Do not diagnose structural conditions from generic footage or promise a repair scope.', 'Explain when a professional evaluation should guide repair-versus-redesign decisions.'),
  (19, 'Bathroom storage that reduces countertop clutter without crowding the room', 'design_education', 'Bathroom Remodeling', 'Pflugerville', 'Bathroom Remodel Cedar Park', '["Bathroom Remodeling Austin"]', 'image', 'educational single-image', 'Use an approved bathroom project or storage-planning visual.', 'Do not present a fabricated homeowner quote or project result.', 'Discuss recessed, vertical, vanity, and linen storage based on available space.'),
  (20, 'How to prepare for the first room-addition design conversation', 'process_transparency', 'Room Additions', 'Georgetown', 'Room Addition Austin', '["Austin Home Remodeling"]', 'reel', 'FAQ video script', 'Use approved planning footage or neutral homeowner preparation visuals.', 'Do not imply a design, feasibility, cost, or schedule has been approved.', 'Give a practical list of goals, constraints, inspiration, priorities, and questions to bring.'),
  (21, 'Kitchen lighting works best when task, ambient, and accent needs are planned together', 'design_education', 'Kitchen Remodeling', 'Georgetown', 'Kitchen Remodel Cedar Park', '["Kitchen Remodeling Austin"]', 'image', 'educational single-image', 'Use an approved kitchen lighting photo or a clear lighting-layer visual.', 'Do not state product specifications unless verified.', 'Explain lighting layers through practical homeowner tasks.'),
  (22, 'An ADU consultation should separate goals from property-specific requirements', 'process_transparency', 'Accessory Dwelling Units (ADUs)', 'Austin', 'ADU Builder Austin', '["Austin Home Remodeling"]', 'reel', 'trust and process video', 'Use approved consultation or project footage without exposing private client information.', 'Do not state zoning, permit, feasibility, value, cost, or timeline outcomes.', 'Show how a team can clarify goals before confirming requirements through the appropriate process.'),
  (23, 'Where to focus a full-home remodeling budget before choosing finishes', 'decision_guidance', 'Full Home Remodeling', 'Austin', 'Home Remodeling Austin', '["Full Home Renovation Austin"]', 'image', 'educational single-image', 'Use approved project planning visuals or a non-price priority framework.', 'Do not provide invented prices, savings, allowances, or guarantees.', 'Teach prioritization around function, existing conditions, scope, and long-term goals.'),
  (24, 'What an in-progress attic evaluation can reveal before design begins', 'process_transparency', 'Attic Conversions', 'Austin', 'Austin Home Remodeling', '["Home Remodeling Austin"]', 'reel', 'process breakdown video', 'Use verified attic evaluation footage or neutral inspection visuals.', 'Do not claim feasibility, structural capacity, compliance, cost, or schedule.', 'Explain that access, structure, utilities, comfort, and light require property-specific review.'),
  (25, 'Bathroom lighting decisions for grooming, comfort, and nighttime use', 'design_education', 'Bathroom Remodeling', 'Bee Cave', 'Bathroom Remodeling Austin', '["Austin Home Remodeling"]', 'image', 'educational single-image', 'Use an approved bathroom lighting image or clear lighting-layer visual.', 'Do not name unverified products or claim guaranteed performance.', 'Explain task, ambient, and low-level lighting through homeowner routines.'),
  (26, 'What happens in a Modern Vision kitchen design consultation', 'trust_process', 'Kitchen Remodeling', 'Austin', 'Kitchen Remodeling Austin', '["Austin Home Remodeling"]', 'reel', 'trust and process video', 'Use verified team consultation footage or neutral planning visuals.', 'Do not promise price, design completion, schedule, or project acceptance.', 'Explain listening, priorities, measurements, options, questions, and next steps in a helpful tone.')
)
INSERT INTO client_monthly_topics
    (client_id, plan_month, topic_title, service_category, target_keyword, content_type_preference,
     preferred_platforms, priority, status, notes, created_by, created_at, updated_at, slot_number,
     content_pillar, working_title, primary_service, primary_area, supporting_keywords, format,
     offer_or_event, image_requirement, proof_requirement, claim_requirement, approval_status,
     approved_by, approved_at)
SELECT c.id, '2026-08', d.topic, d.service, d.keyword, d.content_type,
       CASE WHEN d.content_type = 'image' THEN '["facebook","instagram","google_business"]' ELSE '["facebook","instagram"]' END,
       1000 - d.slot_number, 'approved', d.notes, 'owner-profile-2026-08-06', unixepoch(), unixepoch(),
       d.slot_number, d.pillar, d.topic, d.service, d.area, d.supporting_keywords, d.format,
       'none', d.image_requirement, d.proof_requirement, 'none', 'approved',
       'owner-profile-2026-08-06', unixepoch()
FROM topic_data d CROSS JOIN clients c
WHERE c.slug = 'modern-vision-remodeling';
