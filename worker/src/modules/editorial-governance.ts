import type { ClientRow, PostRow } from '../types';
import {
  getEditorialGateSnapshot,
  getClientGenerationServiceAreas,
  getClientGenerationServices,
  getClientKeywords,
  listApprovedClientClaims,
  listApprovedPortfolioTopics,
  listPortfolioRecentTopicReferences,
  listClientsByOwnerGroup,
} from '../db/queries';

export const LOCKSMITH_OWNER_GROUP = 'gabriel-locksmiths';
export const LOCKSMITH_PORTFOLIO_SLUGS = [
  '247-lockout-pasadena',
  '724-locksmith-ca',
  'daniels-locksmith',
  'unlocked-pros',
] as const;

const LOCKSMITH_BRAND_ALIASES: Record<string, string[]> = {
  '247-lockout-pasadena': ['24/7 Lockout'],
  '724-locksmith-ca': ['7/24 Locksmith', '724 Locksmith'],
  'daniels-locksmith': ["Daniel's Locks & Key", 'Daniels Locks & Key'],
  'unlocked-pros': ["Unlock'D Pros", 'Unlocked Pros'],
};

const LOCKSMITH_LOCATION_TERMS = [
  'Pasadena', 'South Pasadena', 'Altadena', 'San Marino', 'Arcadia', 'Sierra Madre',
  'North Hollywood', 'Burbank', 'Studio City', 'Valley Village', 'Valley Glen',
  'Sherman Oaks', 'Van Nuys', 'Glendale', 'Encino', 'Tarzana', 'Hollywood',
  'Los Angeles', 'Virginia', 'Canada', 'Toronto',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PROHIBITED_SERVICE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'key copying or duplication', pattern: /\b(?:copy|copying|copied|duplicate|duplication)\b.{0,24}\bkeys?\b|\bkeys?\b.{0,24}\b(?:copy|copying|copied|duplicate|duplication)\b/i },
  { label: 'key cutting', pattern: /\bkey\s*cut(?:ting)?\b/i },
  { label: 'automotive key service', pattern: /\b(?:car|vehicle|automotive|motorcycle)\s+keys?\b|\bkeys?\s+(?:for\s+)?(?:cars?|vehicles?|motorcycles?)\b/i },
  { label: 'remote or coded key', pattern: /\b(?:remote|coded|digital)\s*[- ]?keys?\b/i },
  { label: 'key fob', pattern: /\b(?:key\s*)?fobs?\b/i },
  { label: 'key programming', pattern: /\b(?:key|remote|fob|transponder|chip)\b.{0,24}\b(?:programming|reprogramming|creation)\b|\b(?:programming|reprogramming)\b.{0,24}\b(?:key|remote|fob|transponder|chip)\b/i },
  { label: 'transponder or chip key', pattern: /\btransponder\b|\bchip\s*keys?\b/i },
  { label: 'ignition service', pattern: /\bignitions?\b/i },
];

