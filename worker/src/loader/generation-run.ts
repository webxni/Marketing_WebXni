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

import type { Env } from '../types';
import type { ClientRow, PostRow } from '../types';
import {
  buildWeeklyMarketingStrategicContext,
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
  type GenerationProgress,
  buildTopicFingerprint,
} from '../db/queries';
import {
  buildGenerationRequest,
  validateGeneratedContent,
  detectFormatFromTitle,
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

function buildDates(
  periodStart: string, periodEnd: string,
  frequency: string, postingDays: string | null,
  weeklySchedule?: string | null,
): string[] {
  if (weeklySchedule) {
    const sched = parseWeeklySchedule(weeklySchedule);
    if (sched && Object.keys(sched).length > 0) {
      const activeDayNums = new Set(Object.keys(sched).map(d => DAY_NAME_TO_NUM[d]).filter(n => n !== undefined));
      return buildDatesRaw(periodStart, periodEnd, frequency, activeDayNums);
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

function getMonthlySequenceTypeForDate(
  pkg: PackageRow,
  date: string,
): string {
  const month = planMonth(date);
  const { start, end } = getMonthBounds(month);
  const monthDates = buildDates(start, end, pkg.posting_frequency, pkg.posting_days ?? null, pkg.weekly_schedule ?? null);
  const dateIndex = Math.max(0, monthDates.indexOf(date));
  const sequence = buildContentSequence(pkg);
  return sequence[dateIndex % sequence.length] ?? 'image';
}

async function buildMonthlyTopicSelection(
  db: D1Database,
  clientId: string,
  date: string,
  contentType: string,
  platforms: string[],
  _serviceAreas: string[],
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
    localModifier: serviceAreas[0] ?? '',
    searchQuestion: selection.notes?.trim() || (selection.topicTitle ?? ''),
  };
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
              SET current_slot_idx = ?,
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

  if (!updated) return { outcome: 'skipped' };

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

  if (updated.current_slot_idx >= updated.total_slots) {
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
    return { outcome: 'completed', totalSlots: updated.total_slots };
  }

  return { outcome: 'continue', nextSlot: updated.current_slot_idx, totalSlots: updated.total_slots };
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
  let intentEduc = 0;
  let intentSales = 0;

  for (const client of clients) {
    let pkg = DEFAULT_PACKAGE;
    if (client.package) {
      const row = await db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').bind(client.package).first<PackageRow>();
      if (row) pkg = row;
    }

    const weeklySchedule = parseWeeklySchedule(pkg.weekly_schedule ?? null);
    const dates = buildDates(params.period_start, params.period_end, pkg.posting_frequency, pkg.posting_days ?? null, pkg.weekly_schedule ?? null);

    for (const date of dates) {
      const dayName = getDayName(date);
      const contentTypes = weeklySchedule
        ? (weeklySchedule[dayName] ?? ['image'])
        : [getMonthlySequenceTypeForDate(pkg, date)];

      for (const [dailyIndex, contentType] of contentTypes.entries()) {
        const totalSoFar = intentEduc + intentSales;
        const salesRatio = totalSoFar === 0 ? 0 : intentSales / totalSoFar;
        const intent: 'educational' | 'sales' = salesRatio < 0.30 ? 'sales' : 'educational';
        slots.push({
          client_id: client.id,
          client_slug: client.slug,
          date,
          content_type: normalizeContentType(contentType),
          content_intent: intent,
          slot_key: getAutomationSlotKey(client.id, date, contentType, dailyIndex),
          high_quality: params.high_quality ?? false,
          provider,
        });
        if (intent === 'sales') intentSales++; else intentEduc++;
      }
    }
  }

  if (slots.length === 0) throw new Error('No posts to generate for this period and client selection');
  return { slots, clients };
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
    'secondary_keywords',
    'slug',
    'video_script',
    'ai_image_prompt',
    'ai_video_prompt',
  ];
  for (const key of keys) {
    next[key] = pickGeneratedValue(current[key], post[key], overwrite) ?? null;
  }
  return next;
}

function hasMaterializedSlotContent(post: PostRow | null | undefined): boolean {
  if (!post) return false;
  const contentType = normalizeContentType(post.content_type, post.asset_type);
  if (String(post.title ?? '').trim()) return true;
  if (String(post.master_caption ?? '').trim()) return true;
  if (contentType === 'blog' && String(post.blog_content ?? '').trim()) return true;
  if ((contentType === 'video' || contentType === 'reel') && String(post.video_script ?? '').trim()) return true;
  return false;
}

export interface SlotWorkResult {
  outcome: 'skipped' | 'continue' | 'completed';
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

  const clientPlatforms = withImplicitBlogPlatform(await getClientPlatforms(db, client.id), client);
  let packagePlatforms: string[] = [];
  try { packagePlatforms = JSON.parse(pkg.platforms_included); } catch { /* */ }
  const platformSelection = resolvePlatformSelection({
    contentType: slot.content_type,
    packagePlatforms,
    clientPlatforms,
  });
  const platforms = platformSelection.selected;
  if (platforms.length === 0) {
    console.warn(`[gen:${runId.slice(0, 8)}] skipping slot ${slotIdx + 1}/${slots.length} for ${slot.client_slug} ${slot.date} ${slot.content_type} — no compatible platforms`);
    return null;
  }

  const [intelBase, fbRows, recRows, svcAreaRows, svcNameRows, gbpLocations, topicHistory] = await Promise.all([
    db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(client.id).first<IntelRow>().then((row) => row ?? null),
    db.prepare('SELECT sentiment, message AS note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 10').bind(client.id).all<FeedbackRow>(),
    db.prepare(`SELECT title, master_caption, content_type FROM posts WHERE client_id = ? AND status NOT IN ('cancelled','failed') ORDER BY created_at DESC LIMIT 30`).bind(client.id).all<{title:string|null;master_caption:string|null;content_type:string|null}>(),
    db.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 8').bind(client.id).all<{city:string}>(),
    db.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 12').bind(client.id).all<{name:string}>(),
    getClientGbpLocations(db, client.id),
    getClientGenerationTopicHistory(db, client.id, 24),
  ]);

  const recentTitles  = recRows.results.map((row) => row.title ?? row.master_caption?.slice(0, 80) ?? '').filter(Boolean) as string[];
  const serviceAreas  = svcAreaRows.results.map((row) => row.city);
  const serviceNames  = svcNameRows.results.map((row) => row.name);
  const monthlyPlan = await getClientMonthlyContentPlan(db, client.id, planMonth(slot.date));
  const intel = applyMonthlyPlanToIntelligence(intelBase, monthlyPlan);
  const recentFormats = recRows.results
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
  };

  // Topic research drives non-repetitive, SEO-aware prompts. Terminal runs stay
  // terminal-only, so if there is no monthly topic selection and no API-backed
  // research provider, the prompt falls back to the client context alone.
  const primaryKey = resolveProviderApiKey(env, settings, provider);
  let topicResearch: TopicResearch | null = null;
  let topicSelection: SlotTopicSelection | null = null;
  const skippedTopicIds: string[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = await buildMonthlyTopicSelection(db, client.id, slot.date, slot.content_type, platforms, serviceAreas, skippedTopicIds);
    if (!candidate) break;
    const conflict = await findRecentTopicConflict(db, {
      clientId: client.id,
      candidateTitle: candidate.topicTitle,
      candidateKeyword: candidate.targetKeyword,
      candidateServiceCategory: candidate.serviceCategory,
      contentType: slot.content_type,
      topicFingerprint: candidate.topicFingerprint,
      publishDate: slot.date,
    });
    if (conflict && candidate.monthlyTopicId) {
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
      serviceCategory: null,
      topicFingerprint: buildTopicFingerprint({
        topic: topicResearch.topic,
        contentType: slot.content_type,
        targetKeyword: topicResearch.targetKeyword,
      }),
      source: 'research',
    };
  }

  const strategicContext = buildWeeklyMarketingStrategicContext({
    client: {
      slug: client.slug,
      canonical_name: client.canonical_name,
      industry: client.industry,
      language: client.language,
    },
    topicHistory: mapTopicHistoryForContext(topicHistory),
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
  const startIdx = Math.max(0, run.current_slot_idx ?? 0);
  const prepared: PreparedApprovedSlotRequest[] = [];

  for (let slotIdx = startIdx; slotIdx < slots.length; slotIdx++) {
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

  const clientPlatforms = withImplicitBlogPlatform(await getClientPlatforms(db, client.id), client);
  let pkg = DEFAULT_PACKAGE;
  if (client.package) {
    const row = await db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').bind(client.package).first<PackageRow>();
    if (row) pkg = row;
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
  const overwriteExisting = run.overwrite_existing === 1;
  const merged = mergeGeneratedContent(existingPost as unknown as Record<string, string | null | undefined>, generatedPost as unknown as Record<string, string | undefined>, overwriteExisting);
  const selectedTopic = topicSelection ?? {
    monthlyTopicId: null,
    topicTitle: generatedPost.title ?? merged.title ?? null,
    targetKeyword: generatedPost.target_keyword ?? merged.target_keyword ?? null,
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
  const duplicateDraftPost = duplicateConflict && ['draft', 'pending_approval', 'approved', 'ready'].includes(duplicateConflict.post.status ?? '')
    ? duplicateConflict.post
    : null;
  const targetPost = existingPost ?? duplicateDraftPost;
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
  if (selectedTopic.monthlyTopicId && outcome !== 'skipped') {
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

      const clientPlatforms = withImplicitBlogPlatform(await getClientPlatforms(db, client.id), client);
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
      const gbpLocations = await getClientGbpLocations(db, client.id);
      const overwriteExisting = run.overwrite_existing === 1;

      if (existingPost && !overwriteExisting && isPostContentComplete(existingPost, gbpLocations)) {
        await log('INFO', `${postKey}: existing post ${existingPost.id} already complete — skipping`);
        return await finishSlot(slot_idx + 1, 'skipped', clientName, slots);
      }

      if (existingPost && !overwriteExisting && hasMaterializedSlotContent(existingPost)) {
        await log('INFO', `${postKey}: existing post ${existingPost.id} already has generated content — reusing and advancing`);
        return await finishSlot(slot_idx + 1, 'skipped', clientName, slots);
      }

      const isHighQuality = slot.high_quality ?? false;

      // Parallel fetch: intelligence, feedback, recent posts, service areas, service names
      const [intelBase, fbRows, recRows, svcAreaRows, svcNameRows, topicHistory] = await Promise.all([
        db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(client.id).first<IntelRow>().then(r => r ?? null),
        db.prepare('SELECT sentiment, message AS note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 10').bind(client.id).all<FeedbackRow>(),
        db.prepare(`SELECT title, master_caption, content_type FROM posts WHERE client_id = ? AND status NOT IN ('cancelled','failed') ORDER BY created_at DESC LIMIT 30`).bind(client.id).all<{title:string|null;master_caption:string|null;content_type:string|null}>(),
        db.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 8').bind(client.id).all<{city:string}>(),
        db.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 12').bind(client.id).all<{name:string}>(),
        getClientGenerationTopicHistory(db, client.id, 24),
      ]);

      const recentTitles  = recRows.results.map(r => r.title ?? r.master_caption?.slice(0, 80) ?? '').filter(Boolean) as string[];
      const serviceAreas  = svcAreaRows.results.map(r => r.city);
      const serviceNames  = svcNameRows.results.map(r => r.name);
      const monthlyPlan = await getClientMonthlyContentPlan(db, client.id, planMonth(slot.date));
      const intel = applyMonthlyPlanToIntelligence(intelBase, monthlyPlan);
      const recentFormats = recRows.results
        .map(r => detectFormatFromTitle(r.title ?? r.master_caption ?? ''))
        .filter((f): f is ContentFormat => f !== null);

      // Topic research — directs this post to a specific, non-repetitive, SEO-aware topic
      let topicResearch: TopicResearch | null = null;
      let topicSelection: SlotTopicSelection | null = null;
      const skippedTopicIds: string[] = [];
      for (let attempt = 0; attempt < 12; attempt++) {
        const candidate = await buildMonthlyTopicSelection(db, client.id, slot.date, slot.content_type, platforms, serviceAreas, skippedTopicIds);
        if (!candidate) break;
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
          serviceCategory: null,
          topicFingerprint: buildTopicFingerprint({
            topic: topicResearch.topic,
            contentType: slot.content_type,
            targetKeyword: topicResearch.targetKeyword,
          }),
          source: 'research',
        };
      }

      const strategicContext = buildWeeklyMarketingStrategicContext({
        client: {
          slug: client.slug,
          canonical_name: client.canonical_name,
          industry: client.industry,
          language: client.language,
        },
        topicHistory: mapTopicHistoryForContext(topicHistory),
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
      const duplicateDraftPost = duplicateConflict && ['draft', 'pending_approval', 'approved', 'ready'].includes(duplicateConflict.post.status ?? '')
        ? duplicateConflict.post
        : null;
      const targetPost = existingPost ?? duplicateDraftPost;

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
        await log('WARN', `${postKey}: skipped because ${duplicateConflict.reason} (post ${duplicateConflict.post.id})`);
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
