/**
 * AI content generation — trigger-first chained-invocation architecture.
 *
 * Root problem: after a long-running outbound fetch (OpenAI ~20s) inside a
 * CF Workers waitUntil() context, the V8 event loop freezes.  Any subsequent
 * await — including SELF service-binding calls — never resolves.
 *
 * Fix: each /internal/gen-step request handler triggers the NEXT step
 * immediately (first and only outbound operation in the handler, always
 * reliable), then runs the current step's OpenAI work in waitUntil().
 * waitUntil() makes exactly ONE outbound connection (OpenAI) and then only
 * does D1 writes — no second connection, so the freeze never matters.
 *
 * Flow:
 *   POST /api/run/generate
 *     → planGeneration()              [DB reads + writes, computes slots]
 *     → triggerStep(slot 0)           [SELF.fetch — first connection, reliable]
 *         ↓ /internal/gen-step
 *         handler: triggerStep(slot 1) [first connection in this invocation]
 *         waitUntil: executeSlotWork(slot 0) [OpenAI + D1 writes only]
 *             ↓ /internal/gen-step
 *             handler: triggerStep(slot 2)
 *             waitUntil: executeSlotWork(slot 1)
 *                 ...
 */

import type { Env } from '../types';
import type { ClientRow } from '../types';
import {
  listClients,
  getClientPlatforms,
  createPost,
  updateGenerationProgress,
  appendGenerationLog,
  storeGenerationPlan,
  finalizeGenerationRun,
  getGenerationRunById,
  type GenerationProgress,
} from '../db/queries';
import { generatePostContent, type GenerationContext } from '../services/openai';

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
}

