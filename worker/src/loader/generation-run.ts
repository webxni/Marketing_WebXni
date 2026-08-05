/**
 * AI content generation — sequential chained-invocation architecture.
 *
 * Root problem: after a long-running outbound fetch (OpenAI ~20s) inside a
 * CF Workers waitUntil() context, the V8 event loop freezes.  Any subsequent
 * await — including SELF service-binding calls — never resolves.
 *
 * Fix: each /internal/gen-step request handler executes exactly ONE slot in the
 * request itself, then queues the NEXT step via waitUntil() only after the
 * slot finishes. The queued waitUntil task performs only the quick self-fetch
 * hop, so the fragile "dispatch after OpenAI inside waitUntil" path is gone.
 *
 * Flow:
 *   POST /api/run/generate
 *     → planGeneration()              [DB reads + writes, computes slots]
 *     → triggerStep(slot 0)           [SELF.fetch — first connection, reliable]
 *         ↓ /internal/gen-step
 *         ↓ /internal/gen-step
 *         executeSlotWork(slot 0)      [OpenAI + D1 writes]
 *         waitUntil: triggerStep(slot 1) [quick self-dispatch only]
 *             ↓ /internal/gen-step
 *             executeSlotWork(slot 1)
 *             waitUntil: triggerStep(slot 2)
 *                 ...
 */

import type { ClientRow, Env, PostRow } from '../types';
import {
  buildWeeklyMarketingStrategicContext,
  buildAutonomousResearchSignals,
  type ClientGenerationTopicHistoryItem,
} from '../agent/context';
import {
  listClients,
  getClientPlatforms,
  getClientGbpLocations,
  createPost,
  findRecentTopicConflict,
  updatePost,
  getPostByAutomationSlot,
  getClientMonthlyContentPlan,
  listClientMonthlyTopics,
  updateGenerationProgress,
  appendGenerationLog,
  appendGenerationError,
  markClientMonthlyTopicUsed,
  markClientMonthlyTopicSkipped,
  storeGenerationPlan,
  finalizeGenerationRun,
  getGenerationRunById,
  createApprovedCommandJob,
  getClientGenerationTopicHistory,
  getLatestClientResearch,
  getLatestClientStrategy,
  getClientKeywords,
  getClientRestrictions,
  getClientProfileCompleteness,
  reclassifyActiveClientKeywords,
  type GenerationProgress,
  buildTopicFingerprint,
  createGenerationRun,
} from '../db/queries';
import {
  buildGenerationRequest,
  validateGeneratedContent,
  detectFormatFromTitle,
  buildBlogContentHtml,
  canonicalizeGeneratedPhoneNumbers,
  findRestrictedContentPhrase,
  isGeneratedCaptionField,
  normalizeGeneratedCaptionValue,
  type GenerationContext,
  type ContentFormat,
  type GeneratedPost,
  type TopicResearch,
} from '../services/openai';
import {
  generateWithProvider,
  getProviderDisplayName,
  isTerminalContentProvider,
  normalizeContentProvider,
  researchTopicWithProvider,
  resolveProviderApiKey,
  type ContentProviderName,
} from '../services/content-provider';
import { discordSend, DISCORD_COLORS } from '../services/discord';
import {
  getAutomationSlotKey,
  getGbpCaptionField,
  isPostContentComplete,
  normalizeContentType,
  parsePlatforms,
  resolvePlatformSelection,
  withImplicitBlogPlatform,
  withImplicitGbpPlatform,
} from '../modules/platform-compatibility';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerationParams {
  run_id:       string;
  client_slugs: string[];
  period_start: string;
  period_end:   string;
  triggered_by: string;
  publish_time: string | null;
  overwrite_existing?: boolean;
  high_quality?: boolean;
  provider?: ContentProviderName;
}

interface PostSlot {
  client_id:      string;
  client_slug:    string;
  date:           string;
  content_type:   string;
  content_intent: 'educational' | 'sales';
  slot_key:       string;
  high_quality?:  boolean;
  provider?:      ContentProviderName;
}

export interface SlotGenerationRequest {
  runId: string;
  slotIdx: number;
  slot: PostSlot;
  clientName: string;
  provider: ContentProviderName;
  request: ReturnType<typeof buildGenerationRequest>;
  topicSelection: SlotTopicSelection;
}

export interface PreparedApprovedSlotRequest {
  slot_idx: number;
  client_slug: string;
  client_name: string;
  publish_date: string;
  content_type: string;
  topic_selection: SlotTopicSelection;
  prompt: string;
  schema: ReturnType<typeof buildGenerationRequest>['schema']['schema'];
  plan: ReturnType<typeof buildGenerationRequest>['plan'];
}

export interface SlotTopicSelection {
  monthlyTopicId: string | null;
  topicTitle: string | null;
  targetKeyword: string | null;
  targetLocality: string | null;
  serviceCategory: string | null;
  topicFingerprint: string | null;
  notes?: string | null;
  source: 'monthly_approved' | 'monthly_planned' | 'research';
}

interface PackageRow {
  id:                   string;
  slug:                 string;
  posting_days:         string | null;
  weekly_schedule:      string | null;
  posts_per_month?:     number | null;
  images_per_month:     number;
  videos_per_month:     number;
  reels_per_month:      number;
  blog_posts_per_month: number;
  platforms_included:   string;
  posting_frequency:    string;
}

interface IntelRow {
  brand_voice?:        string | null;
  tone_keywords?:      string | null;
  prohibited_terms?:   string | null;
  approved_ctas?:      string | null;
  content_goals?:      string | null;
  service_priorities?: string | null;
  content_angles?:     string | null;
  seasonal_notes?:     string | null;
  audience_notes?:     string | null;
  primary_keyword?:    string | null;
  secondary_keywords?: string | null;
  local_seo_themes?:   string | null;
  humanization_style?: string | null;
}

interface FeedbackRow { sentiment: string; note: string; }

interface ClientKeywordLite {
  keyword: string;
  kw_type: string;
  locality: string | null;
}

function applyMonthlyPlanToIntelligence(
  intel: IntelRow | null,
  plan: { monthly_focus?: string | null; promotion_notes?: string | null; priority_services?: string | null; notes?: string | null } | null,
): IntelRow | null {
  if (!intel && !plan) return null;
  const next = { ...(intel ?? {}) };
  const monthlyNotes = [plan?.monthly_focus, plan?.promotion_notes, plan?.notes].filter(Boolean).join(' | ');
  if (monthlyNotes) next.seasonal_notes = [next.seasonal_notes, monthlyNotes].filter(Boolean).join(' | ');
  if (plan?.priority_services) next.service_priorities = [plan.priority_services, next.service_priorities].filter(Boolean).join(' | ');
  return next;
}

