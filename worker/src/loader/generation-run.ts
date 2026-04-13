/**
 * AI content generation loop.
 * Runs inside ctx.waitUntil() — generates draft posts for each client × date combo.
 */

import type { Env } from '../types';
import { listClients, getClientPlatforms, createPost } from '../db/queries';
import { generatePostContent, type GenerationContext } from '../services/openai';

export interface GenerationParams {
  run_id:          string;
  client_slugs:    string[];   // empty = all active clients
  period_start:    string;     // YYYY-MM-DD first day of period
  period_end:      string;     // YYYY-MM-DD last day of period
  triggered_by:    string;
}

interface PackageRow {
  id:                   string;
  slug:                 string;
  posting_days:         string | null;  // JSON: ["monday","wednesday","friday"]
  images_per_month:     number;
  videos_per_month:     number;
  reels_per_month:      number;
  blog_posts_per_month: number;
  platforms_included:   string;
  posting_frequency:    string;
}

/** Build an ordered content-type sequence from package counts */
function buildContentSequence(pkg: PackageRow): string[] {
  const seq: string[] = [];
  const img  = pkg.images_per_month      ?? 0;
  const vid  = pkg.videos_per_month      ?? 0;
  const reel = pkg.reels_per_month       ?? 0;
  const blog = pkg.blog_posts_per_month  ?? 0;
  const total = img + vid + reel + blog;
  if (total === 0) return ['image'];

  // Interleave types evenly using a bucket approach
  const buckets: { type: string; count: number; next: number }[] = [
    { type: 'image', count: img,  next: 0 },
    { type: 'video', count: vid,  next: 0 },
    { type: 'reel',  count: reel, next: 0 },
    { type: 'blog',  count: blog, next: 0 },
  ].filter(b => b.count > 0);

  // Assign evenly-spaced positions for each type
  for (const b of buckets) {
    for (let i = 0; i < b.count; i++) {
      seq.push(b.type);
    }
  }

  // Sort by interleaved index so types are evenly spread
  const positioned: { type: string; pos: number }[] = [];
  for (const b of buckets) {
    const spacing = total / b.count;
    for (let i = 0; i < b.count; i++) {
      positioned.push({ type: b.type, pos: spacing * i + spacing / 2 });
    }
  }
  positioned.sort((a, b) => a.pos - b.pos);
  return positioned.map(p => p.type);
}

const DAY_NAME_TO_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/**
 * Parse posting_days JSON string into sorted UTC day numbers.
 * Falls back to [1, 3] (Mon + Wed) if empty or invalid.
 */
function parsePostingDays(raw: string | null): number[] {
  if (!raw) return [1, 3];
  try {
    const names: string[] = JSON.parse(raw);
    const nums = names
      .map(n => DAY_NAME_TO_NUM[n.toLowerCase()])
      .filter(n => n !== undefined)
      .sort((a, b) => a - b);
    return nums.length > 0 ? nums : [1, 3];
  } catch {
    return [1, 3];
  }
}

/**
 * Build posting dates for the period using posting_days + frequency.
 *
 * - daily:     every calendar day in the period (ignores posting_days)
 * - weekly:    every occurrence of posting_days within the period
 * - biweekly:  posting_days on alternating weeks (weeks 0, 2, 4… from period start)
 */