interface PostSlot {
  client_id:      string;
  client_slug:    string;
  date:           string;
  content_type:   string;
  content_intent: 'educational' | 'sales';
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadSystemSettings(env: Env): Promise<Record<string, string>> {
  try {
    const raw = await env.KV_BINDING.get('settings:system');
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch { return {}; }
}

function str(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

    const settings     = await loadSystemSettings(env);
    const openAiApiKey = env.OPENAI_API_KEY || settings.ai_api_key || '';
    if (!openAiApiKey) throw new Error('Missing OpenAI API key: set OPENAI_API_KEY secret or settings:system.ai_api_key');

    const allClients = await listClients(db, 'active');
    const clients = params.client_slugs.length > 0
      ? allClients.filter(c => params.client_slugs.includes(c.slug))
      : allClients;
    if (clients.length === 0) throw new Error('No matching active clients found');

    await log('INFO', `${clients.length} client(s): ${clients.map(c => c.slug).join(', ')}`);

    const slots: PostSlot[] = [];
    let intentEduc = 0;
    let intentSales = 0;

    for (const client of clients) {
      let pkg = DEFAULT_PACKAGE;
      if (client.package) {
        const p = await db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').bind(client.package).first<PackageRow>();
        if (p) pkg = p;
      }

      const weeklySchedule = parseWeeklySchedule(pkg.weekly_schedule ?? null);
      const dates = buildDates(params.period_start, params.period_end, pkg.posting_frequency, pkg.posting_days ?? null, pkg.weekly_schedule ?? null);
      const sequence = buildContentSequence(pkg);
      let seqIdx = 0;

      for (const date of dates) {
        const dayName      = getDayName(date);
        const contentTypes = weeklySchedule
          ? (weeklySchedule[dayName] ?? ['image'])
          : [sequence[seqIdx++ % sequence.length]];

        for (const contentType of contentTypes) {
          const totalSoFar = intentEduc + intentSales;
          const salesRatio = totalSoFar === 0 ? 0 : intentSales / totalSoFar;
          const intent: 'educational' | 'sales' = salesRatio < 0.30 ? 'sales' : 'educational';
          slots.push({ client_id: client.id, client_slug: client.slug, date, content_type: contentType, content_intent: intent });
          if (intent === 'sales') intentSales++; else intentEduc++;
        }
      }
    }

    if (slots.length === 0) throw new Error('No posts to generate for this period and client selection');

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
    await log('INFO', `Dispatch start: slot 0 / ${slots.length - 1}`);
    // triggerStep is called from the request handler of /api/run/generate,
    // which cascades: slot 0 handler triggers slot 1, slot 1 triggers slot 2, etc.
    // All triggers resolve quickly; then all waitUntil tasks run in parallel.
    await triggerStep(env, baseUrl, params.run_id, 0);
    await log('INFO', 'Dispatch success: slot 0');

  } catch (err) {
    const msg = `Fatal (planning): ${str(err)}`;
    await log('ERROR', msg);
    await finalizeGenerationRun(db, params.run_id, 'failed', 0, msg);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Execute one slot
//
// Called from POST /internal/gen-step waitUntil().
// The trigger for the NEXT step was already fired from the handler (before
// this function runs), so this function makes exactly ONE outbound connection
// (OpenAI) and then only does D1 writes.  No second connection → no freeze.
// ─────────────────────────────────────────────────────────────────────────────

export async function executeSlotWork(env: Env, run_id: string, slot_idx: number, baseUrl: string): Promise<void> {
  const db = env.DB;

  async function log(level: Parameters<typeof appendGenerationLog>[2], msg: string) {
    console.log(`[gen:${run_id.slice(0, 8)}] slot${slot_idx} [${level}] ${msg}`);
    try { await appendGenerationLog(db, run_id, level, msg); } catch { /* */ }
  }

  // Top-level catch: write any unhandled crash to the DB log.
  try {

  // Heartbeat — proves this function was entered.
  try {
    await db.prepare('UPDATE generation_runs SET last_activity_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), run_id).run();
  } catch { /* ignore */ }

  const run = await getGenerationRunById(db, run_id);
  if (!run || run.status !== 'running') {
    await log('WARN', `Slot ${slot_idx}: skipped — status: ${run?.status ?? 'not found'}`);
    return;
  }

  const slots:    PostSlot[] = JSON.parse(run.post_slots ?? '[]');
  const postTime: string     = run.publish_time ?? '10:00';

  if (slot_idx >= slots.length) {
    await log('WARN', `Slot ${slot_idx} out of range (total ${slots.length}) — ignoring`);
    return;
  }

  const slot    = slots[slot_idx];
  const postKey = `${slot.client_slug} / ${slot.date} / ${slot.content_type}`;
  let clientName = slot.client_slug;

  await log('INFO', `Step ${slot_idx + 1}/${slots.length}: ${postKey}`);

  let postCreated = false;
  let errorMsg:   string | null = null;
  const settings  = await loadSystemSettings(env);
  const apiKey    = env.OPENAI_API_KEY || settings.ai_api_key || '';

  try {
    if (!apiKey) throw new Error('Missing OpenAI API key');

    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(slot.client_id).first<ClientRow>();
    if (!client) throw new Error(`Client not found: ${slot.client_slug}`);
    clientName = client.canonical_name;

    // Package
    let pkg = DEFAULT_PACKAGE;
    if (client.package) {
      const p = await db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').bind(client.package).first<PackageRow>();
      if (p) pkg = p;
    }

    // Platforms
    let platforms: string[] = [];
    try { platforms = JSON.parse(pkg.platforms_included); } catch { /* */ }
    if (platforms.length === 0) {
      const cp = await getClientPlatforms(db, client.id);
      platforms = cp.map(p => p.platform);
    }
    if (platforms.length === 0) platforms = ['facebook', 'instagram'];

    // Context data
    const intel   = await db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(client.id).first<IntelRow>() ?? null;
    const fbRows  = await db.prepare('SELECT sentiment, message AS note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 10').bind(client.id).all<FeedbackRow>();
    const recRows = await db.prepare(`SELECT title, master_caption FROM posts WHERE client_id = ? AND status NOT IN ('cancelled','failed') ORDER BY created_at DESC LIMIT 10`).bind(client.id).all<{title:string|null;master_caption:string|null}>();
    const recentTitles = recRows.results.map(r => r.title ?? r.master_caption?.slice(0, 80) ?? '').filter(Boolean) as string[];

    const ctx: GenerationContext = {
      client: {
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
      },
      intelligence:  intel,
      recentTitles,
      feedback:      fbRows.results,
      publishDate:   slot.date,
      contentType:   slot.content_type,
      platforms,
      contentIntent: slot.content_intent,
    };

    // OpenAI — single outbound fetch per invocation (no second connection after this).
    await log('AI', `OpenAI start: ${postKey} (${slot.content_intent}) — ${platforms.length} platforms`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('OpenAI 30s timeout')), 30_000);
    let genResult: Awaited<ReturnType<typeof generatePostContent>>;
    try {
      genResult = await generatePostContent(apiKey, ctx, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    await log('AI', `OpenAI done: ${postKey} (${genResult.meta.elapsedMs}ms, attempts=${genResult.meta.attempts}, model=${genResult.meta.model})`);

    // Save post
    await log('INFO', `Save start: ${postKey}`);
    const saveStarted = Date.now();
    const p = genResult.post as unknown as Record<string, string | undefined>;
    const caps: Record<string, string | null> = {};
    for (const key of ['cap_facebook','cap_instagram','cap_linkedin','cap_x','cap_threads','cap_tiktok','cap_pinterest','cap_bluesky','cap_google_business'])
      caps[key] = p[key] ?? null;

    await createPost(db, {
      client_id:           client.id,
      title:               genResult.post.title ?? `${client.canonical_name} — ${slot.date}`,
      status:              'draft',
      content_type:        slot.content_type,
      platforms:           JSON.stringify(platforms),
      publish_date:        `${slot.date}T${postTime}`,
      master_caption:      genResult.post.master_caption ?? null,
      ...caps,
      youtube_title:       genResult.post.youtube_title       ?? null,
      youtube_description: genResult.post.youtube_description ?? null,
      blog_content:        genResult.post.blog_content        ?? null,
      blog_excerpt:        genResult.post.blog_excerpt        ?? null,
      slug:                genResult.post.slug                ?? null,
      seo_title:           genResult.post.seo_title           ?? null,
      meta_description:    genResult.post.meta_description    ?? null,
      target_keyword:      genResult.post.target_keyword      ?? null,
      video_script:        genResult.post.video_script        ?? null,
      ai_image_prompt:     genResult.post.ai_image_prompt     ?? null,
      ai_video_prompt:     genResult.post.ai_video_prompt     ?? null,
    } as Parameters<typeof createPost>[1]);
    await log('INFO', `Save done: ${postKey} (${Date.now() - saveStarted}ms)`);

    postCreated = true;
    await log('SAVED', `Post ${slot_idx + 1}/${slots.length}: "${genResult.post.title?.slice(0, 55) ?? '(no title)'}" — ${slot.client_slug}`);

  } catch (err) {
    errorMsg = `${postKey}: ${str(err)}`;
    await log('ERROR', errorMsg);
  }

  // Advance sequential progress after the slot finishes.
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE generation_runs
              SET current_slot_idx = ?,
                  posts_created    = posts_created + ?,
                  last_activity_at = ?
              WHERE id = ?`)
    .bind(slot_idx + 1, postCreated ? 1 : 0, now, run_id)
    .run();

  // Re-read to check if this was the last slot and to decide the next one.
  const updated = await db
    .prepare('SELECT current_slot_idx, total_slots, posts_created, error_log FROM generation_runs WHERE id = ?')
    .bind(run_id)
    .first<{ current_slot_idx: number; total_slots: number; posts_created: number; error_log: string | null }>();

  if (updated) {
    const progress: GenerationProgress = {
      current_client: clientName,
      current_post: updated.current_slot_idx < updated.total_slots
        ? `${slots[updated.current_slot_idx]?.date ?? ''} / ${slots[updated.current_slot_idx]?.content_type ?? ''}`.trim()
        : '',
      completed: updated.current_slot_idx,
      total_estimated: updated.total_slots,
      errors: errorMsg ? 1 : 0,
      clients_done: 0,
      clients_total: 0,
    };
    try { await updateGenerationProgress(db, run_id, progress); } catch { /* ignore */ }
  }

  if (updated && updated.current_slot_idx >= updated.total_slots) {
    const errLog     = errorMsg ? (updated.error_log ? updated.error_log + '\n' + errorMsg : errorMsg) : updated.error_log;
    const finalStatus = updated.posts_created > 0 ? (errLog ? 'completed_with_errors' : 'completed') : 'failed';
    await finalizeGenerationRun(db, run_id, finalStatus, updated.posts_created, errLog ?? null);
    await log('DONE', `Run complete: ${updated.posts_created}/${updated.total_slots} posts, status=${finalStatus}`);
  } else if (updated) {
    const nextSlot = updated.current_slot_idx;
    try {
      await log('INFO', `Next-step dispatch start: slot ${nextSlot + 1}/${updated.total_slots}`);
      await triggerStep(env, baseUrl, run_id, nextSlot);
      await log('INFO', `Next-step dispatch success: slot ${nextSlot + 1}/${updated.total_slots}`);
    } catch (err) {
      const trigMsg = `Trigger failed for slot ${nextSlot}: ${str(err)}`;
      await log('ERROR', trigMsg);
      const errLog = updated.error_log ? `${updated.error_log}\n${trigMsg}` : trigMsg;
      const finalStatus = updated.posts_created > 0 ? 'completed_with_errors' : 'failed';
      await finalizeGenerationRun(db, run_id, finalStatus, updated.posts_created, errLog);
    }
  }

  } catch (topErr) {
    // Unhandled crash — write directly to the DB log so it appears in the UI.
    const errMsg = topErr instanceof Error ? topErr.message : String(topErr);
    console.error(`[gen:${run_id.slice(0, 8)}] slot${slot_idx} UNHANDLED:`, topErr);
    try {
      const now = Math.floor(Date.now() / 1000);
      await db
        .prepare(`UPDATE generation_runs
                  SET execution_log = COALESCE(execution_log || char(10), '') || ?,
                      error_log     = COALESCE(error_log     || char(10), '') || ?,
                      last_activity_at = ?
                  WHERE id = ?`)
        .bind(
          `${new Date(now * 1000).toISOString().slice(0, 19)}Z [ERROR] slot${slot_idx} UNHANDLED: ${errMsg}`,
          errMsg,
          now,
          run_id,
        )
        .run();
    } catch { /* ignore */ }
  }
}
