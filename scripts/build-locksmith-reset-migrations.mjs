import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const resetDir = resolve(root, 'content-strategy-reset');
const migrationDir = resolve(root, 'db/migrations');

function csv(name) {
  const lines = readFileSync(resolve(resetDir, name), 'utf8').trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line, index) => {
    const values = line.split(',');
    if (values.length !== headers.length) {
      throw new Error(`${name}:${index + 2} has ${values.length} fields; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, fieldIndex) => [header, values[fieldIndex]]));
  });
}

function q(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function tuple(values) {
  return `(${values.map(q).join(', ')})`;
}

const portfolioSlugs = [
  '247-lockout-pasadena',
  '724-locksmith-ca',
  'daniels-locksmith',
  'unlocked-pros',
];
const slugSql = portfolioSlugs.map(q).join(', ');
const serviceRows = csv('04-approved-service-allowlist.csv');
const keywordRows = csv('06-keyword-cleanup.csv');
const researchRows = csv('02-research-quarantine-and-approval.csv').filter((row) => row.review_status === 'approved');
const claimRows = csv('03-approved-claims-register.csv');
const topicRows = [
  csv('15-august-247-topic-plan.csv'),
  csv('16-august-724-topic-plan.csv'),
  csv('17-august-daniels-topic-plan.csv'),
  csv('18-august-unlockd-topic-plan.csv'),
].flat();

for (const slug of portfolioSlugs) {
  const rows = topicRows.filter((row) => row.brand_id === slug);
  if (rows.length !== 26) throw new Error(`${slug} must have exactly 26 topic rows`);
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.package_content_type]: (acc[row.package_content_type] ?? 0) + 1 }), {});
  if (counts.image !== 9 || counts.video !== 4 || counts.reel !== 9 || counts.blog !== 4) {
    throw new Error(`${slug} has invalid Medium package allocation: ${JSON.stringify(counts)}`);
  }
}
const titles = new Set();
for (const row of topicRows) {
  const title = row.working_title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (titles.has(title)) throw new Error(`Duplicate portfolio title: ${row.working_title}`);
  titles.add(title);
}

function normalizeTopic(value) {
  return String(value ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((token) => token && !['a', 'an', 'and', 'for', 'in', 'of', 'the', 'to', 'with'].includes(token))
    .join(' ');
}

function topicSimilarity(left, right) {
  const a = new Set(normalizeTopic(left).split(' ').filter(Boolean));
  const b = new Set(normalizeTopic(right).split(' ').filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return overlap / Math.max(a.size, b.size);
}

for (let leftIndex = 0; leftIndex < topicRows.length; leftIndex++) {
  for (let rightIndex = leftIndex + 1; rightIndex < topicRows.length; rightIndex++) {
    const left = topicRows[leftIndex];
    const right = topicRows[rightIndex];
    const exact = normalizeTopic(left.working_title) === normalizeTopic(right.working_title);
    const sameCombination = normalizeTopic(left.primary_service) === normalizeTopic(right.primary_service)
      && normalizeTopic(left.primary_area) === normalizeTopic(right.primary_area)
      && normalizeTopic(left.content_pillar) === normalizeTopic(right.content_pillar)
      && topicSimilarity(left.working_title, right.working_title) >= 0.45;
    if (exact || sameCombination || topicSimilarity(left.working_title, right.working_title) >= 0.78) {
      throw new Error(`Portfolio topic collision: ${left.brand_id} slot ${left.slot_number} and ${right.brand_id} slot ${right.slot_number}`);
    }
  }
}

const serviceAreas = {
  '247-lockout-pasadena': ['Pasadena', 'South Pasadena', 'Altadena', 'San Marino', 'Arcadia', 'Sierra Madre'],
  '724-locksmith-ca': ['North Hollywood', 'Burbank', 'Studio City', 'Valley Village', 'Valley Glen', 'Sherman Oaks', 'Van Nuys', 'Glendale', 'Encino'],
  'daniels-locksmith': ['Hollywood', 'Los Angeles'],
  'unlocked-pros': ['Pasadena'],
};

const intelligence = {
  '247-lockout-pasadena': {
    voice: 'Calm during urgent situations; residential-first; practical authorization and preparation guidance; locally specific; no hype or panic language.',
    goals: 'Build Pasadena residential trust and generate qualified lockout rekeying and repair calls without unsupported claims.',
    services: ['House lockout assistance', 'Apartment and condo lockout assistance', 'Home rekeying', 'Residential lock repair', 'Deadbolt installation and repair', 'Car lockout assistance'],
    angles: ['Preparation', 'Authorization', 'Door protection', 'Repair versus replacement', 'Rental turnover', 'Pasadena education'],
    audience: 'Homeowners renters landlords and drivers in approved Pasadena-area communities.',
  },
  '724-locksmith-ca': {
    voice: 'Practical service-oriented and educational; balanced residential and commercial voice; clear mobile-service expectations.',
    goals: 'Own qualified North Hollywood Burbank and Studio City residential and commercial lock-service demand.',
    services: ['Residential lock repair', 'Home rekeying', 'Storefront lock repair', 'Commercial rekeying', 'Commercial door hardware', 'Car lockout assistance'],
    angles: ['Maintenance', 'Property-manager workflow', 'Door hardware', 'Service preparation', 'Repair decisions', 'SFV local education'],
    audience: 'Households storefronts offices landlords and property managers in approved SFV markets.',
  },
  'daniels-locksmith': {
    voice: 'Owner-operated personal educational and detail-oriented; less emergency-heavy than sibling brands.',
    goals: 'Build Hollywood-area authority for rekeying lock repair deadbolts and confirmed smart-lock service.',
    services: ['Home rekeying', 'Residential lock repair', 'Deadbolt installation and repair', 'Smart-lock installation', 'House and apartment lockout assistance'],
    angles: ['Component diagnosis', 'Compatibility', 'Move-in planning', 'Tenant changes', 'Owner communication', 'Repair versus replacement'],
    audience: 'Hollywood-area homeowners renters small property operators and limited local commercial clients.',
  },
  'unlocked-pros': {
    voice: 'Professional systems-oriented and documentation-focused; commercial and property-management first; planned rather than emergency-heavy.',
    goals: 'Build Pasadena commercial and property-management authority after authoritative GBP mapping is approved.',
    services: ['Commercial rekeying', 'Storefront lock repair', 'Office lock repair', 'Commercial door hardware', 'Property-management rekeying', 'Apartment-building lock service'],
    angles: ['Access changes', 'Documentation', 'Multi-unit workflow', 'Hardware inventory', 'Maintenance planning', 'Authorization'],
    audience: 'Property managers storefront operators office administrators and building owners in the verified Pasadena market.',
  },
};

const strategies = {
  '247-lockout-pasadena': { identity: 'Pasadena emergency and residential lockout specialist', mix: '8 residential lockout; 5 rekey/repair; 3 apartment/rental; 3 car lockout; 3 local; 2 trust/process; 1 offer; 1 seasonal' },
  '724-locksmith-ca': { identity: 'North Hollywood Burbank and Studio City residential and commercial lock service', mix: '7 residential; 6 commercial; 4 rekey/repair; 3 car lockout; 3 local; 2 trust/process; 1 offer' },
  'daniels-locksmith': { identity: 'Hollywood owner-operated rekeying lock repair and smart-lock service', mix: '7 rekeying; 6 repair; 4 smart-lock/deadbolt; 3 residential lockout; 2 commercial; 2 trust; 1 car lockout; 1 seasonal' },
  'unlocked-pros': { identity: 'Pasadena commercial property-management and conditional electronic-lock service', mix: '8 commercial; 6 property/multi-unit; 4 conditional electronic; 3 residential; 2 car lockout; 2 trust; 1 offer' },
};

const approvedProfiles = {
  '247-lockout-pasadena': {
    identity: 'Pasadena emergency and residential lockout specialist',
    notes: 'Pasadena-area residential lockout, rekeying, lock repair, deadbolt, smart-lock, and limited car-lockout assistance. Use only approved Pasadena-area coverage and neutral availability language.',
    automotiveScope: 'Vehicle entry and car lockout assistance only',
  },
  '724-locksmith-ca': {
    identity: 'North Hollywood, Burbank, and Studio City residential and commercial lock service',
    notes: 'North Hollywood, Burbank, and Studio City residential and commercial lock service with approved San Fernando Valley coverage. Automotive scope is vehicle entry and car lockout assistance only.',
    automotiveScope: 'Vehicle entry and car lockout assistance only',
  },
  'daniels-locksmith': {
    identity: 'Hollywood-area owner-operated rekeying, lock repair, deadbolt, and smart-lock service',
    notes: 'Hollywood-area owner-operated rekeying, residential lock repair, deadbolt, smart-lock, limited commercial, and car-lockout assistance. Pasadena, Sherman Oaks, and Burbank targeting remains held.',
    automotiveScope: 'One limited Hollywood car-lockout education topic; vehicle entry only',
  },
  'unlocked-pros': {
    identity: 'Pasadena commercial and property-management lock service',
    notes: 'Pasadena commercial and property-management lock service. Electronic-lock, access-control, offer, and location-specific claims remain held until their evidence and destination records are approved.',
    automotiveScope: 'Limited secondary car-lockout assistance; vehicle entry only',
  },
};

const restrictions = [
  'key copying', 'key duplication', 'duplicate keys', 'key cutting', 'car key replacement',
  'vehicle key replacement', 'remote key', 'coded key', 'digital key', 'key fob',
  'fob creation', 'key programming', 'reprogramming', 'transponder', 'chip key',
  'ignition repair', 'ignition replacement', 'motorcycle key', '20 minute arrival',
  '25 minute arrival', 'starting at $50', 'cheapest locksmith', 'lowest price',
  'nearly 500 reviews', '5.0 rating', 'guaranteed arrival', 'fastest locksmith',
];

const migration54 = [];
migration54.push('-- Portfolio intelligence reset generated from content-strategy-reset/*.csv.');
migration54.push(`UPDATE clients
SET owner_group = 'gabriel-locksmiths',
    owner_name = 'Gabriel Algrably',
    never_mix_with = '["247-lockout-pasadena","724-locksmith-ca","daniels-locksmith","unlocked-pros"]',
    profile_approval_status = 'approved',
    profile_approved_by = 'portfolio-reset',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug IN (${slugSql});`);
migration54.push(`UPDATE client_research_notes
SET review_status = 'quarantined', entity_match = 0, geography_match = 0, service_match = 0,
    prohibited_service_detected = 1, confidence = 'low', reviewed_by = 'portfolio-reset',
    reviewed_at = unixepoch(), notes = 'Quarantined during Gabriel portfolio reset; excluded from generation.', updated_at = unixepoch()
WHERE client_id IN (SELECT id FROM clients WHERE slug IN (${slugSql}));`);

for (const row of researchRows) {
  const researchJson = JSON.stringify({
    brand: row.brand_name,
    editorial_source: row.source_title,
    allowed_pillars: ['residential', 'commercial', 'automotive lockout assistance only'],
    prohibited_services: restrictions.slice(0, 18),
    note: row.notes,
  });
  migration54.push(`INSERT INTO client_research_notes
    (client_id, source, research_json, freshness_date, brand_name, source_url, source_domain, source_title,
     entity_match, geography_match, service_match, prohibited_service_detected, confidence, review_status,
     reviewed_by, reviewed_at, expires_at, notes)
  SELECT id, 'owner_editorial_policy', ${q(researchJson)}, '2026-08-06', ${q(row.brand_name)}, ${q(row.source_url)},
         ${q(row.source_domain)}, ${q(row.source_title)}, 1, 1, 1, 0, 'high', 'approved',
         'portfolio-reset', unixepoch('2026-08-06'), ${q(row.expires_at)}, ${q(row.notes)}
  FROM clients WHERE slug = ${q(row.brand_id)};`);
}

migration54.push(`UPDATE client_services
SET active = 0, approval_status = 'rejected', editorial_notes = 'Replaced by approved portfolio allowlist.', updated_at = unixepoch()
WHERE client_id IN (SELECT id FROM clients WHERE slug IN (${slugSql}));`);
migration54.push(`WITH service_data(slug, name, normalized_name, service_pillar, approval_status, editorial_notes, sort_order) AS (VALUES
${serviceRows.map((row, index) => `  ${tuple([row.brand_id, row.service, row.normalized_service, row.service_pillar, row.approval_status, row.editorial_notes, index])}`).join(',\n')}
)
INSERT INTO client_services
  (id, client_id, name, normalized_name, service_pillar, approval_status, approved_by, approved_at,
   editorial_notes, active, sort_order, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, d.name, d.normalized_name, d.service_pillar, d.approval_status,
       CASE WHEN d.approval_status = 'approved' THEN 'portfolio-reset' ELSE NULL END,
       CASE WHEN d.approval_status = 'approved' THEN unixepoch() ELSE NULL END,
       d.editorial_notes, CASE WHEN d.approval_status = 'approved' THEN 1 ELSE 0 END,
       d.sort_order, unixepoch(), unixepoch()
FROM service_data d JOIN clients c ON c.slug = d.slug;`);

migration54.push(`UPDATE client_service_areas
SET approval_status = 'rejected', editorial_notes = 'Replaced by approved portfolio area list.'
WHERE client_id IN (SELECT id FROM clients WHERE slug IN (${slugSql}));`);
const areaRows = Object.entries(serviceAreas).flatMap(([slug, areas]) => areas.map((area, index) => [slug, area, index]));
migration54.push(`WITH area_data(slug, city, sort_order) AS (VALUES
${areaRows.map((row) => `  ${tuple(row)}`).join(',\n')}
)
INSERT INTO client_service_areas
  (id, client_id, city, state, primary_area, sort_order, approval_status, approved_by, approved_at, editorial_notes, created_at)
SELECT lower(hex(randomblob(16))), c.id, d.city, 'CA', CASE WHEN d.sort_order = 0 THEN 1 ELSE 0 END,
       d.sort_order, 'approved', 'portfolio-reset', unixepoch(), 'Owner-directed approved coverage.', unixepoch()
FROM area_data d JOIN clients c ON c.slug = d.slug;`);

migration54.push(`UPDATE client_keywords
SET status = 'archived', approval_status = 'rejected', opportunity_notes = 'Replaced by curated portfolio keyword set.', updated_at = unixepoch()
WHERE client_id IN (SELECT id FROM clients WHERE slug IN (${slugSql}));`);
migration54.push(`WITH keyword_data(slug, keyword, normalized_keyword, intent, service_pillar, locality, brand_owner, confidence, source, approval_status, notes) AS (VALUES
${keywordRows.map((row) => `  ${tuple([row.brand_id, row.keyword, row.normalized_keyword, row.intent, row.service_pillar, row.location, row.brand_owner, row.confidence, row.source, row.approval_status, row.notes])}`).join(',\n')}
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
  updated_at = unixepoch();`);

for (const [slug, data] of Object.entries(intelligence)) {
  const keywords = keywordRows.filter((row) => row.brand_id === slug).map((row) => row.keyword);
  migration54.push(`INSERT INTO client_intelligence
    (client_id, brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals, service_priorities,
     content_angles, seasonal_notes, competitor_notes, audience_notes, primary_keyword, secondary_keywords,
     local_seo_themes, generation_language, humanization_style, feedback_summary, last_research_at, created_at, updated_at)
  SELECT id, ${q(data.voice)}, ${q(JSON.stringify(['calm', 'practical', 'educational', 'local']))},
         ${q(JSON.stringify(restrictions))}, ${q(JSON.stringify(['Call to confirm current availability, service coverage, and scheduling.']))},
         ${q(data.goals)}, ${q(JSON.stringify(data.services))}, ${q(JSON.stringify(data.angles))},
         'August topics must connect directly to an approved service.',
         'Sibling brands must remain distinct and portfolio duplicate cooldowns apply.', ${q(data.audience)},
         ${q(keywords[0])}, ${q(JSON.stringify(keywords.slice(1)))}, ${q(JSON.stringify(serviceAreas[slug]))},
         'en', 'clear and human', 'Use only approved source records; preserve rejected-topic memory.', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = ${q(slug)}
  ON CONFLICT(client_id) DO UPDATE SET
    brand_voice = excluded.brand_voice, tone_keywords = excluded.tone_keywords,
    prohibited_terms = excluded.prohibited_terms, approved_ctas = excluded.approved_ctas,
    content_goals = excluded.content_goals, service_priorities = excluded.service_priorities,
    content_angles = excluded.content_angles, seasonal_notes = excluded.seasonal_notes,
    competitor_notes = excluded.competitor_notes, audience_notes = excluded.audience_notes,
    primary_keyword = excluded.primary_keyword, secondary_keywords = excluded.secondary_keywords,
    local_seo_themes = excluded.local_seo_themes, generation_language = excluded.generation_language,
    humanization_style = excluded.humanization_style, feedback_summary = excluded.feedback_summary,
    last_research_at = excluded.last_research_at, updated_at = unixepoch();`);
}

migration54.push(`WITH restricted(term) AS (VALUES
${restrictions.map((term) => `  (${q(term)})`).join(',\n')}
)
INSERT OR IGNORE INTO client_restrictions (client_id, term)
SELECT c.id, r.term FROM clients c CROSS JOIN restricted r WHERE c.slug IN (${slugSql});`);

migration54.push(`UPDATE client_strategy_plans
SET status = 'archived', updated_at = unixepoch()
WHERE client_id IN (SELECT id FROM clients WHERE slug IN (${slugSql}))
  AND period_start <= '2026-08-31' AND period_end >= '2026-08-01';`);
for (const [slug, strategy] of Object.entries(strategies)) {
  migration54.push(`INSERT INTO client_strategy_plans
    (client_id, period_start, period_end, strategy_json, status, created_at, updated_at)
  SELECT id, '2026-08-01', '2026-08-31', ${q(JSON.stringify({ ...strategy, policy: 'content-strategy-reset/01-global-editorial-policy.md' }))},
         'approved', unixepoch(), unixepoch() FROM clients WHERE slug = ${q(slug)};`);
}

for (const slug of portfolioSlugs) {
  const strategy = strategies[slug];
  migration54.push(`INSERT INTO client_monthly_content_plans
    (client_id, plan_month, monthly_focus, promotion_notes, priority_services, notes, created_by,
     status, expected_slots, approved_by, approved_at, created_at, updated_at)
  SELECT id, '2026-08', ${q(strategy.identity)}, 'No offer may generate until approved_offer_terms is approved.',
         ${q(JSON.stringify(intelligence[slug].services))}, ${q(strategy.mix)}, 'portfolio-reset',
         'approved', 26, 'portfolio-reset', unixepoch(), unixepoch(), unixepoch()
  FROM clients WHERE slug = ${q(slug)}
  ON CONFLICT(client_id, plan_month) DO UPDATE SET
    monthly_focus = excluded.monthly_focus, promotion_notes = excluded.promotion_notes,
    priority_services = excluded.priority_services, notes = excluded.notes, created_by = excluded.created_by,
    status = 'approved', expected_slots = 26, approved_by = 'portfolio-reset',
    approved_at = unixepoch(), updated_at = unixepoch();`);
}

for (const row of claimRows) {
  migration54.push(`INSERT INTO client_approved_claims
    (client_id, claim_key, claim_text, claim_category, evidence_url, evidence_notes, review_status,
     reviewed_by, reviewed_at, expires_at, notes, created_at, updated_at)
  SELECT id, ${q(row.claim_key)}, ${q(row.claim_text)}, ${q(row.claim_category)}, ${q(row.evidence_url)},
         ${q(row.evidence_notes)}, ${q(row.review_status)}, ${q(row.reviewed_by)},
         ${row.reviewed_at ? `unixepoch(${q(row.reviewed_at)})` : 'NULL'}, ${q(row.expires_at)}, ${q(row.notes)}, unixepoch(), unixepoch()
  FROM clients WHERE slug = ${q(row.brand_id)}
  ON CONFLICT(client_id, claim_key) DO UPDATE SET
    claim_text = excluded.claim_text, claim_category = excluded.claim_category,
    evidence_url = excluded.evidence_url, evidence_notes = excluded.evidence_notes,
    review_status = excluded.review_status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
    notes = excluded.notes, updated_at = unixepoch();`);
}

migration54.push(`UPDATE client_platforms
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
WHERE client_id IN (SELECT id FROM clients WHERE slug IN (${slugSql}));`);
migration54.push(`UPDATE client_platforms
SET verified_market = CASE
      WHEN client_id = (SELECT id FROM clients WHERE slug = '247-lockout-pasadena') THEN 'Pasadena'
      WHEN client_id = (SELECT id FROM clients WHERE slug = '724-locksmith-ca') THEN 'North Hollywood'
      ELSE verified_market
    END
WHERE platform = 'google_business'
  AND client_id IN (SELECT id FROM clients WHERE slug IN ('247-lockout-pasadena', '724-locksmith-ca'));`);
migration54.push(`UPDATE client_platforms SET upload_post_board_id = '1129981431446007095', verification_status = 'verified', verified_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = '724-locksmith-ca') AND platform = 'pinterest';`);
migration54.push(`UPDATE client_platforms
SET username = 'accounts_112906754238408611175', upload_post_location_id = 'locations/908727413318428834',
    provider_destination_id = 'locations/908727413318428834', connection_status = 'connected',
    verification_status = 'pending_identity', verified_business_name = NULL, verified_phone = NULL,
    verified_market = 'Hollywood', verified_at = NULL,
    verification_notes = 'Canonical live ID replaced stale mapping; identity check still required.'
WHERE client_id = (SELECT id FROM clients WHERE slug = 'daniels-locksmith') AND platform = 'google_business';`);
migration54.push(`UPDATE client_platforms
SET verification_status = 'pending_identity', verified_business_name = NULL, verified_phone = NULL,
    verified_market = 'Pasadena', verified_at = NULL,
    verification_notes = 'Two live profiles require distinct identity approval before GBP publishing.'
WHERE client_id = (SELECT id FROM clients WHERE slug = 'unlocked-pros') AND platform = 'google_business';`);
migration54.push(`UPDATE client_gbp_locations
SET label = CASE upload_post_profile WHEN 'UnlockD_Pros' THEN 'Pasadena Primary' ELSE 'Pasadena Secondary' END,
    verification_status = 'pending_identity', verified_business_name = NULL, verified_phone = NULL,
    verified_address = NULL, verified_market = 'Pasadena', verified_at = NULL,
    verification_notes = 'Profile-specific business name phone address and market must be verified live.'
WHERE client_id = (SELECT id FROM clients WHERE slug = 'unlocked-pros');`);

const migration55 = [];
migration55.push('-- Exactly 26 approved August core slots per Gabriel locksmith brand.');
migration55.push(`DELETE FROM client_monthly_topics
WHERE plan_month = '2026-08' AND client_id IN (SELECT id FROM clients WHERE slug IN (${slugSql}));`);
migration55.push(`WITH topic_data(
  slug, slot_number, content_pillar, topic_title, working_title, primary_service, primary_area,
  target_keyword, supporting_keywords, format, content_type, preferred_platforms, offer_or_event,
  image_requirement, proof_requirement, claim_requirement, approval_status
) AS (VALUES
${topicRows.map((row) => `  ${tuple([
    row.brand_id,
    row.slot_number,
    row.content_pillar,
    row.topic,
    row.working_title,
    row.primary_service,
    row.primary_area,
    row.primary_keyword,
    JSON.stringify(row.supporting_keywords.split('|').filter(Boolean)),
    row.format,
    row.package_content_type,
    JSON.stringify(row.platforms.split('|').filter(Boolean)),
    row.offer_or_event,
    row.image_requirement,
    row.proof_requirement,
    row.claim_requirement,
    row.status,
  ])}`).join(',\n')}
)
INSERT INTO client_monthly_topics
  (client_id, plan_month, plan_id, slot_number, content_pillar, topic_title, working_title,
   service_category, primary_service, primary_area, target_keyword, supporting_keywords, format,
   content_type_preference, preferred_platforms, offer_or_event, image_requirement, proof_requirement,
   claim_requirement, priority, status, approval_status, approved_by, approved_at, notes, created_by,
   created_at, updated_at)
SELECT c.id, '2026-08', p.id, CAST(d.slot_number AS INTEGER), d.content_pillar, d.topic_title,
       d.working_title, d.primary_service, d.primary_service, d.primary_area, d.target_keyword,
       d.supporting_keywords, d.format, d.content_type, d.preferred_platforms, d.offer_or_event,
       d.image_requirement, d.proof_requirement, d.claim_requirement,
       100 - CAST(d.slot_number AS INTEGER), 'approved', d.approval_status,
       'portfolio-reset', unixepoch(), 'Owner-directed August portfolio plan.', 'portfolio-reset',
       unixepoch(), unixepoch()
FROM topic_data d
JOIN clients c ON c.slug = d.slug
JOIN client_monthly_content_plans p ON p.client_id = c.id AND p.plan_month = '2026-08';`);

const neutralCta = 'Call to confirm current availability, service coverage, and scheduling.';
const migration57 = ['-- Replace stale locksmith profile narratives with the approved portfolio profiles.'];
for (const [slug, profile] of Object.entries(approvedProfiles)) {
  const brandJson = JSON.stringify({
    editorial_identity: profile.identity,
    approved_service_pillars: ['residential', 'commercial', 'automotive lockout assistance only'],
    approved_areas: serviceAreas[slug],
    approved_services: intelligence[slug].services,
    automotive_scope: profile.automotiveScope,
    prohibited_services: restrictions.slice(0, 18),
    claims_policy: 'Use only approved claims. Otherwise use the neutral approved CTA.',
    profile_source: 'owner-locksmith-policy-2026-08-06',
  });
  migration57.push(`UPDATE clients
SET notes = ${q(profile.notes)},
    brand_json = ${q(brandJson)},
    cta_text = ${q(neutralCta)},
    cta_label = 'Call to confirm',
    profile_approval_status = 'approved',
    profile_approved_by = 'portfolio-reset',
    profile_approved_at = unixepoch(),
    updated_at = unixepoch()
WHERE slug = ${q(slug)};`);
}

writeFileSync(resolve(migrationDir, '0054_gabriel_locksmith_portfolio_reset.sql'), `${migration54.join('\n\n')}\n`);
writeFileSync(resolve(migrationDir, '0055_gabriel_locksmith_august_topics.sql'), `${migration55.join('\n\n')}\n`);
writeFileSync(resolve(migrationDir, '0057_gabriel_locksmith_profile_cleanup.sql'), `${migration57.join('\n\n')}\n`);
console.log(`Generated migrations 0054 (${serviceRows.length} services, ${keywordRows.length} keywords), 0055 (${topicRows.length} topics), and 0057 (approved profiles).`);