function mapTopicHistoryForContext(rows: ClientGenerationTopicHistoryItem[]): ClientGenerationTopicHistoryItem[] {
  return rows.map((row) => ({
    title: row.title,
    target_keyword: row.target_keyword,
    content_type: row.content_type,
    publish_date: row.publish_date,
    platforms: row.platforms,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PACKAGE: PackageRow = {
  id: '', slug: 'default',
  posting_days:         '["monday","wednesday","friday"]',
  weekly_schedule:      null,
  images_per_month:     6,
  videos_per_month:     1,
  reels_per_month:      1,
  blog_posts_per_month: 0,
  platforms_included:   '["facebook","instagram"]',
  posting_frequency:    'weekly',
};

const DAY_NAME_TO_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};
const DAY_NUM_TO_NAME = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

interface PackageSlotCandidate {
  date: string;
  contentType: string;
  dailyIndex: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date / schedule helpers
// ─────────────────────────────────────────────────────────────────────────────

function getDayName(dateStr: string): string {
  return DAY_NUM_TO_NAME[new Date(dateStr + 'T12:00:00Z').getUTCDay()];
}

function parseWeeklySchedule(raw: string | null): Record<string, string[]> | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as unknown;
    if (typeof p === 'object' && p !== null && !Array.isArray(p))
      return p as Record<string, string[]>;
  } catch { /* */ }
  return null;
}

function parsePostingDays(raw: string | null): number[] {
  if (!raw) return [1, 3];
  try {
    const names: string[] = JSON.parse(raw);
    const nums = names.map(n => DAY_NAME_TO_NUM[n.toLowerCase()]).filter(n => n !== undefined).sort((a, b) => a - b);
    return nums.length > 0 ? nums : [1, 3];
  } catch { return [1, 3]; }
}

function buildContentSequence(pkg: PackageRow): string[] {
  const img  = pkg.images_per_month     ?? 0;
  const vid  = pkg.videos_per_month     ?? 0;
  const reel = pkg.reels_per_month      ?? 0;
  const blog = pkg.blog_posts_per_month ?? 0;
  const total = img + vid + reel + blog;
  if (total === 0) return ['image'];

  const positioned: { type: string; pos: number }[] = [];
  for (const [type, count] of [['image', img], ['video', vid], ['reel', reel], ['blog', blog]] as [string, number][]) {
    if (count === 0) continue;
    const spacing = total / count;
    for (let i = 0; i < count; i++) positioned.push({ type, pos: spacing * i + spacing / 2 });
  }
  positioned.sort((a, b) => a.pos - b.pos);
  return positioned.map(p => p.type);
}

function packageContentCounts(pkg: PackageRow): Record<string, number> {
  return {
    image: Math.max(0, Number(pkg.images_per_month ?? 0)),
    video: Math.max(0, Number(pkg.videos_per_month ?? 0)),
    reel: Math.max(0, Number(pkg.reels_per_month ?? 0)),
    blog: Math.max(0, Number(pkg.blog_posts_per_month ?? 0)),
  };
}

function packageAllowsContentType(pkg: PackageRow, contentType: string): boolean {
  const counts = packageContentCounts(pkg);
  return (counts[normalizeContentType(contentType)] ?? 0) > 0;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function addMonths(month: string, offset: number): string {
  const [yearStr, monthStr] = month.split('-');
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1 + offset, 1, 12, 0, 0));
  return date.toISOString().slice(0, 7);
}

function packageCandidatesForRange(pkg: PackageRow, periodStart: string, periodEnd: string): PackageSlotCandidate[] {
  const weeklySchedule = parseWeeklySchedule(pkg.weekly_schedule ?? null);
  const counts = packageContentCounts(pkg);
  const dates = buildDates(periodStart, periodEnd, pkg.posting_frequency, pkg.posting_days ?? null, pkg.weekly_schedule ?? null);
  const candidates: PackageSlotCandidate[] = [];

  if (weeklySchedule) {
    for (const date of dates) {
      const dayName = getDayName(date);
      const contentTypes = weeklySchedule[dayName] ?? [];
      for (const [dailyIndex, rawType] of contentTypes.entries()) {
        const contentType = normalizeContentType(rawType);
        if ((counts[contentType] ?? 0) <= 0) continue;
        candidates.push({ date, contentType, dailyIndex });
      }
    }
    return candidates;
  }

  const sequence = buildContentSequence(pkg).map((type) => normalizeContentType(type));
  const totalAllowed = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (totalAllowed <= 0) return [];
  const limitedDates = dates.slice(0, totalAllowed);
  return limitedDates.map((date, index) => ({
    date,
    contentType: sequence[index % sequence.length] ?? 'image',
    dailyIndex: 0,
  }));
}

export function buildPackageSlots(pkg: PackageRow, periodStart: string, periodEnd: string): PackageSlotCandidate[] {
  const counts = packageContentCounts(pkg);
  const startMonth = monthKey(periodStart);
  const endMonth = monthKey(periodEnd);
  const allowed = new Set<string>();

  for (let month = startMonth; month <= endMonth; month = addMonths(month, 1)) {
    const { start, end } = getMonthBounds(month);
    const monthCandidates = packageCandidatesForRange(pkg, start, end);
    const used: Record<string, number> = {};
    for (const candidate of monthCandidates) {
      const contentType = normalizeContentType(candidate.contentType);
      const maxForType = counts[contentType] ?? 0;
      if (maxForType <= 0) continue;
      const next = (used[contentType] ?? 0) + 1;
      if (next > maxForType) continue;
      used[contentType] = next;
      allowed.add(`${candidate.date}:${candidate.dailyIndex}:${contentType}`);
    }
  }

  return packageCandidatesForRange(pkg, periodStart, periodEnd)
    .filter((candidate) => allowed.has(`${candidate.date}:${candidate.dailyIndex}:${normalizeContentType(candidate.contentType)}`));
}

function buildDates(
  periodStart: string, periodEnd: string,
  frequency: string, postingDays: string | null,
  weeklySchedule?: string | null,
): string[] {
  if (weeklySchedule) {
    const sched = parseWeeklySchedule(weeklySchedule);
    if (sched && Object.keys(sched).length > 0) {
      const activeDayNums = new Set(Object.keys(sched).map(d => DAY_NAME_TO_NUM[d]).filter(n => n !== undefined));
      return buildDatesRaw(periodStart, periodEnd, 'weekly', activeDayNums);
    }
  }
  return buildDatesRaw(periodStart, periodEnd, frequency, new Set(parsePostingDays(postingDays)));
}

function buildDatesRaw(periodStart: string, periodEnd: string, frequency: string, dayNums: Set<number>): string[] {
  const start = new Date(periodStart + 'T12:00:00Z');
  const end   = new Date(periodEnd   + 'T12:00:00Z');
  const dates: string[] = [];

  if (frequency === 'biweekly') {
    const anchor = new Date(start);
    while (anchor.getUTCDay() !== 1) anchor.setUTCDate(anchor.getUTCDate() - 1);
    const d = new Date(start);
    while (d <= end) {
      if (dayNums.has(d.getUTCDay())) {
        const weekIndex = Math.floor((d.getTime() - anchor.getTime()) / (7 * 86400000));
        if (weekIndex % 2 === 0) dates.push(d.toISOString().split('T')[0]);
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return dates;
  }

  if (frequency === 'monthly') {
    const seen = new Set<number>();
    const d = new Date(start);
    while (d <= end) {
      const wd = d.getUTCDay();
      if (dayNums.has(wd) && !seen.has(wd)) { dates.push(d.toISOString().split('T')[0]); seen.add(wd); }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return dates;
  }

  const d = new Date(start);
  while (d <= end) {
    if (dayNums.has(d.getUTCDay())) dates.push(d.toISOString().split('T')[0]);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function planMonth(date: string): string {
  return date.slice(0, 7);
}

function getMonthBounds(month: string): { start: string; end: string } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function buildMonthlyTopicSelection(
  db: D1Database,
  clientId: string,
  date: string,
  contentType: string,
  platforms: string[],
  serviceAreas: string[],
  excludedTopicIds: string[] = [],
): Promise<SlotTopicSelection | null> {
  const month = planMonth(date);
  const requestedPlatforms = new Set(platforms);
  const [approvedTopics, plannedTopics] = await Promise.all([
    listClientMonthlyTopics(db, clientId, month, 'approved'),
    listClientMonthlyTopics(db, clientId, month, 'planned'),
  ]);
  const allTopics = [...approvedTopics, ...plannedTopics].filter((topic) => {
    if (excludedTopicIds.includes(topic.id)) return false;
    if (topic.content_type_preference && topic.content_type_preference !== contentType) return false;
    if (!topic.preferred_platforms || requestedPlatforms.size === 0) return true;
    try {
      const preferred = JSON.parse(topic.preferred_platforms) as string[];
      return preferred.some((platform) => requestedPlatforms.has(platform));
    } catch {
      return true;
    }
  });
  const monthlyTopic = allTopics[0] ?? null;
  if (!monthlyTopic) return null;

  return {
    monthlyTopicId: monthlyTopic.id,
    topicTitle: monthlyTopic.topic_title,
    serviceCategory: monthlyTopic.service_category ?? null,
    targetKeyword: monthlyTopic.target_keyword?.trim() || monthlyTopic.topic_title.toLowerCase().split(' ').slice(0, 4).join(' '),
    targetLocality: serviceAreas[0] ?? null,
    topicFingerprint: buildTopicFingerprint({
      topic: monthlyTopic.topic_title,
      serviceCategory: monthlyTopic.service_category,
      contentType,
      targetKeyword: monthlyTopic.target_keyword,
    }),
    notes: monthlyTopic.notes ?? null,
    source: monthlyTopic.status === 'approved' ? 'monthly_approved' : 'monthly_planned',
  };
}

function getTopicResearchFromSelection(
  selection: SlotTopicSelection,
  serviceAreas: string[],
): TopicResearch {
  return {
    topic: selection.topicTitle ?? '',
    angle: selection.serviceCategory ?? selection.source,
    format: 'quick_explainer',
    targetKeyword: selection.targetKeyword ?? selection.topicTitle ?? '',
    localModifier: selection.targetLocality ?? serviceAreas[0] ?? '',
    searchQuestion: selection.notes?.trim() || (selection.topicTitle ?? ''),
  };
}

export function existingPostTopicSelection(
  post: Pick<PostRow, 'title' | 'target_keyword' | 'target_locality' | 'monthly_topic_id' | 'topic_fingerprint' | 'topic_service_category'>,
  contentType: string,
): SlotTopicSelection | null {
  const topicTitle = post.title?.trim() || null;
  const targetKeyword = post.target_keyword?.trim() || null;
  if (!topicTitle && !targetKeyword) return null;

  return {
    monthlyTopicId: post.monthly_topic_id ?? null,
    topicTitle,
    targetKeyword,
    targetLocality: post.target_locality?.trim() || null,
    serviceCategory: post.topic_service_category?.trim() || null,
    topicFingerprint: post.topic_fingerprint?.trim() || buildTopicFingerprint({
      topic: topicTitle,
      serviceCategory: post.topic_service_category,
      contentType,
      targetKeyword,
    }),
    source: 'research',
  };
}

const FALLBACK_FORMATS: ContentFormat[] = [
  'local_advice',
  'checklist',
  'mistake_to_avoid',
  'process_breakdown',
  'faq',
  'comparison',
  'quick_explainer',
  'trust_builder',
];

function uniqueClean(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = String(value ?? '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function splitJsonOrCsv(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch { /* delimited fallback */ }
  return raw
    .split(/[,\n|;]/)
    .map((item) => item.replace(/^[\s["']+|[\s\]"']+$/g, '').trim())
    .filter(Boolean);
}

function stableSlotSeed(slot: PostSlot): number {
  return [...`${slot.slot_key}:${slot.content_type}`]
    .reduce((sum, char) => (sum + char.charCodeAt(0)) % 997, 0);
}

export function resolveKeywordService(services: string[], keyword: string, seed: number): string {
  const normalizePhrase = (value: string) => ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const normalizedKeywordPhrase = normalizePhrase(keyword);
  const exactService = [...services]
    .sort((a, b) => normalizePhrase(b).length - normalizePhrase(a).length)
    .find((service) => normalizedKeywordPhrase.includes(normalizePhrase(service)));
  if (exactService) return exactService;

  const normalizedKeyword = keyword.toLowerCase();
  const intentGroups = [
    ['car', 'auto', 'automotive', 'vehicle'],
    ['building', 'commercial', 'residential', 'door'],
  ];
  for (const intent of intentGroups) {
    if (!intent.some((token) => normalizedKeyword.includes(token))) continue;
    const matches = services.filter((service) => {
      const normalizedService = service.toLowerCase();
      return intent.some((token) => normalizedService.includes(token));
    });
    if (matches.length > 0) return matches[seed % matches.length];
  }

  const scored = services
    .map((service) => ({
      service,
      score: service.toLowerCase().split(/\s+/).filter((token) => token.length > 3 && normalizedKeyword.includes(token.replace(/(ing|ed|s)$/, ''))).length,
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].service : services[seed % services.length];
}

function fallbackTopicForFormat(format: ContentFormat, service: string, locality: string): { topic: string; question: string } {
  const local = locality ? ` in ${locality}` : '';
  switch (format) {
    case 'comparison':
      return { topic: `${service}${local}: compare two practical approaches`, question: `Which ${service} approach fits different customer situations${local}?` };
    case 'mistake_to_avoid':
      return { topic: `${service}${local}: one costly mistake and how to prevent it`, question: `What common ${service} mistake should customers${local} prevent?` };
    case 'process_breakdown':
      return { topic: `How a professional ${service} process works${local}`, question: `What happens during a professional ${service} service${local}?` };
    case 'faq':
      return { topic: `${service}${local}: answer one specific customer concern`, question: `What specific concern do customers have about ${service}${local}?` };
    case 'quick_explainer':
      return { topic: `${service}${local}: explain one technical decision clearly`, question: `Which technical ${service} decision confuses customers${local}?` };
    case 'trust_builder':
      return { topic: `${service}${local}: show a verifiable quality-control step`, question: `Which quality-control step matters most for ${service}${local}?` };
    case 'checklist':
      return { topic: `${service}${local}: three project-specific decision criteria`, question: `Which three project details determine the right ${service} plan${local}?` };
    default:
      return { topic: `${service}${local}: advice tied to a real local condition`, question: `Which local condition changes how ${service} should be handled${local}?` };
  }
}

function keywordPoolFromContext(
  intel: IntelRow | null,
  keywords: ClientKeywordLite[],
  serviceNames: string[],
  serviceAreas: string[],
  restrictions: string[] = [],
): string[] {
  const rankedKeywords = [...keywords].sort((a, b) => {
    const rank = (k: ClientKeywordLite) => ({ primary: 0, local: 1, near_me: 2, long_tail: 3 }[k.kw_type] ?? 4);
    return rank(a) - rank(b);
  });
  const normalizePhrase = (value: string) => ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const intelligenceKeywords = uniqueClean([
    intel?.primary_keyword,
    ...splitJsonOrCsv(intel?.secondary_keywords),
  ]).filter((keyword) => serviceAreas.length === 0 || serviceAreas.some((area) => normalizePhrase(keyword).includes(normalizePhrase(area))));
  return uniqueClean([
    ...intelligenceKeywords,
    ...serviceNames.flatMap((service) => serviceAreas.slice(0, 3).map((area) => `${service} ${area}`)),
    ...rankedKeywords.map((k) => k.keyword),
    ...serviceNames,
  ]).filter((keyword) => !findRestrictedContentPhrase(keyword, restrictions)).slice(0, 24);
}

export function resolveKeywordLocality(keyword: string, areas: string[], fallbackIndex: number): string {
  if (!areas.length) return '';
  const normalizePhrase = (value: string) => ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const normalizedKeyword = normalizePhrase(keyword);
  const embeddedArea = [...areas]
    .sort((a, b) => normalizePhrase(b).length - normalizePhrase(a).length)
    .find((area) => normalizedKeyword.includes(normalizePhrase(area)));
  return embeddedArea ?? areas[fallbackIndex % areas.length] ?? '';
}

export function weeklyUsedTargetKeywords(
  topicHistory: ClientGenerationTopicHistoryItem[],
  slotDate: string,
): Set<string> {
  const date = new Date(`${slotDate.slice(0, 10)}T12:00:00Z`);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? 6 : weekday - 1;
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  const from = weekStart.toISOString().slice(0, 10);
  const to = weekEnd.toISOString().slice(0, 10);
  return new Set(topicHistory
    .filter((item) => {
      const publishDate = item.publish_date?.slice(0, 10) ?? '';
      return publishDate >= from && publishDate <= to;
    })
    .map((item) => item.target_keyword?.trim().toLowerCase() ?? '')
    .filter(Boolean));
}

function selectFallbackTopic(
  client: ClientRow,
  slot: PostSlot,
  intel: IntelRow | null,
  serviceNames: string[],
  serviceAreas: string[],
  keywords: ClientKeywordLite[],
  topicHistory: ClientGenerationTopicHistoryItem[],
  recentFormats: ContentFormat[],
  restrictions: string[] = [],
): { selection: SlotTopicSelection; research: TopicResearch; keywords: string[] } | null {
  const services = uniqueClean([
    ...serviceNames,
    ...splitJsonOrCsv(intel?.service_priorities),
  ]).filter((service) => !findRestrictedContentPhrase(service, restrictions)).slice(0, 12);
  const areas = uniqueClean(serviceAreas.length ? serviceAreas : [client.state]).slice(0, 8);
  const keywordPool = keywordPoolFromContext(intel, keywords, services, areas, restrictions);
  if (!services.length || !keywordPool.length) return null;

  const historyFingerprints = new Set(
    topicHistory
      .map((item) => buildTopicFingerprint({
        topic: item.title,
        contentType: item.content_type,
        targetKeyword: item.target_keyword,
      }))
      .filter(Boolean),
  );
  const usedWeeklyKeywords = weeklyUsedTargetKeywords(topicHistory, slot.date);
  const recentFormatSet = new Set(recentFormats.slice(0, 6));
  const preferredFormats = FALLBACK_FORMATS.filter((format) => !recentFormatSet.has(format));
  const formats = preferredFormats.length ? preferredFormats : FALLBACK_FORMATS;
  const dateSeed = new Date(`${slot.date}T12:00:00Z`).getUTCDate() + stableSlotSeed(slot);

  for (let i = 0; i < keywordPool.length; i++) {
    const keyword = keywordPool[(dateSeed + i) % keywordPool.length];
    if (usedWeeklyKeywords.has(keyword.toLowerCase())) continue;
    const service = resolveKeywordService(services, keyword, dateSeed + i);
    const locality = resolveKeywordLocality(keyword, areas, dateSeed + i);
    const format = formats[(dateSeed + i) % formats.length];
    const fallback = fallbackTopicForFormat(format, service, locality || client.state || '');
    const topic = slot.content_type === 'blog'
      ? `${keyword}: ${fallback.topic}`
      : fallback.topic;
    const fingerprint = buildTopicFingerprint({
      topic,
      serviceCategory: service,
      contentType: slot.content_type,
      targetKeyword: keyword,
    });
    if (fingerprint && historyFingerprints.has(fingerprint)) continue;
    const selection: SlotTopicSelection = {
      monthlyTopicId: null,
      topicTitle: topic,
      targetKeyword: keyword,
      targetLocality: locality || null,
      serviceCategory: service,
      topicFingerprint: fingerprint,
      notes: `Deterministic package fallback from client services, service areas, and target keyword set. Keep this ${slot.content_type} educational and on-company.`,
      source: 'research',
    };
    const research: TopicResearch = {
      topic,
      angle: `Answer a practical customer question about ${service}${locality ? ` in ${locality}` : ''}; stay inside confirmed company services.`,
      format,
      targetKeyword: keyword,
      localModifier: locality,
      searchQuestion: fallback.question,
    };
    return { selection, research, keywords: keywordPool };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadSystemSettings(env: Env): Promise<Record<string, string>> {
  try {
    const raw = await env.KV_BINDING.get('settings:system');
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch { return {}; }
}

async function notifyDiscordGenerationSummary(
  env: Env,
  runId: string,
  provider: ContentProviderName,
  triggeredBy: string | null,
): Promise<void> {
  if (!triggeredBy?.startsWith('discord:')) return;

  const channelId = env.DISCORD_CHANNEL_ID ?? '';
  const botToken = env.DISCORD_BOT_TOKEN ?? '';
  if (!channelId || !botToken) return;

  const posts = await env.DB
    .prepare(`SELECT p.title, p.publish_date, c.canonical_name AS client_name
              FROM posts p
              JOIN clients c ON c.id = p.client_id
              WHERE p.generation_run_id = ?
              ORDER BY p.publish_date ASC, p.created_at ASC
              LIMIT 12`)
    .bind(runId)
    .all<{ title: string | null; publish_date: string | null; client_name: string }>();

  const lines = posts.results.slice(0, 8).map((post) => {
    const title = (post.title ?? '(untitled)').slice(0, 90);
    const date = post.publish_date?.slice(0, 10) ?? 'no date';
    return `• ${date} — ${post.client_name}: ${title}`;
  });

  await discordSend({
    channelId,
    token: botToken,
    content: `✅ Weekly content run complete with ${getProviderDisplayName(provider)}\nRun ID: \`${runId}\`\n${lines.join('\n') || 'No posts were created.'}${posts.results.length > lines.length ? `\n…+${posts.results.length - lines.length} more` : ''}`,
    embeds: [{
      title: 'Weekly Content Complete',
      description: `${getProviderDisplayName(provider)} generation finished. Images were not auto-generated; only content and design prompts were saved.`,
      color: DISCORD_COLORS.success,
      timestamp: new Date().toISOString(),
    }],
  });
}

async function finalizeSlotProgress(
  db: D1Database,
  env: Env,
  runId: string,
  nextCompletedIdx: number,
  outcome: 'created' | 'updated' | 'skipped',
  clientName: string,
  slots: PostSlot[],
  log: (level: Parameters<typeof appendGenerationLog>[2], msg: string) => Promise<void>,
): Promise<SlotWorkResult> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE generation_runs
              SET current_slot_idx = MAX(COALESCE(current_slot_idx, 0), ?),
                  posts_created    = posts_created + ?,
                  posts_updated    = posts_updated + ?,
                  last_activity_at = ?
              WHERE id = ?`)
    .bind(nextCompletedIdx, outcome === 'created' ? 1 : 0, outcome === 'updated' ? 1 : 0, now, runId)
    .run();

  const updated = await db
    .prepare('SELECT current_slot_idx, total_slots, posts_created, posts_updated, error_log FROM generation_runs WHERE id = ?')
    .bind(runId)
    .first<{ current_slot_idx: number; total_slots: number; posts_created: number; posts_updated: number; error_log: string | null }>();

  if (!updated) return { outcome: 'skipped', persisted: 'skipped' };

  const progress: GenerationProgress = {
    current_client: clientName,
    current_post: updated.current_slot_idx < updated.total_slots
      ? `${slots[updated.current_slot_idx]?.date ?? ''} / ${slots[updated.current_slot_idx]?.content_type ?? ''}`.trim()
      : '',
    completed: updated.current_slot_idx,
    total_estimated: updated.total_slots,
    errors: updated.error_log ? updated.error_log.split('\n').filter(Boolean).length : 0,
    clients_done: 0,
    clients_total: 0,
  };
  try { await updateGenerationProgress(db, runId, progress); } catch { /* ignore */ }

  const terminalRun = isTerminalContentProvider(normalizeContentProvider(slots[0]?.provider));
  if (updated.current_slot_idx >= updated.total_slots && !terminalRun) {
    const totalTouched = (updated.posts_created ?? 0) + (updated.posts_updated ?? 0);
    const finalStatus = totalTouched > 0 ? (updated.error_log ? 'completed_with_errors' : 'completed') : 'failed';
    await finalizeGenerationRun(db, runId, finalStatus, updated.posts_created, updated.error_log ?? null);
    await log('DONE', `Run complete: created=${updated.posts_created}, updated=${updated.posts_updated}, total=${updated.total_slots}, status=${finalStatus}`);
    try {
      const run = await getGenerationRunById(db, runId);
      await notifyDiscordGenerationSummary(env, runId, normalizeContentProvider(slots[0]?.provider), run?.triggered_by ?? null);
    } catch (err) {
      await log('WARN', `Discord completion notify failed: ${str(err)}`);
    }
    return { outcome: 'completed', persisted: outcome, totalSlots: updated.total_slots };
  }

  return { outcome: 'continue', persisted: outcome, nextSlot: updated.current_slot_idx, totalSlots: updated.total_slots };
}

export async function prepareGenerationPlan(env: Env, params: GenerationParams): Promise<{ slots: PostSlot[]; clients: ClientRow[] }> {
  const db = env.DB;
  const allClients = await listClients(db, 'active');
  const clients = params.client_slugs.length > 0
    ? allClients.filter((client) => params.client_slugs.includes(client.slug))
    : allClients;
  if (clients.length === 0) throw new Error('No matching active clients found');

  const provider = normalizeContentProvider(params.provider);
  const slots: PostSlot[] = [];
  const eligibleClients: ClientRow[] = [];
  let intentEduc = 0;
  let intentSales = 0;

  for (const client of clients) {
    const profile = await getClientProfileCompleteness(db, client.id);
    if (!profile.complete) {
      await appendGenerationError(
        db,
        params.run_id,
        `${client.slug} skipped: client profile is missing ${profile.gaps.join(', ')}.`,
      );
      continue;
    }
    const keywordAudit = await reclassifyActiveClientKeywords(db, client.id);
    if (keywordAudit.quarantined > 0) {
      await appendGenerationLog(
        db,
        params.run_id,
        'WARN',
        `${client.slug}: quarantined ${keywordAudit.quarantined}/${keywordAudit.checked} active research keywords outside the confirmed profile.`,
      );
    }
    eligibleClients.push(client);
    let pkg = DEFAULT_PACKAGE;
    if (client.package) {
      const row = await db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').bind(client.package).first<PackageRow>();
      if (row) pkg = row;
    }

    const packageSlots = buildPackageSlots(pkg, params.period_start, params.period_end);
    const postedRows = await db.prepare(
      `SELECT automation_slot_key, substr(publish_date, 1, 10) AS publish_day, content_type
       FROM posts
       WHERE client_id = ? AND status = 'posted'
         AND substr(publish_date, 1, 10) BETWEEN ? AND ?`,
    ).bind(client.id, params.period_start, params.period_end).all<{
      automation_slot_key: string | null;
      publish_day: string;
      content_type: string;
    }>();
    const postedSlotKeys = new Set(postedRows.results.map((row) => row.automation_slot_key).filter(Boolean));
    const postedLegacySlots = new Set(postedRows.results.map((row) => `${row.publish_day}:${normalizeContentType(row.content_type)}`));

    for (const packageSlot of packageSlots) {
      const slotKey = getAutomationSlotKey(client.id, packageSlot.date, packageSlot.contentType, packageSlot.dailyIndex);
      if (postedSlotKeys.has(slotKey) || postedLegacySlots.has(`${packageSlot.date}:${normalizeContentType(packageSlot.contentType)}`)) {
        await appendGenerationLog(db, params.run_id, 'INFO', `${client.slug}: ${packageSlot.date}/${packageSlot.contentType} already posted — omitted from generation plan.`);
        continue;
      }
      const totalSoFar = intentEduc + intentSales;
      const salesRatio = totalSoFar === 0 ? 0 : intentSales / totalSoFar;
      const intent: 'educational' | 'sales' = salesRatio < 0.30 ? 'sales' : 'educational';
      slots.push({
        client_id: client.id,
        client_slug: client.slug,
        date: packageSlot.date,
        content_type: normalizeContentType(packageSlot.contentType),
        content_intent: intent,
        slot_key: slotKey,
        high_quality: params.high_quality ?? false,
        provider,
      });
      if (intent === 'sales') intentSales++; else intentEduc++;
    }
  }

  if (slots.length === 0) throw new Error('No posts to generate for this period and client selection');
  return { slots, clients: eligibleClients };
}

function str(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function detail(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n${err.stack}` : err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pickGeneratedValue(
  existing: string | null | undefined,
  generated: string | null | undefined,
  overwrite: boolean,
): string | null | undefined {
  if (overwrite) return generated ?? null;
  return existing?.trim() ? existing : (generated ?? null);
}

function mergeGeneratedContent(
  existing: Record<string, string | null | undefined> | null,
  post: Record<string, string | undefined>,
  overwrite: boolean,
): Record<string, string | null> {
  const current = existing ?? {};
  const next: Record<string, string | null> = {};
  const keys = [
    'title',
    'master_caption',
    'cap_facebook',
    'cap_instagram',
    'cap_linkedin',
    'cap_x',
    'cap_threads',
    'cap_tiktok',
    'cap_pinterest',
    'cap_bluesky',
    'cap_google_business',
    'cap_gbp_la',
    'cap_gbp_wa',
    'cap_gbp_or',
    'youtube_title',
    'youtube_description',
    'blog_content',
    'blog_excerpt',
    'seo_title',
    'meta_description',
    'target_keyword',
    'target_locality',
    'secondary_keywords',
    'slug',
    'video_script',
    'ai_image_prompt',
    'ai_video_prompt',
  ];
  for (const key of keys) {
    const existingValue = isGeneratedCaptionField(key)
      ? (normalizeGeneratedCaptionValue(current[key]) ?? current[key])
      : current[key];
    const generatedValue = isGeneratedCaptionField(key)
      ? normalizeGeneratedCaptionValue(post[key])
      : post[key];
    next[key] = pickGeneratedValue(existingValue, generatedValue, overwrite) ?? null;
  }
  return next;
}

export interface SlotWorkResult {
  outcome: 'skipped' | 'continue' | 'completed';
  persisted?: 'created' | 'updated' | 'skipped';
  nextSlot?: number;
  totalSlots?: number;
}

/**
 * Trigger a specific slot via SELF service binding.
 * Always called from a fresh request handler — never from waitUntil —
 * so it is the first outbound operation in that handler (reliable).
 */
export async function triggerStep(env: Env, baseUrl: string, run_id: string, slot_idx: number): Promise<void> {
  const selfFetcher: { fetch: (req: Request) => Promise<Response> } | undefined =
    (env as unknown as { SELF?: { fetch: (req: Request) => Promise<Response> } }).SELF;

  const targetUrl = selfFetcher
    ? 'https://self/internal/gen-step'
    : `${baseUrl}/internal/gen-step`;
  const isLocalFallback = !selfFetcher && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl);

  if (!selfFetcher && !isLocalFallback) {
    throw new Error('SELF service binding is unavailable; refusing public self-fetch for gen-step in production');
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const req = new Request(targetUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id, slot_idx }),
      });

      const res = selfFetcher
        ? await selfFetcher.fetch(req)
        : await fetch(req, { signal: AbortSignal.timeout(15_000) });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`gen-step returned ${res.status}: ${text.slice(0, 200)}`);
      }
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 3) await sleep(attempt * 250);
    }
  }

  throw lastError ?? new Error('Unknown gen-step dispatch error');
}

export async function resumeGenerationRun(env: Env, baseUrl: string, runId: string): Promise<{ resumed: boolean; nextSlot: number; totalSlots: number }> {
  const run = await getGenerationRunById(env.DB, runId);
  if (!run) throw new Error('Generation run not found');

  const slots = JSON.parse(run.post_slots ?? '[]') as PostSlot[];
  const totalSlots = run.total_slots ?? slots.length;
  const nextSlot = Math.max(0, run.current_slot_idx ?? 0);

  if (!Array.isArray(slots) || slots.length === 0 || totalSlots === 0) {
    throw new Error('Generation run has no stored slot plan');
  }
  if (nextSlot >= totalSlots) {
    throw new Error('Generation run is already complete');
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE generation_runs
              SET status = 'running',
                  completed_at = NULL,
                  last_activity_at = ?,
                  execution_log = substr(COALESCE(execution_log || char(10), '') || ?, -40000)
              WHERE id = ?`)
    .bind(now, `${new Date(now * 1000).toISOString().slice(0, 19)}Z [INFO] Run resumed from slot ${nextSlot + 1}/${totalSlots}`, runId)
    .run();

  // Claude provider runs must resume through the approved terminal-job queue,
  // not the worker /internal/gen-step path (which would call the Anthropic API).
  const provider = normalizeContentProvider(slots[nextSlot]?.provider ?? slots[0]?.provider);
  if (isTerminalContentProvider(provider)) {
    const remainingClientSlugs = Array.from(
      new Set(slots.slice(nextSlot).map((slot) => slot.client_slug)),
    );
    const periodStart = slots[nextSlot]?.date ?? slots[0].date;
    const periodEnd = slots[slots.length - 1]?.date ?? periodStart;
    const preparedSlots = await prebuildApprovedTerminalSlotRequests(env, runId);
    await createApprovedCommandJob(env.DB, {
      generation_run_id: runId,
      command_name: 'weekly_content_terminal',
      provider: 'terminal',
      requested_by: run.triggered_by ?? 'resume',
      args_json: JSON.stringify({
        run_id: runId,
        client_slugs: remainingClientSlugs,
        period_start: periodStart,
        period_end: periodEnd,
        content_only: true,
        generate_images: false,
        provider: 'terminal',
        requested_in: 'resume',
        prepared_slots: preparedSlots,
      }),
    });
    await appendGenerationLog(env.DB, runId, 'INFO', `Terminal AI job re-queued from slot ${nextSlot + 1}/${totalSlots}`);
    return { resumed: true, nextSlot, totalSlots };
  }

  await triggerStep(env, baseUrl, runId, nextSlot);
  return { resumed: true, nextSlot, totalSlots };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Plan
// Fast: DB reads only. Computes all post slots and stores them in the run
// record, then fires the first step.
// ─────────────────────────────────────────────────────────────────────────────

export async function planGeneration(env: Env, params: GenerationParams, baseUrl: string): Promise<void> {
  const db = env.DB;

  async function log(level: Parameters<typeof appendGenerationLog>[2], msg: string) {
    console.log(`[gen:${params.run_id.slice(0, 8)}] [${level}] ${msg}`);
    try { await appendGenerationLog(db, params.run_id, level, msg); } catch { /* */ }
  }

  try {
    await log('START', `Planning started — ${params.period_start} → ${params.period_end}`);
    const { slots, clients } = await prepareGenerationPlan(env, params);

    await log('INFO', `${clients.length} client(s): ${clients.map(c => c.slug).join(', ')}`);

    await storeGenerationPlan(db, params.run_id, slots, params.publish_time);

    const progress: GenerationProgress = {
      current_client:  clients[0]?.canonical_name ?? '',
      current_post:    slots[0] ? `${slots[0].date} / ${slots[0].content_type}` : '',
      completed:       0,
      total_estimated: slots.length,
      errors:          0,
      clients_done:    0,
      clients_total:   clients.length,
    };
    await updateGenerationProgress(db, params.run_id, progress);

    await log('INFO', `Plan ready: ${slots.length} slots — firing step 0`);
    for (const [idx, slot] of slots.entries()) {
      await log('INFO', `Planned slot ${idx + 1}/${slots.length}: client=${slot.client_slug} date=${slot.date} type=${slot.content_type} intent=${slot.content_intent} provider=${slot.provider ?? 'openai'}`);
    }
    await log('INFO', `Dispatch start: slot 0 / ${slots.length - 1}`);
    await triggerStep(env, baseUrl, params.run_id, 0);
    await log('INFO', 'Dispatch success: slot 0');

  } catch (err) {
    const msg = `Fatal (planning): ${str(err)}`;
    await log('ERROR', msg);
    await finalizeGenerationRun(db, params.run_id, 'failed', 0, msg);
  }
}

export async function buildSlotGenerationRequest(env: Env, runId: string, slotIdx: number): Promise<SlotGenerationRequest | null> {
  const db = env.DB;
  const run = await getGenerationRunById(db, runId);
  if (!run) throw new Error('Generation run not found');
  const slots = JSON.parse(run.post_slots ?? '[]') as PostSlot[];
  if (slotIdx < 0 || slotIdx >= slots.length) throw new Error('Slot out of range');

  const slot = slots[slotIdx];
  const provider = normalizeContentProvider(slot.provider);
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(slot.client_id).first<ClientRow>();
  if (!client) throw new Error(`Client not found: ${slot.client_slug}`);

  let pkg = DEFAULT_PACKAGE;
  if (client.package) {
    const row = await db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').bind(client.package).first<PackageRow>();
    if (row) pkg = row;
  }
  if (!packageAllowsContentType(pkg, slot.content_type)) return null;

  const [storedClientPlatforms, gbpLocations] = await Promise.all([
    getClientPlatforms(db, client.id),
    getClientGbpLocations(db, client.id),
  ]);
  const clientPlatforms = withImplicitGbpPlatform(
    withImplicitBlogPlatform(storedClientPlatforms, client, true),
    gbpLocations,
    client.id,
  );
  let packagePlatforms: string[] = [];
  try { packagePlatforms = JSON.parse(pkg.platforms_included); } catch { /* */ }
  const platformSelection = resolvePlatformSelection({
    contentType: slot.content_type,
    packagePlatforms,
    clientPlatforms,
  });
  const fallbackSelection = resolvePlatformSelection({
    contentType: slot.content_type,
    packagePlatforms,
    clientPlatforms,
    allowIncompatibleOverride: true,
  });
  const platforms = platformSelection.selected.length > 0 ? platformSelection.selected : fallbackSelection.selected;
  if (platformSelection.selected.length === 0 && platforms.length > 0) {
    console.warn(`[gen:${runId.slice(0, 8)}] falling back to unconnected platforms for slot ${slotIdx + 1}/${slots.length} (${slot.client_slug} ${slot.date} ${slot.content_type}) -> ${platforms.join(', ')}`);
  }
  if (platforms.length === 0) {
    console.warn(`[gen:${runId.slice(0, 8)}] skipping slot ${slotIdx + 1}/${slots.length} for ${slot.client_slug} ${slot.date} ${slot.content_type} — no compatible platforms`);
    return null;
  }

  const existingPost = await getPostByAutomationSlot(
    db,
    client.id,
    slot.slot_key,
    slot.date,
    normalizeContentType(slot.content_type),
  );
  if (existingPost?.status === 'posted') return null;

  const [intelBase, fbRows, recRows, svcAreaRows, svcNameRows, keywordRows, topicHistory, restrictions] = await Promise.all([
    db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(client.id).first<IntelRow>().then((row) => row ?? null),
    db.prepare('SELECT sentiment, message AS note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 10').bind(client.id).all<FeedbackRow>(),
    db.prepare(`SELECT id, title, master_caption, content_type FROM posts WHERE client_id = ? AND status NOT IN ('cancelled','failed') ORDER BY created_at DESC LIMIT 30`).bind(client.id).all<{id:string;title:string|null;master_caption:string|null;content_type:string|null}>(),
    db.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 8').bind(client.id).all<{city:string}>(),
    db.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 12').bind(client.id).all<{name:string}>(),
    getClientKeywords(db, client.id),
    getClientGenerationTopicHistory(db, client.id, 24),
    getClientRestrictions(db, client.id),
  ]);

  const recentRows = recRows.results.filter((row) => row.id !== existingPost?.id);
  const recentTitles  = recentRows.map((row) => row.title ?? row.master_caption?.slice(0, 80) ?? '').filter(Boolean) as string[];
  const serviceAreas  = svcAreaRows.results.map((row) => row.city);
  const serviceNames  = svcNameRows.results
    .map((row) => row.name)
    .filter((service) => !findRestrictedContentPhrase(service, restrictions));
  if (existingPost && run.overwrite_existing !== 1 && isPostContentComplete(existingPost, gbpLocations, platforms)) return null;
  const monthlyPlan = await getClientMonthlyContentPlan(db, client.id, planMonth(slot.date));
  const intel = applyMonthlyPlanToIntelligence(intelBase, monthlyPlan);
  let targetKeywords = keywordPoolFromContext(intel, keywordRows, serviceNames, serviceAreas, restrictions);
  const recentFormats = recentRows
    .map((row) => detectFormatFromTitle(row.title ?? row.master_caption ?? ''))
    .filter((format): format is ContentFormat => format !== null);

  const settings = await loadSystemSettings(env);
  const researchParams = {
    client: {
      slug: client.slug,
      canonical_name: client.canonical_name,
      industry: client.industry,
      state: client.state,
      language: client.language,
    },
    intelligence: intel ? {
      service_priorities: intel.service_priorities,
      seasonal_notes: intel.seasonal_notes,
      local_seo_themes: intel.local_seo_themes,
    } : null,
    contentType: slot.content_type,
    contentIntent: slot.content_intent,
    platforms,
    publishDate: slot.date,
    recentTitles,
    recentFormats,
    serviceAreas,
    serviceNames,
    targetKeywords,
  };

  // Topic research drives non-repetitive, SEO-aware prompts. Terminal runs stay
  // terminal-only, so if there is no monthly topic selection and no API-backed
  // research provider, the prompt falls back to the client context alone.
  const primaryKey = resolveProviderApiKey(env, settings, provider);
  let topicSelection = existingPost && run.overwrite_existing !== 1
    ? existingPostTopicSelection(existingPost, slot.content_type)
    : null;
  let topicResearch: TopicResearch | null = topicSelection
    ? getTopicResearchFromSelection(topicSelection, serviceAreas)
    : null;
  const skippedTopicIds: string[] = [];
  for (let attempt = 0; !topicSelection && attempt < 12; attempt++) {
    const candidate = await buildMonthlyTopicSelection(db, client.id, slot.date, slot.content_type, platforms, serviceAreas, skippedTopicIds);
    if (!candidate) break;
    const restrictedPhrase = findRestrictedContentPhrase(
      [candidate.topicTitle, candidate.targetKeyword, candidate.serviceCategory].filter(Boolean).join(' '),
      restrictions,
    );
    if (restrictedPhrase) {
      if (candidate.monthlyTopicId) skippedTopicIds.push(candidate.monthlyTopicId);
      continue;
    }
    const conflict = await findRecentTopicConflict(db, {
      clientId: client.id,
      candidateTitle: candidate.topicTitle,
      candidateKeyword: candidate.targetKeyword,
      candidateServiceCategory: candidate.serviceCategory,
      contentType: slot.content_type,
      topicFingerprint: candidate.topicFingerprint,
      publishDate: slot.date,
    });
    if (conflict) {
      if (!candidate.monthlyTopicId) break;
      skippedTopicIds.push(candidate.monthlyTopicId);
      continue;
    }
    topicSelection = candidate;
    topicResearch = getTopicResearchFromSelection(candidate, serviceAreas);
    break;
  }
  if (!topicResearch && primaryKey) {
    topicResearch = await researchTopicWithProvider(provider, primaryKey, researchParams, settings).catch(() => null);
  }
  if (!topicSelection && topicResearch) {
    topicSelection = {
      monthlyTopicId: null,
      topicTitle: topicResearch.topic,
      targetKeyword: topicResearch.targetKeyword,
      targetLocality: topicResearch.localModifier || null,
      serviceCategory: null,
      topicFingerprint: buildTopicFingerprint({
        topic: topicResearch.topic,
        contentType: slot.content_type,
        targetKeyword: topicResearch.targetKeyword,
      }),
      source: 'research',
    };
  }
  if (topicResearch && findRestrictedContentPhrase(
    [topicResearch.topic, topicResearch.targetKeyword, topicResearch.searchQuestion].join(' '),
    restrictions,
  )) {
    topicResearch = null;
    topicSelection = null;
  }
  if (!topicResearch || !topicSelection) {
    const fallback = selectFallbackTopic(client, slot, intel, serviceNames, serviceAreas, keywordRows, topicHistory, recentFormats, restrictions);
    if (fallback) {
      topicResearch = fallback.research;
      topicSelection = fallback.selection;
      targetKeywords = fallback.keywords;
    }
  }

  const [latestResearch, latestStrategy] = await Promise.all([
    getLatestClientResearch(db, client.id),
    getLatestClientStrategy(db, client.id),
  ]);
  const strategicContext = buildWeeklyMarketingStrategicContext({
    client: {
      slug: client.slug,
      canonical_name: client.canonical_name,
      industry: client.industry,
      language: client.language,
    },
    topicHistory: mapTopicHistoryForContext(topicHistory),
    autonomousSignals: buildAutonomousResearchSignals(latestResearch, latestStrategy),
  });

  const ctx: GenerationContext = {
    client: {
      slug: client.slug,
      canonical_name: client.canonical_name,
      notes: client.notes,
      brand_json: client.brand_json,
      brand_primary_color: (client as unknown as {brand_primary_color?: string|null}).brand_primary_color ?? null,
      language: client.language,
      phone: client.phone,
      cta_text: client.cta_text,
      industry: client.industry,
      state: client.state,
      owner_name: client.owner_name,
      wp_template_key: client.wp_template_key ?? client.wp_template ?? null,
    },
    intelligence: intel,
    recentTitles,
    feedback: fbRows.results,
    publishDate: slot.date,
    contentType: slot.content_type,
    platforms,
    contentIntent: slot.content_intent,
    gbpLocations: gbpLocations
      .filter((location) => location.paused !== 1)
      .map((location) => ({ label: location.label, captionField: getGbpCaptionField(location) }))
      .filter((location) => Boolean(location.captionField)),
    topicResearch,
    serviceAreas,
    serviceNames,
    targetKeywords,
    restrictions,
    recentFormats,
    highQuality: slot.high_quality ?? false,
    strategicContext,
  };

  return {
    runId,
    slotIdx,
    slot,
    clientName: client.canonical_name,
    provider,
    request: buildGenerationRequest(ctx),
    topicSelection: topicSelection ?? {
      monthlyTopicId: null,
      topicTitle: topicResearch?.topic ?? null,
      targetKeyword: topicResearch?.targetKeyword ?? null,
      targetLocality: topicResearch?.localModifier ?? null,
      serviceCategory: null,
      topicFingerprint: topicResearch
        ? buildTopicFingerprint({
          topic: topicResearch.topic,
          contentType: slot.content_type,
          targetKeyword: topicResearch.targetKeyword,
        })
        : null,
      source: 'research',
    },
  };
}

export async function prebuildApprovedTerminalSlotRequests(
  env: Env,
  runId: string,
): Promise<PreparedApprovedSlotRequest[]> {
  const db = env.DB;
  const run = await getGenerationRunById(db, runId);
  if (!run) throw new Error('Generation run not found');

  const slots = JSON.parse(run.post_slots ?? '[]') as PostSlot[];
  const prepared: PreparedApprovedSlotRequest[] = [];

  for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
    const built = await buildSlotGenerationRequest(env, runId, slotIdx);
    if (!built) continue;
    prepared.push({
      slot_idx: slotIdx,
      client_slug: built.slot.client_slug,
      client_name: built.clientName,
      publish_date: built.slot.date,
      content_type: built.slot.content_type,
      topic_selection: built.topicSelection,
      prompt: built.request.prompt,
      schema: built.request.schema.schema,
      plan: built.request.plan,
    });
  }

  return prepared;
}

export interface ApprovedTerminalGenerationInput {
  client_slugs: string[];
  period_start: string;
  period_end: string;
  triggered_by: string;
  publish_time?: string | null;
  overwrite_existing?: boolean;
  requested_in: string;
}

export async function queueApprovedTerminalGeneration(
  env: Env,
  input: ApprovedTerminalGenerationInput,
): Promise<{ run_id: string; job_id: string; total_slots: number }> {
  const publishTime = input.publish_time ?? null;
  const run = await createGenerationRun(env.DB, {
    triggered_by: input.triggered_by,
    date_range: `${input.period_start}:${input.period_end}`,
    client_filter: input.client_slugs.length > 0 ? JSON.stringify(input.client_slugs) : null,
    overwrite_existing: input.overwrite_existing === true,
  });

  try {
    const params: GenerationParams = {
      run_id: run.id,
      client_slugs: input.client_slugs,
      period_start: input.period_start,
      period_end: input.period_end,
      triggered_by: input.triggered_by,
      publish_time: publishTime,
      overwrite_existing: input.overwrite_existing === true,
      high_quality: true,
      provider: 'terminal',
    };
    const { slots, clients } = await prepareGenerationPlan(env, params);
    await storeGenerationPlan(env.DB, run.id, slots, publishTime);
    await updateGenerationProgress(env.DB, run.id, {
      current_client: clients[0]?.canonical_name ?? '',
      current_post: slots[0] ? `${slots[0].date} / ${slots[0].content_type}` : '',
      completed: 0,
      total_estimated: slots.length,
      errors: 0,
      clients_done: 0,
      clients_total: clients.length,
    });
    await appendGenerationLog(
      env.DB,
      run.id,
      'START',
      `Terminal AI job queued from ${input.requested_in} - ${input.period_start} to ${input.period_end}`,
    );
    const preparedSlots = await prebuildApprovedTerminalSlotRequests(env, run.id);
    const job = await createApprovedCommandJob(env.DB, {
      generation_run_id: run.id,
      command_name: 'weekly_content_terminal',
      provider: 'terminal',
      requested_by: input.triggered_by,
      args_json: JSON.stringify({
        run_id: run.id,
        client_slugs: input.client_slugs,
        period_start: input.period_start,
        period_end: input.period_end,
        content_only: true,
        generate_images: false,
        provider: 'terminal',
        requested_in: input.requested_in,
        prepared_slots: preparedSlots,
      }),
    });
    return { run_id: run.id, job_id: job.id, total_slots: slots.length };
  } catch (err) {
    const message = `Terminal generation queue failed: ${str(err)}`;
    await appendGenerationError(env.DB, run.id, message).catch(() => undefined);
    await finalizeGenerationRun(env.DB, run.id, 'failed', 0, message).catch(() => undefined);
    throw err;
  }
}

export async function saveGeneratedSlotResult(
  env: Env,
  runId: string,
  slotIdx: number,
  generatedPost: GeneratedPost,
  topicSelection?: SlotTopicSelection | null,
): Promise<SlotWorkResult> {
  const db = env.DB;
  const run = await getGenerationRunById(db, runId);
  if (!run) throw new Error('Generation run not found');
  const slots = JSON.parse(run.post_slots ?? '[]') as PostSlot[];
  if (slotIdx < 0 || slotIdx >= slots.length) throw new Error('Slot out of range');
  const slot = slots[slotIdx];
  const postTime = run.publish_time ?? '10:00';
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(slot.client_id).first<ClientRow>();
  if (!client) throw new Error(`Client not found: ${slot.client_slug}`);

  const [storedClientPlatforms, gbpLocations] = await Promise.all([
    getClientPlatforms(db, client.id),
    getClientGbpLocations(db, client.id),
  ]);
  const clientPlatforms = withImplicitGbpPlatform(
    withImplicitBlogPlatform(storedClientPlatforms, client, true),
    gbpLocations,
    client.id,
  );
  let pkg = DEFAULT_PACKAGE;
  if (client.package) {
    const row = await db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').bind(client.package).first<PackageRow>();
    if (row) pkg = row;
  }
  if (!packageAllowsContentType(pkg, slot.content_type)) {
    return finalizeSlotProgress(db, env, runId, slotIdx + 1, 'skipped', client.canonical_name, slots, async () => undefined);
  }
  let packagePlatforms: string[] = [];
  try { packagePlatforms = JSON.parse(pkg.platforms_included); } catch { /* */ }
  const platformSelection = resolvePlatformSelection({
    contentType: slot.content_type,
    packagePlatforms,
    clientPlatforms,
  });
  const platforms = platformSelection.selected;
  if (platforms.length === 0) {
    return finalizeSlotProgress(db, env, runId, slotIdx + 1, 'skipped', client.canonical_name, slots, async () => undefined);
  }

  const existingPost = await getPostByAutomationSlot(
    db,
    client.id,
    slot.slot_key,
    slot.date,
    normalizeContentType(slot.content_type),
  );
  if (existingPost?.status === 'posted') {
    return finalizeSlotProgress(db, env, runId, slotIdx + 1, 'skipped', client.canonical_name, slots, async () => undefined);
  }
  const overwriteExisting = run.overwrite_existing === 1;
  if (topicSelection?.targetKeyword) generatedPost.target_keyword = topicSelection.targetKeyword;
  if (topicSelection?.targetLocality) generatedPost.target_locality = topicSelection.targetLocality;
  canonicalizeGeneratedPhoneNumbers(generatedPost, client.phone);

  // Terminal-generated blogs return structured fields (intro/sections/faq), not a
  // ready-to-store blog_content. The OpenAI path assembles the body inside
  // normalizeGeneratedPost; the terminal save path must do the same or the blog
  // is saved with no body. Assemble it here when missing.
  if (normalizeContentType(slot.content_type) === 'blog') {
    const src = generatedPost as unknown as Record<string, unknown>;
    if (!String(src.blog_content ?? '').trim()) {
      const assembled = buildBlogContentHtml(src, {
        slug: client.slug,
        canonical_name: client.canonical_name,
        notes: client.notes,
        brand_json: client.brand_json,
        brand_primary_color: (client as unknown as { brand_primary_color?: string | null }).brand_primary_color ?? null,
        language: client.language,
        phone: client.phone,
        cta_text: client.cta_text,
        industry: client.industry,
        state: client.state,
        owner_name: client.owner_name,
        wp_template_key: client.wp_template_key ?? client.wp_template ?? null,
      }, slot.date);
      if (assembled) src.blog_content = assembled;
    }
    canonicalizeGeneratedPhoneNumbers(generatedPost, client.phone);
  }

  const [validationRecentRows, validationAreaRows, validationServiceRows, validationKeywordRows, validationIntel, validationRestrictions] = await Promise.all([
    db.prepare(`SELECT id, title, master_caption FROM posts WHERE client_id = ? AND status NOT IN ('cancelled','failed') ORDER BY created_at DESC LIMIT 30`)
      .bind(client.id)
      .all<{ id: string; title: string | null; master_caption: string | null }>(),
    db.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 8')
      .bind(client.id)
      .all<{ city: string }>(),
    db.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 12')
      .bind(client.id)
      .all<{ name: string }>(),
    getClientKeywords(db, client.id),
    db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(client.id).first<IntelRow>().then((row) => row ?? null),
    getClientRestrictions(db, client.id),
  ]);
  const validationServiceAreas = validationAreaRows.results.map((row) => row.city);
  const validationServiceNames = validationServiceRows.results.map((row) => row.name);
  const validationTargetKeywords = keywordPoolFromContext(
    validationIntel,
    validationKeywordRows,
    validationServiceNames,
    validationServiceAreas,
    validationRestrictions,
  );
  const validationTopicResearch = topicSelection?.targetKeyword || topicSelection?.topicTitle
    ? getTopicResearchFromSelection(topicSelection, validationServiceAreas)
    : null;
  const validationResult = validateGeneratedContent(generatedPost, {
    client: {
      slug: client.slug,
      canonical_name: client.canonical_name,
      notes: client.notes,
      brand_json: client.brand_json,
      brand_primary_color: (client as unknown as { brand_primary_color?: string | null }).brand_primary_color ?? null,
      language: client.language,
      phone: client.phone,
      cta_text: client.cta_text,
      industry: client.industry,
      state: client.state,
      owner_name: client.owner_name,
      wp_template_key: client.wp_template_key ?? client.wp_template ?? null,
    },
    intelligence: validationIntel,
    recentTitles: validationRecentRows.results
      .filter((row) => row.id !== existingPost?.id)
      .map((row) => row.title ?? row.master_caption?.slice(0, 80) ?? '')
      .filter(Boolean) as string[],
    feedback: [],
    publishDate: slot.date,
    contentType: normalizeContentType(slot.content_type),
    platforms,
    contentIntent: slot.content_intent,
    gbpLocations: gbpLocations
      .filter((location) => location.paused !== 1)
      .map((location) => ({ label: location.label, captionField: getGbpCaptionField(location) }))
      .filter((location) => Boolean(location.captionField)),
    topicResearch: validationTopicResearch,
    serviceAreas: validationServiceAreas,
    serviceNames: validationServiceNames,
    targetKeywords: validationTargetKeywords,
    restrictions: validationRestrictions,
    recentFormats: [],
    highQuality: slot.high_quality ?? false,
    strategicContext: null,
  });
  if (!validationResult.passed) {
    await appendGenerationLog(db, runId, slot.high_quality ? 'ERROR' : 'WARN', `Quality validation failed for slot ${slotIdx + 1}/${slots.length}: ${validationResult.warnings.join('; ')}`);
    if (slot.high_quality) {
      await appendGenerationError(db, runId, `Slot ${slotIdx + 1} ${slot.client_slug}/${slot.content_type} quality validation failed: ${validationResult.warnings.join('; ')}`);
      throw new Error(`Quality validation failed: ${validationResult.warnings.join('; ')}`);
    }
  }

  const merged = mergeGeneratedContent(existingPost as unknown as Record<string, string | null | undefined>, generatedPost as unknown as Record<string, string | undefined>, overwriteExisting);
  if (normalizeContentType(slot.content_type) === 'blog') {
    merged.ai_image_prompt = null;
    merged.ai_video_prompt = null;
  }
  const selectedTopic = topicSelection ?? {
    monthlyTopicId: null,
    topicTitle: generatedPost.title ?? merged.title ?? null,
    targetKeyword: generatedPost.target_keyword ?? merged.target_keyword ?? null,
    targetLocality: generatedPost.target_locality ?? merged.target_locality ?? null,
    serviceCategory: null,
    topicFingerprint: buildTopicFingerprint({
      topic: generatedPost.title ?? merged.title ?? null,
      contentType: slot.content_type,
      targetKeyword: generatedPost.target_keyword ?? merged.target_keyword ?? null,
    }),
    source: 'research',
  };
  const duplicateConflict = await findRecentTopicConflict(db, {
    clientId: client.id,
    candidateTitle: merged.title ?? generatedPost.title ?? '',
    candidateKeyword: merged.target_keyword ?? generatedPost.target_keyword ?? '',
    candidateCaption: merged.master_caption ?? generatedPost.master_caption ?? '',
    candidateServiceCategory: selectedTopic.serviceCategory,
    contentType: normalizeContentType(slot.content_type),
    topicFingerprint: selectedTopic.topicFingerprint,
    publishDate: `${slot.date}T${postTime}`,
    excludePostId: existingPost?.id ?? null,
  });
  const targetPost = existingPost;
  const isBlogSlot = normalizeContentType(slot.content_type) === 'blog';
  const blogGbpDefaults = isBlogSlot
    ? { gbp_cta_type: 'LEARN_MORE' as string, gbp_topic_type: 'STANDARD' as string }
    : {};

  let outcome: 'created' | 'updated' | 'skipped' = 'skipped';
  let savedPostId: string | null = targetPost?.id ?? null;
  if (!targetPost && duplicateConflict) {
    if (selectedTopic.monthlyTopicId) {
      await markClientMonthlyTopicSkipped(db, selectedTopic.monthlyTopicId, duplicateConflict.reason);
    }
    throw new Error(`Generated slot duplicates existing post ${duplicateConflict.post.id}: ${duplicateConflict.reason}`);
  } else if (targetPost) {
    const nextPlatforms = targetPost.platform_manual_override === 1 && parsePlatforms(targetPost.platforms).length > 0
      ? parsePlatforms(targetPost.platforms)
      : platforms;
    await updatePost(db, targetPost.id, {
      title: merged.title,
      content_type: normalizeContentType(slot.content_type),
      platforms: JSON.stringify(nextPlatforms),
      publish_date: targetPost.publish_date ?? `${slot.date}T${postTime}`,
      platform_manual_override: targetPost.platform_manual_override ?? 0,
      automation_slot_key: slot.slot_key,
      generation_run_id: runId,
      scheduled_by_automation: 1,
      monthly_topic_id: selectedTopic.monthlyTopicId,
      topic_fingerprint: selectedTopic.topicFingerprint,
      topic_service_category: selectedTopic.serviceCategory,
      ...blogGbpDefaults,
      ...merged,
    });
    savedPostId = targetPost.id;
    outcome = 'updated';
  } else {
    const createdPost = await createPost(db, {
      client_id: client.id,
      title: merged.title ?? `${client.canonical_name} — ${slot.date}`,
      status: 'draft',
      content_type: normalizeContentType(slot.content_type),
      platforms: JSON.stringify(platforms),
      publish_date: `${slot.date}T${postTime}`,
      scheduled_by_automation: 1,
      platform_manual_override: 0,
      automation_slot_key: slot.slot_key,
      generation_run_id: runId,
      ...blogGbpDefaults,
      ...merged,
    } as Parameters<typeof createPost>[1]);
    await updatePost(db, createdPost.id, {
      monthly_topic_id: selectedTopic.monthlyTopicId,
      topic_fingerprint: selectedTopic.topicFingerprint,
      topic_service_category: selectedTopic.serviceCategory,
      ...blogGbpDefaults,
    });
    savedPostId = createdPost.id;
    outcome = 'created';
  }
  if (selectedTopic.monthlyTopicId && savedPostId) {
    await markClientMonthlyTopicUsed(db, selectedTopic.monthlyTopicId, savedPostId);
  }

  return finalizeSlotProgress(db, env, runId, slotIdx + 1, outcome, client.canonical_name, slots, async () => undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Execute one slot
//
// Called directly by POST /internal/gen-step.
// This function executes exactly one slot and returns the next orchestration
// state. It never dispatches the next step itself.
// ─────────────────────────────────────────────────────────────────────────────

export async function executeSlotWork(env: Env, run_id: string, slot_idx: number): Promise<SlotWorkResult> {
  const db = env.DB;
  const heartbeat = setInterval(() => {
    db.prepare('UPDATE generation_runs SET last_activity_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), run_id)
      .run()
      .catch(() => undefined);
  }, 20_000);

  async function log(level: Parameters<typeof appendGenerationLog>[2], msg: string) {
    console.log(`[gen:${run_id.slice(0, 8)}] slot${slot_idx} [${level}] ${msg}`);
    try { await appendGenerationLog(db, run_id, level, msg); } catch { /* */ }
  }

  async function recordError(message: string) {
    try { await appendGenerationError(db, run_id, message); } catch { /* ignore */ }
  }

  async function finishSlot(
    nextCompletedIdx: number,
    outcome: 'created' | 'updated' | 'skipped',
    clientName: string,
    slots: PostSlot[],
  ): Promise<SlotWorkResult> {
    return finalizeSlotProgress(db, env, run_id, nextCompletedIdx, outcome, clientName, slots, log);
  }

  let slots: PostSlot[] = [];
  let clientName = '';

  try {
    try {
      await db.prepare('UPDATE generation_runs SET last_activity_at = ? WHERE id = ?')
        .bind(Math.floor(Date.now() / 1000), run_id).run();
    } catch { /* ignore */ }

    const run = await getGenerationRunById(db, run_id);
    if (!run || run.status !== 'running') {
      await log('WARN', `Slot ${slot_idx}: skipped — status: ${run?.status ?? 'not found'}`);
      return { outcome: 'skipped' };
    }

    slots = JSON.parse(run.post_slots ?? '[]');
    const postTime = run.publish_time ?? '10:00';

    if (slot_idx >= slots.length) {
      await log('WARN', `Slot ${slot_idx} out of range (total ${slots.length}) — ignoring`);
      return { outcome: 'skipped' };
    }

    if ((run.current_slot_idx ?? 0) > slot_idx) {
      await log('WARN', `Slot ${slot_idx}: duplicate/stale dispatch — current_slot_idx=${run.current_slot_idx ?? 0}`);
      return { outcome: 'skipped' };
    }

    if ((run.current_slot_idx ?? 0) < slot_idx) {
      await log('WARN', `Slot ${slot_idx}: out-of-order dispatch — current_slot_idx=${run.current_slot_idx ?? 0}`);
      return { outcome: 'continue', nextSlot: run.current_slot_idx ?? 0, totalSlots: run.total_slots ?? slots.length };
    }

    const slot = slots[slot_idx];
    const postKey = `${slot.client_slug} / ${slot.date} / ${slot.content_type}`;
    clientName = slot.client_slug;
    const provider = normalizeContentProvider(slot.provider);

    await log('INFO', `Step ${slot_idx + 1}/${slots.length}: ${postKey} [${provider}]`);

    let slotOutcome: 'created' | 'updated' | 'skipped' = 'skipped';
    const settings = await loadSystemSettings(env);
    const apiKey = resolveProviderApiKey(env, settings, provider);

    try {
      if (!apiKey) throw new Error(provider === 'terminal' ? 'Terminal provider must run through the approved terminal job path' : 'Missing OpenAI API key');

      const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(slot.client_id).first<ClientRow>();
      if (!client) throw new Error(`Client not found: ${slot.client_slug}`);
      clientName = client.canonical_name;

      let pkg = DEFAULT_PACKAGE;
      if (client.package) {
        const p = await db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').bind(client.package).first<PackageRow>();
        if (p) pkg = p;
      }

      const [storedClientPlatforms, gbpLocations] = await Promise.all([
        getClientPlatforms(db, client.id),
        getClientGbpLocations(db, client.id),
      ]);
      const clientPlatforms = withImplicitGbpPlatform(
        withImplicitBlogPlatform(storedClientPlatforms, client, true),
        gbpLocations,
        client.id,
      );
      let packagePlatforms: string[] = [];
      try { packagePlatforms = JSON.parse(pkg.platforms_included); } catch { /* */ }
      const platformSelection = resolvePlatformSelection({
        contentType: slot.content_type,
        packagePlatforms,
        clientPlatforms,
      });
      const platforms = platformSelection.selected;
      if (platforms.length === 0) {
        await log('WARN', `${postKey}: no compatible platforms after content-type filtering`);
        return await finishSlot(slot_idx + 1, 'skipped', clientName, slots);
      }
      await log('INFO', `${postKey}: platforms=${platforms.join(', ')}`);

      const existingPost = await getPostByAutomationSlot(
        db,
        client.id,
        slot.slot_key,
        slot.date,
        normalizeContentType(slot.content_type),
      );
      const overwriteExisting = run.overwrite_existing === 1;

      if (existingPost?.status === 'posted') {
        await log('INFO', `${postKey}: existing post ${existingPost.id} is already posted — immutable, skipping`);
        return await finishSlot(slot_idx + 1, 'skipped', clientName, slots);
      }

      if (existingPost && !overwriteExisting && isPostContentComplete(existingPost, gbpLocations, platforms)) {
        await log('INFO', `${postKey}: existing post ${existingPost.id} already complete — skipping`);
        return await finishSlot(slot_idx + 1, 'skipped', clientName, slots);
      }

      const isHighQuality = slot.high_quality ?? false;

      // Parallel fetch: intelligence, feedback, recent posts, service areas, service names
      const [intelBase, fbRows, recRows, svcAreaRows, svcNameRows, topicHistory, restrictions] = await Promise.all([
        db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(client.id).first<IntelRow>().then(r => r ?? null),
        db.prepare('SELECT sentiment, message AS note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 10').bind(client.id).all<FeedbackRow>(),
        db.prepare(`SELECT id, title, master_caption, content_type FROM posts WHERE client_id = ? AND status NOT IN ('cancelled','failed') ORDER BY created_at DESC LIMIT 30`).bind(client.id).all<{id:string;title:string|null;master_caption:string|null;content_type:string|null}>(),
        db.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 8').bind(client.id).all<{city:string}>(),
        db.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 12').bind(client.id).all<{name:string}>(),
        getClientGenerationTopicHistory(db, client.id, 24),
        getClientRestrictions(db, client.id),
      ]);

      const recentRows = recRows.results.filter((row) => row.id !== existingPost?.id);
      const recentTitles  = recentRows.map(r => r.title ?? r.master_caption?.slice(0, 80) ?? '').filter(Boolean) as string[];
      const serviceAreas  = svcAreaRows.results.map(r => r.city);
      const serviceNames  = svcNameRows.results
        .map(r => r.name)
        .filter((service) => !findRestrictedContentPhrase(service, restrictions));
      const monthlyPlan = await getClientMonthlyContentPlan(db, client.id, planMonth(slot.date));
      const intel = applyMonthlyPlanToIntelligence(intelBase, monthlyPlan);
      const recentFormats = recentRows
        .map(r => detectFormatFromTitle(r.title ?? r.master_caption ?? ''))
        .filter((f): f is ContentFormat => f !== null);

      // Topic research — directs this post to a specific, non-repetitive, SEO-aware topic
      let topicSelection = existingPost && !overwriteExisting
        ? existingPostTopicSelection(existingPost, slot.content_type)
        : null;
      let topicResearch: TopicResearch | null = topicSelection
        ? getTopicResearchFromSelection(topicSelection, serviceAreas)
        : null;
      const skippedTopicIds: string[] = [];
      for (let attempt = 0; !topicSelection && attempt < 12; attempt++) {
        const candidate = await buildMonthlyTopicSelection(db, client.id, slot.date, slot.content_type, platforms, serviceAreas, skippedTopicIds);
        if (!candidate) break;
        const restrictedPhrase = findRestrictedContentPhrase(
          [candidate.topicTitle, candidate.targetKeyword, candidate.serviceCategory].filter(Boolean).join(' '),
          restrictions,
        );
        if (restrictedPhrase) {
          if (candidate.monthlyTopicId) skippedTopicIds.push(candidate.monthlyTopicId);
          continue;
        }
        const conflict = await findRecentTopicConflict(db, {
          clientId: client.id,
          candidateTitle: candidate.topicTitle,
          candidateKeyword: candidate.targetKeyword,
          candidateServiceCategory: candidate.serviceCategory,
          contentType: slot.content_type,
          topicFingerprint: candidate.topicFingerprint,
          publishDate: slot.date,
          excludePostId: existingPost?.id ?? null,
        });
        if (conflict && candidate.monthlyTopicId) {
          skippedTopicIds.push(candidate.monthlyTopicId);
          await markClientMonthlyTopicSkipped(db, candidate.monthlyTopicId, conflict.reason);
          await log('WARN', `${postKey}: skipped monthly topic "${candidate.topicTitle}" because ${conflict.reason}`);
          continue;
        }
        topicSelection = candidate;
        topicResearch = getTopicResearchFromSelection(candidate, serviceAreas);
        break;
      }
      if (!topicSelection && skippedTopicIds.length > 0) {
        await log('WARN', `${postKey}: no unique monthly topic remained after duplicate checks; falling back to research`);
      }
      try {
        if (!topicResearch) {
          topicResearch = await researchTopicWithProvider(provider, apiKey, {
          client: {
            slug: client.slug,
            canonical_name: client.canonical_name,
            industry:       client.industry,
            state:          client.state,
            language:       client.language,
          },
          intelligence: intel ? {
            service_priorities: intel.service_priorities,
            seasonal_notes:     intel.seasonal_notes,
            local_seo_themes:   intel.local_seo_themes,
          } : null,
          contentType:   slot.content_type,
          contentIntent: slot.content_intent,
          platforms,
          publishDate:   slot.date,
          recentTitles,
          recentFormats,
          serviceAreas,
          serviceNames,
          }, settings);
        }
        if (topicResearch) {
          await log('AI', `Topic: "${topicResearch.topic}" [${topicResearch.format}] kw: "${topicResearch.targetKeyword}" source=${topicSelection?.source ?? 'research'}`);
        }
      } catch (err) {
        await log('WARN', `Topic research failed (non-fatal): ${str(err)}`);
      }
      if (!topicSelection && topicResearch) {
        topicSelection = {
          monthlyTopicId: null,
          topicTitle: topicResearch.topic,
          targetKeyword: topicResearch.targetKeyword,
          targetLocality: topicResearch.localModifier || null,
          serviceCategory: null,
          topicFingerprint: buildTopicFingerprint({
            topic: topicResearch.topic,
            contentType: slot.content_type,
            targetKeyword: topicResearch.targetKeyword,
          }),
          source: 'research',
        };
      }
      if (topicResearch && findRestrictedContentPhrase(
        [topicResearch.topic, topicResearch.targetKeyword, topicResearch.searchQuestion].join(' '),
        restrictions,
      )) {
        topicResearch = null;
        topicSelection = null;
      }

      const [latestResearch, latestStrategy] = await Promise.all([
        getLatestClientResearch(db, client.id),
        getLatestClientStrategy(db, client.id),
      ]);
      const strategicContext = buildWeeklyMarketingStrategicContext({
        client: {
          slug: client.slug,
          canonical_name: client.canonical_name,
          industry: client.industry,
          language: client.language,
        },
        topicHistory: mapTopicHistoryForContext(topicHistory),
        autonomousSignals: buildAutonomousResearchSignals(latestResearch, latestStrategy),
      });

      const ctx: GenerationContext = {
        client: {
          slug:                client.slug,
          canonical_name:      client.canonical_name,
          notes:               client.notes,
          brand_json:          client.brand_json,
          brand_primary_color: (client as unknown as {brand_primary_color?: string|null}).brand_primary_color ?? null,
          language:            client.language,
          phone:               client.phone,
          cta_text:            client.cta_text,
          industry:            client.industry,
          state:               client.state,
          owner_name:          client.owner_name,
          wp_template_key:     client.wp_template_key ?? client.wp_template ?? null,
        },
        intelligence:  intel,
        recentTitles,
        feedback:      fbRows.results,
        publishDate:   slot.date,
        contentType:   slot.content_type,
        platforms,
        contentIntent: slot.content_intent,
        gbpLocations: gbpLocations
          .filter((location) => location.paused !== 1)
          .map((location) => ({
            label: location.label,
            captionField: getGbpCaptionField(location),
          }))
          .filter((location) => Boolean(location.captionField)),
        topicResearch,
        serviceAreas,
        serviceNames,
        restrictions,
        recentFormats,
        highQuality: isHighQuality,
        strategicContext,
      };

      const isBlogSlot = normalizeContentType(slot.content_type) === 'blog';
      const genTimeoutMs = isBlogSlot ? 140_000 : (isHighQuality ? 60_000 : 30_000);
      await log('AI', `${getProviderDisplayName(provider)} start: ${postKey} (${slot.content_intent}${isHighQuality ? '/HQ' : ''}) — ${platforms.length} platforms`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`${getProviderDisplayName(provider)} ${genTimeoutMs / 1000}s timeout`)), genTimeoutMs);
      let genResult: Awaited<ReturnType<typeof generateWithProvider>>;
      try {
        genResult = await generateWithProvider(provider, apiKey, ctx, settings, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      await log('AI', `${getProviderDisplayName(provider)} done: ${postKey} (${genResult.meta.elapsedMs}ms, attempts=${genResult.meta.attempts}, model=${genResult.meta.model})`);

      // Quality validation — soft check, log warnings but never block saves
      const qualityResult = validateGeneratedContent(genResult.post, ctx);
      if (!qualityResult.passed) {
        await log('WARN', `Quality flags for "${genResult.post.title?.slice(0, 50)}": ${qualityResult.warnings.join('; ')}`);
      }

      await log('INFO', `Save start: ${postKey}`);
      const saveStarted = Date.now();
      const p = genResult.post as unknown as Record<string, string | undefined>;
      const merged = mergeGeneratedContent(existingPost as unknown as Record<string, string | null | undefined>, p, overwriteExisting);

      // Blog posts get LEARN_MORE GBP CTA pre-set; URL placeholder filled after WordPress publish
      const blogGbpDefaults = isBlogSlot
        ? { gbp_cta_type: 'LEARN_MORE' as string, gbp_topic_type: 'STANDARD' as string }
        : {};

      const duplicateConflict = await findRecentTopicConflict(db, {
        clientId: client.id,
        candidateTitle: merged.title ?? genResult.post.title ?? '',
        candidateKeyword: merged.target_keyword ?? genResult.post.target_keyword ?? '',
        candidateCaption: merged.master_caption ?? genResult.post.master_caption ?? '',
        candidateServiceCategory: topicSelection?.serviceCategory,
        contentType: normalizeContentType(slot.content_type),
        topicFingerprint: topicSelection?.topicFingerprint,
        publishDate: `${slot.date}T${postTime}`,
        excludePostId: existingPost?.id ?? null,
      });
      const targetPost = existingPost;

      if (targetPost) {
        const nextPlatforms = targetPost.platform_manual_override === 1 && parsePlatforms(targetPost.platforms).length > 0
          ? parsePlatforms(targetPost.platforms)
          : platforms;
        await updatePost(db, targetPost.id, {
          title: merged.title,
          content_type: normalizeContentType(slot.content_type),
          platforms: JSON.stringify(nextPlatforms),
          publish_date: targetPost.publish_date ?? `${slot.date}T${postTime}`,
          platform_manual_override: targetPost.platform_manual_override ?? 0,
          automation_slot_key: slot.slot_key,
          generation_run_id: run_id,
          scheduled_by_automation: 1,
          monthly_topic_id: topicSelection?.monthlyTopicId ?? null,
          topic_fingerprint: topicSelection?.topicFingerprint ?? null,
          topic_service_category: topicSelection?.serviceCategory ?? null,
          ...blogGbpDefaults,
          ...merged,
        });
        slotOutcome = 'updated';
        if (topicSelection?.monthlyTopicId) {
          await markClientMonthlyTopicUsed(db, topicSelection.monthlyTopicId, targetPost.id);
        }
        await log('SAVED', `Updated post ${targetPost.id} for ${postKey}`);
      } else if (duplicateConflict) {
        if (topicSelection?.monthlyTopicId) {
          await markClientMonthlyTopicSkipped(db, topicSelection.monthlyTopicId, duplicateConflict.reason);
        }
        throw new Error(`Generated slot duplicates existing post ${duplicateConflict.post.id}: ${duplicateConflict.reason}`);
      } else {
        const createdPost = await createPost(db, {
          client_id:           client.id,
          title:               merged.title ?? `${client.canonical_name} — ${slot.date}`,
          status:              'draft',
          content_type:        normalizeContentType(slot.content_type),
          platforms:           JSON.stringify(platforms),
          publish_date:        `${slot.date}T${postTime}`,
          scheduled_by_automation: 1,
          platform_manual_override: 0,
          automation_slot_key: slot.slot_key,
          generation_run_id:   run_id,
          ...blogGbpDefaults,
          ...merged,
        } as Parameters<typeof createPost>[1]);
        await updatePost(db, createdPost.id, {
          monthly_topic_id: topicSelection?.monthlyTopicId ?? null,
          topic_fingerprint: topicSelection?.topicFingerprint ?? null,
          topic_service_category: topicSelection?.serviceCategory ?? null,
          ...blogGbpDefaults,
        });
        slotOutcome = 'created';
        if (topicSelection?.monthlyTopicId) {
          await markClientMonthlyTopicUsed(db, topicSelection.monthlyTopicId, createdPost.id);
        }
        await log('SAVED', `Created post ${slot_idx + 1}/${slots.length}: "${genResult.post.title?.slice(0, 55) ?? '(no title)'}" — ${slot.client_slug}`);
      }
      await log('INFO', `Save done: ${postKey} (${Date.now() - saveStarted}ms)`);
    } catch (err) {
      await log('ERROR', `${postKey}: ${str(err)}`);
      await recordError(`${postKey}\n${detail(err)}`);
    }

    return await finishSlot(slot_idx + 1, slotOutcome, clientName, slots);
  } catch (err) {
    console.error(`[gen:${run_id.slice(0, 8)}] slot${slot_idx} UNHANDLED:`, err);
    await log('ERROR', `slot${slot_idx} UNHANDLED: ${str(err)}`);
    await recordError(`slot${slot_idx} UNHANDLED\n${detail(err)}`);
    if (slots.length > 0 && slot_idx < slots.length) {
      return await finishSlot(slot_idx + 1, 'skipped', clientName || slots[slot_idx]?.client_slug || '', slots);
    }
    return { outcome: 'skipped' };
  } finally {
    clearInterval(heartbeat);
  }
}