const PROHIBITED_CLAIM_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'exact arrival-time claim', pattern: /\b(?:arriv(?:e|al)|there|response)\b.{0,24}\b\d{1,3}\s*(?:-|–|to)?\s*\d{0,3}\s*minutes?\b|\bin\s+minutes\b/i },
  { label: 'starting-price claim', pattern: /\b(?:starting|starts|from)\s+(?:at\s+)?\$\s*\d+/i },
  { label: 'price superlative', pattern: /\b(?:cheapest|lowest price|most affordable)\b/i },
  { label: 'rating or review-count claim', pattern: /\b\d(?:\.\d)?\s*[- ]?stars?\b|\b\d{2,}\+?\s+reviews?\b|\bnearly\s+\d+\s+reviews?\b/i },
  { label: 'availability claim', pattern: /\b24\s*\/\s*7\s+(?:availability|available|service|support|help)\b|\bavailable\s+24\s*\/\s*7\b/i },
  { label: 'credential claim', pattern: /\b(?:licensed|insured|bonded|bbb accredited|certified)\b/i },
  { label: 'experience-duration claim', pattern: /\b\d+\+?\s+years?\s+(?:of\s+)?experience\b/i },
  { label: 'unsupported superlative or guarantee', pattern: /\b(?:best|top-rated|number one|#1|fastest|guaranteed|guarantee)\b/i },
];

export interface EditorialGateResult {
  ready: boolean;
  reasons: string[];
  checks: {
    brand_profile_approved: boolean;
    strategy_approved: boolean;
    topic_plan_approved: boolean;
    topic_slot_count: number;
    services_approved: boolean;
    locations_approved: boolean;
    keywords_approved: boolean;
    keyword_count: number;
    destination_verified: boolean;
    research_safe: boolean;
    claims_safe: boolean;
  };
}

export function isGovernedLocksmith(client: Pick<ClientRow, 'owner_group' | 'slug'>): boolean {
  return client.owner_group === LOCKSMITH_OWNER_GROUP
    || LOCKSMITH_PORTFOLIO_SLUGS.includes(client.slug as typeof LOCKSMITH_PORTFOLIO_SLUGS[number]);
}

const LOCKSMITH_APPROVED_PROFILE_FIELDS = new Set<keyof ClientRow>([
  'canonical_name',
  'language',
  'notes',
  'brand_json',
  'phone',
  'email',
  'owner_name',
  'cta_text',
  'cta_label',
  'industry',
  'state',
]);

export function locksmithProfileRequiresReapproval(
  client: ClientRow,
  updates: Record<string, unknown>,
): boolean {
  if (!isGovernedLocksmith(client)) return false;
  return Object.entries(updates).some(([field, nextValue]) => {
    if (!LOCKSMITH_APPROVED_PROFILE_FIELDS.has(field as keyof ClientRow)) return false;
    const currentValue = client[field as keyof ClientRow];
    return String(nextValue ?? '').trim() !== String(currentValue ?? '').trim();
  });
}

export function findProhibitedLocksmithService(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return PROHIBITED_SERVICE_PATTERNS.find((entry) => entry.pattern.test(text))?.label ?? null;
}

export function findUnapprovedLocksmithClaim(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return PROHIBITED_CLAIM_PATTERNS.find((entry) => entry.pattern.test(text))?.label ?? null;
}

function monthBounds(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export async function evaluateLocksmithGenerationGate(
  db: D1Database,
  clientId: string,
  month: string,
): Promise<EditorialGateResult> {
  const bounds = monthBounds(month);
  const [snapshot, approvedServices, keywordRows] = await Promise.all([
    getEditorialGateSnapshot(db, clientId, month, bounds.start, bounds.end),
    getClientGenerationServices(db, clientId, true, 100),
    getClientKeywords(db, clientId),
  ]);

  const expectedSlots = snapshot.plan?.expected_slots ?? 26;
  const topicSlotCount = snapshot.topics.approved;
  const keywordCount = snapshot.keywords.approved;
  const checks = {
    brand_profile_approved: snapshot.client?.profile_approval_status === 'approved',
    strategy_approved: snapshot.strategyApproved,
    topic_plan_approved: snapshot.plan?.status === 'approved' && expectedSlots === 26 && topicSlotCount === 26 && snapshot.topics.total === 26,
    topic_slot_count: topicSlotCount,
    services_approved: snapshot.services.total > 0
      && snapshot.services.total === snapshot.services.approved
      && approvedServices.every((service) => !findProhibitedLocksmithService(service.name)),
    locations_approved: snapshot.serviceAreas.approved > 0 && snapshot.serviceAreas.pending === 0,
    keywords_approved: keywordCount >= 20
      && keywordCount <= 35
      && snapshot.keywords.total === snapshot.keywords.approved
      && keywordRows.filter((keyword) => keyword.status === 'active')
        .every((keyword) => !findProhibitedLocksmithService(keyword.keyword)),
    keyword_count: keywordCount,
    destination_verified: snapshot.platforms.total > 0
      && snapshot.platforms.total === snapshot.platforms.verified
      && (snapshot.locations.total === 0 || snapshot.locations.total === snapshot.locations.verified),
    research_safe: snapshot.research.pending === 0,
    claims_safe: snapshot.missingRequiredClaims === 0,
  };
  const reasons: string[] = [];
  const slug = snapshot.client?.slug ?? clientId;
  if (!checks.brand_profile_approved) reasons.push(`${slug}: brand profile is not approved`);
  if (!checks.strategy_approved) reasons.push(`${slug}: no approved monthly strategy`);
  if (!checks.topic_plan_approved) reasons.push(`${slug}: approved monthly topic plan must contain exactly 26 slots`);
  if (!checks.services_approved) reasons.push(`${slug}: active services are not fully approved`);
  if (!checks.locations_approved) reasons.push(`${slug}: service areas are not fully approved`);
  if (!checks.keywords_approved) reasons.push(`${slug}: approved keyword set must contain 20-35 terms`);
  if (!checks.destination_verified) reasons.push(`${slug}: one or more destinations are not verified`);
  if (!checks.research_safe) reasons.push(`${slug}: research is pending review`);
  if (!checks.claims_safe) reasons.push(`${slug}: one or more topic claims lack approval`);
  return { ready: reasons.length === 0, reasons, checks };
}

function normalizeTopic(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((token) => token && !['a', 'an', 'and', 'for', 'in', 'of', 'the', 'to', 'with'].includes(token))
    .join(' ');
}

function topicSimilarity(left: string, right: string): number {
  const a = new Set(normalizeTopic(left).split(' ').filter(Boolean));
  const b = new Set(normalizeTopic(right).split(' ').filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return overlap / Math.max(a.size, b.size);
}

function stripApprovedLocationMentions(text: string, approvedAreas: string[]): string {
  let remaining = text;
  const longestFirst = [...approvedAreas]
    .filter((area) => area.trim())
    .sort((a, b) => b.length - a.length);
  for (const area of longestFirst) {
    remaining = remaining.replace(new RegExp(`\\b${escapeRegExp(area)}\\b`, 'gi'), ' ');
  }
  return remaining;
}

export async function getLocksmithPortfolioTopicCollision(db: D1Database, month: string): Promise<string | null> {
  const [rows, references] = await Promise.all([
    listApprovedPortfolioTopics(db, LOCKSMITH_OWNER_GROUP, month),
    listPortfolioRecentTopicReferences(db, LOCKSMITH_OWNER_GROUP, month),
  ]);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const left = rows[i];
      const right = rows[j];
      const exact = normalizeTopic(left.title) === normalizeTopic(right.title);
      const sameCombination = normalizeTopic(left.primary_service) === normalizeTopic(right.primary_service)
        && normalizeTopic(left.primary_area) === normalizeTopic(right.primary_area)
        && normalizeTopic(left.content_pillar) === normalizeTopic(right.content_pillar)
        && topicSimilarity(left.title, right.title) >= 0.45;
      if (exact || sameCombination || topicSimilarity(left.title, right.title) >= 0.78) {
        return `${left.slug}/${left.id} collides with ${right.slug}/${right.id}`;
      }
    }
  }
  for (const topic of rows) {
    for (const reference of references) {
      if (reference.source === 'post' && reference.monthly_topic_id === topic.id) continue;
      const topicTitle = normalizeTopic(topic.title);
      const referenceTitle = normalizeTopic(reference.title);
      const exactOrEmbedded = topicTitle === referenceTitle
        || (reference.source === 'rejected_feedback' && referenceTitle.includes(topicTitle));
      const sameCombination = Boolean(topic.primary_service && topic.primary_area)
        && normalizeTopic(topic.primary_service) === normalizeTopic(reference.primary_service)
        && normalizeTopic(topic.primary_area) === normalizeTopic(reference.primary_area)
        && topicSimilarity(topic.title, reference.title) >= 0.55;
      if (exactOrEmbedded || sameCombination || topicSimilarity(topic.title, reference.title) >= 0.78) {
        return `${topic.slug}/${topic.id} collides with ${reference.source} ${reference.slug}/${reference.id}`;
      }
    }
  }
  return null;
}

export async function assertLocksmithPortfolioGenerationReady(
  db: D1Database,
  clients: ClientRow[],
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  if (!clients.some(isGovernedLocksmith)) return;
  const portfolio = await listClientsByOwnerGroup(db, LOCKSMITH_OWNER_GROUP);
  const months = new Set([periodStart.slice(0, 7), periodEnd.slice(0, 7)]);
  const reasons: string[] = [];
  for (const month of months) {
    for (const client of portfolio) {
      const result = await evaluateLocksmithGenerationGate(db, client.id, month);
      reasons.push(...result.reasons);
    }
    const collision = await getLocksmithPortfolioTopicCollision(db, month);
    if (collision) reasons.push(`portfolio topic collision: ${collision}`);
  }
  if (portfolio.length !== LOCKSMITH_PORTFOLIO_SLUGS.length) {
    reasons.push(`portfolio owner group must contain ${LOCKSMITH_PORTFOLIO_SLUGS.length} active brands`);
  }
  if (reasons.length > 0) throw new Error(`Generation blocked: ${reasons.join('; ')}`);
}

// A single post only needs the destinations it actually selects. Keep the
// portfolio-wide profile/topic protections, but do not let a disconnected GBP
// destination block an independently verified social-only draft (or vice versa).
// Posting preflight calls this same gate again, so the scope cannot be widened
// after review without being revalidated.
export async function assertLocksmithContentReady(
  db: D1Database,
  client: ClientRow,
  publishDay: string,
  selectedPlatforms: string[],
): Promise<void> {
  if (!isGovernedLocksmith(client)) return;
  const month = publishDay.slice(0, 7);
  const gate = await evaluateLocksmithGenerationGate(db, client.id, month);
  const reasons = gate.reasons.filter((reason) => !reason.includes('one or more destinations are not verified'));
  const normalized = [...new Set(selectedPlatforms
    .map((platform) => platform.toLowerCase().replace(/[ -]+/g, '_'))
    .map((platform) => ['gbp', 'gbp_la', 'gbp_wa', 'gbp_or', 'google_business_profile'].includes(platform) ? 'google_business' : platform)
    .filter((platform) => platform && platform !== 'website_blog'))];
  if (normalized.length > 0) {
    const placeholders = normalized.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT platform, connection_status, verification_status, paused
                                   FROM client_platforms
                                   WHERE client_id = ? AND platform IN (${placeholders})`)
      .bind(client.id, ...normalized).all<{ platform: string; connection_status: string | null; verification_status: string | null; paused: number }>();
    const byPlatform = new Map(rows.results.map((row) => [row.platform, row]));
    const invalid = normalized.filter((platform) => {
      const row = byPlatform.get(platform);
      return !row || row.paused === 1 || row.connection_status !== 'connected' || row.verification_status !== 'verified';
    });
    if (invalid.length > 0) reasons.push(`${client.slug}: selected destinations are not verified: ${invalid.join(', ')}`);
  }
  const collision = await getLocksmithPortfolioTopicCollision(db, month);
  if (collision) reasons.push(`portfolio topic collision: ${collision}`);
  if (reasons.length > 0) throw new Error(`Generation blocked: ${reasons.join('; ')}`);
}

export async function validateLocksmithGeneratedContent(
  db: D1Database,
  client: ClientRow,
  post: Partial<PostRow>,
): Promise<string[]> {
  if (!isGovernedLocksmith(client)) return [];
  const text = [
    post.title,
    post.master_caption,
    post.cap_facebook,
    post.cap_instagram,
    post.cap_linkedin,
    post.cap_x,
    post.cap_threads,
    post.cap_tiktok,
    post.cap_pinterest,
    post.cap_bluesky,
    post.cap_google_business,
    post.cap_gbp_la,
    post.cap_gbp_wa,
    post.cap_gbp_or,
    post.youtube_title,
    post.youtube_description,
    post.blog_content,
    post.blog_excerpt,
    post.seo_title,
    post.meta_description,
    post.video_script,
  ].filter(Boolean).join('\n');
  const issues: string[] = [];
  const serviceViolation = findProhibitedLocksmithService(text);
  if (serviceViolation) issues.push(`prohibited service: ${serviceViolation}`);
  const claimViolation = findUnapprovedLocksmithClaim(text);
  if (claimViolation) {
    const approvedClaims = await listApprovedClientClaims(db, client.id);
    const lowerText = text.toLowerCase();
    const hasApprovedEvidence = approvedClaims.some((claim) => {
      const normalizedClaim = claim.trim().toLowerCase();
      return normalizedClaim
        && findUnapprovedLocksmithClaim(claim) === claimViolation
        && lowerText.includes(normalizedClaim);
    });
    if (!hasApprovedEvidence) {
      issues.push(`unapproved claim: ${claimViolation}`);
    }
  }
  const visualPrompt = [post.ai_image_prompt, post.ai_video_prompt].filter(Boolean).join('\n');
  if (
    findProhibitedLocksmithService(visualPrompt)
    && !/\b(?:avoid|exclude|without|do not (?:show|include)|no mostrar|no incluir|evitar|sin)\b/i.test(visualPrompt)
  ) {
    issues.push('design prompt depicts or promotes a prohibited service');
  }

  for (const [slug, aliases] of Object.entries(LOCKSMITH_BRAND_ALIASES)) {
    if (slug === client.slug) continue;
    const sibling = aliases.find((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i').test(text));
    if (sibling) issues.push(`wrong brand: ${sibling}`);
  }

  const approvedAreas = await getClientGenerationServiceAreas(db, client.id, true, 100);
  const approvedAreaNames = approvedAreas.map((area) => area.city).filter(Boolean);
  const approvedAreaSet = new Set(approvedAreaNames.map((area) => normalizeTopic(area)));
  const textWithoutApprovedAreas = stripApprovedLocationMentions(text, approvedAreaNames);
  const wrongLocation = LOCKSMITH_LOCATION_TERMS.find((location) => {
    if (approvedAreaSet.has(normalizeTopic(location))) return false;
    return new RegExp(`\\b${escapeRegExp(location)}\\b`, 'i').test(textWithoutApprovedAreas);
  });
  if (wrongLocation) issues.push(`wrong or unapproved location: ${wrongLocation}`);

  const expectedPhone = String(client.phone ?? '').replace(/\D/g, '').slice(-10);
  const phoneMatches = [...text.matchAll(/(?:\+?\d[\d().\-\s]{7,}\d)/g)]
    .map((match) => match[0].replace(/\D/g, '').slice(-10))
    .filter((digits) => digits.length === 10);
  if ((expectedPhone && phoneMatches.some((digits) => digits !== expectedPhone)) || text.includes('((')) {
    issues.push('invalid or mismatched phone');
  }
  return issues;
}