function buildDates(periodStart: string, periodEnd: string, frequency: string, postingDays: string | null): string[] {
  const start = new Date(periodStart + 'T12:00:00Z');
  const end   = new Date(periodEnd   + 'T12:00:00Z');
  const dates: string[] = [];

  if (frequency === 'daily') {
    const d = new Date(start);
    while (d <= end) {
      dates.push(d.toISOString().split('T')[0]);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return dates;
  }

  const dayNums = new Set(parsePostingDays(postingDays));

  if (frequency === 'weekly') {
    const d = new Date(start);
    while (d <= end) {
      if (dayNums.has(d.getUTCDay())) dates.push(d.toISOString().split('T')[0]);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return dates;
  }

  if (frequency === 'biweekly') {
    // Find Monday on or before period_start to anchor week 0
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

  // Fallback (old frequency values: 3x_week, twice_weekly, monthly) — treat as weekly
  const d = new Date(start);
  while (d <= end) {
    if (dayNums.has(d.getUTCDay())) dates.push(d.toISOString().split('T')[0]);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
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

interface FeedbackRow {
  sentiment: string;
  note: string;
}

const DEFAULT_PACKAGE: PackageRow = {
  id: '', slug: 'default',
  posting_days: '["monday","wednesday"]',
  images_per_month: 6, videos_per_month: 1,
  reels_per_month: 1, blog_posts_per_month: 0,
  platforms_included: '["facebook","instagram"]',
  posting_frequency: 'weekly',
};

interface QueryContext {
  step: string;
  table?: string;
  query?: string;
}

const SETTINGS_KEY = 'settings:system';

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatContextError(
  clientSlug: string,
  context: QueryContext,
  err: unknown,
): string {
  const parts = [
    `client=${clientSlug}`,
    `step=${context.step}`,
  ];

  if (context.table) parts.push(`table=${context.table}`);
  if (context.query) parts.push(`query=${context.query.replace(/\s+/g, ' ').trim()}`);

  parts.push(`error=${stringifyError(err)}`);
  return parts.join(' | ');
}

async function loadSystemSettings(env: Env): Promise<Record<string, string>> {
  try {
    const raw = await env.KV_BINDING.get(SETTINGS_KEY);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
}

export async function runGeneration(env: Env, params: GenerationParams): Promise<void> {
  const db  = env.DB;
  const now = () => Math.floor(Date.now() / 1000);

  console.log('[gen] starting run', params.run_id, '— period:', params.period_start, '→', params.period_end);

  let posts_created = 0;
  const errors: string[] = [];

  try {
    const settings = await loadSystemSettings(env);
    const openAiApiKey = env.OPENAI_API_KEY || settings.ai_api_key || '';

    if (!openAiApiKey) {
      throw new Error('Missing OpenAI API key: neither env.OPENAI_API_KEY nor settings:system.ai_api_key is configured');
    }

    // ── 1. Resolve clients ──────────────────────────────────────────────────
    const allClients = await listClients(db, 'active');
    const clients = params.client_slugs.length > 0
      ? allClients.filter(c => params.client_slugs.includes(c.slug))
      : allClients;

    if (clients.length === 0) throw new Error('No matching active clients found');

    // ── 2. Loop per client ──────────────────────────────────────────────────
    for (const client of clients) {
      let setupContext: QueryContext = { step: 'initializing client setup' };

      try {
        // Load package for this client
        let pkg: PackageRow = DEFAULT_PACKAGE;
        if (client.package) {
          const query = 'SELECT * FROM packages WHERE slug = ? AND active = 1';
          setupContext = {
            step: 'load package',
            table: 'packages',
            query,
          };
          const p = await db
            .prepare(query)
            .bind(client.package)
            .first<PackageRow>();
          if (p) pkg = p;
        }

        // Build content-type sequence and dates from package
        const sequence = buildContentSequence(pkg);
        const dates    = buildDates(params.period_start, params.period_end, pkg.posting_frequency, pkg.posting_days ?? null);

        // Determine platforms from package (fall back to client's configured platforms)
        let defaultPlatforms: string[] = [];
        try { defaultPlatforms = JSON.parse(pkg.platforms_included); } catch { /* */ }
        if (defaultPlatforms.length === 0) {
          const query = 'SELECT * FROM client_platforms WHERE client_id = ?';
          setupContext = {
            step: 'load fallback client platforms',
            table: 'client_platforms',
            query,
          };
          const cp = await getClientPlatforms(db, client.id);
          defaultPlatforms = cp.map(p => p.platform);
        }
        if (defaultPlatforms.length === 0) defaultPlatforms = ['facebook', 'instagram'];

        // Load shared context once per client
        const intelQuery = 'SELECT * FROM client_intelligence WHERE client_id = ?';
        setupContext = {
          step: 'load client intelligence',
          table: 'client_intelligence',
          query: intelQuery,
        };
        const intel = await db
          .prepare(intelQuery)
          .bind(client.id)
          .first<IntelRow>() ?? null;

        const feedbackQuery = 'SELECT sentiment, message AS note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 10';
        setupContext = {
          step: 'load recent client feedback',
          table: 'client_feedback',
          query: feedbackQuery,
        };
        const fbRows = await db
          .prepare(feedbackQuery)
          .bind(client.id)
          .all<FeedbackRow>();

        // ── 3. Generate one post per date ───────────────────────────────────
        // Track 70/30 educational/sales balance per client
        let intentEduc = 0;
        let intentSales = 0;

        for (let di = 0; di < dates.length; di++) {
          const date        = dates[di];
          const contentType = sequence[di % sequence.length];

          // Determine content intent: maintain ~70% educational / 30% sales ratio
          const totalSoFar = intentEduc + intentSales;
          const salesRatio = totalSoFar === 0 ? 0 : intentSales / totalSoFar;
          const contentIntent: 'educational' | 'sales' = salesRatio < 0.30 ? 'sales' : 'educational';

          try {
            // Fresh recent titles each iteration to avoid generating the same topic again
            const recentRows = await db
              .prepare(
                `SELECT title, master_caption FROM posts
                 WHERE client_id = ? AND status NOT IN ('cancelled','failed')
                 ORDER BY created_at DESC LIMIT 25`,
              )
              .bind(client.id)
              .all<{ title: string | null; master_caption: string | null }>();
            const recentTitles = recentRows.results
              .map(r => r.title ?? r.master_caption?.slice(0, 80) ?? '')
              .filter(Boolean) as string[];

            const ctx: GenerationContext = {
              client: {
                canonical_name: client.canonical_name,
                notes:          client.notes,
                brand_json:     client.brand_json,
                language:       client.language,
                phone:          (client as unknown as { phone?: string | null }).phone ?? null,
                cta_text:       (client as unknown as { cta_text?: string | null }).cta_text ?? null,
                industry:       (client as unknown as { industry?: string | null }).industry ?? null,
                state:          (client as unknown as { state?: string | null }).state ?? null,
                owner_name:     (client as unknown as { owner_name?: string | null }).owner_name ?? null,
              },
              intelligence:  intel,
              recentTitles,
              feedback:      fbRows.results,
              publishDate:   date,
              contentType,
              platforms:     defaultPlatforms,
              contentIntent,
            };

            const generated = await generatePostContent(openAiApiKey, ctx);

            const g = generated as unknown as Record<string, string | undefined>;
            const caps: Record<string, string | null> = {};
            for (const key of [
              'cap_facebook','cap_instagram','cap_linkedin','cap_x',
              'cap_threads','cap_tiktok','cap_pinterest','cap_bluesky','cap_google_business',
            ]) {
              caps[key] = g[key] ?? null;
            }

            await createPost(db, {
              client_id:          client.id,
              title:              generated.title ?? `${client.canonical_name} — ${date}`,
              status:             'draft',
              content_type:       contentType,
              platforms:          JSON.stringify(defaultPlatforms),
              publish_date:       `${date}T09:00`,
              master_caption:     generated.master_caption ?? null,
              ...caps,
              youtube_title:       generated.youtube_title ?? null,
              youtube_description: generated.youtube_description ?? null,
              blog_content:        generated.blog_content ?? null,
              seo_title:           generated.seo_title ?? null,
              meta_description:    generated.meta_description ?? null,
              target_keyword:      generated.target_keyword ?? null,
              video_script:        generated.video_script ?? null,
              ai_image_prompt:     generated.ai_image_prompt ?? null,
              ai_video_prompt:     generated.ai_video_prompt ?? null,
            } as Parameters<typeof createPost>[1]);

            posts_created++;
            if (contentIntent === 'sales') intentSales++; else intentEduc++;
            console.log(`[gen] ✓ ${client.slug} / ${date} / ${contentType} / ${contentIntent}`);

          } catch (err) {
            const msg = `${client.slug}/${date}: ${stringifyError(err)}`;
            errors.push(msg);
            console.error('[gen] ✗', msg);
          }
        }
      } catch (err) {
        const msg = formatContextError(client.slug, setupContext, err);
        errors.push(msg);
        console.error('[gen] client setup error:', {
          client: client.slug,
          step: setupContext.step,
          table: setupContext.table ?? null,
          query: setupContext.query ?? null,
          error: stringifyError(err),
        });
      }
    }
  } catch (err) {
    errors.push(`Fatal: ${stringifyError(err)}`);
    console.error('[gen] fatal:', err);
  }

  // ── 3. Finalize run record ─────────────────────────────────────────────────
  const finalStatus = errors.length === 0
    ? 'completed'
    : posts_created > 0 ? 'completed_with_errors' : 'failed';

  await db
    .prepare(
      `UPDATE generation_runs
       SET status = ?, posts_created = ?, error_log = ?, completed_at = ?
       WHERE id = ?`,
    )
    .bind(finalStatus, posts_created, errors.length > 0 ? errors.join('\n') : null, now(), params.run_id)
    .run();

  console.log(`[gen] run ${params.run_id} done — ${posts_created} posts, ${errors.length} errors, status: ${finalStatus}`);
}
