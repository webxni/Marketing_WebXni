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
  posts_per_month:      number;
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

/** Generate publish dates for the period based on posting frequency and posts_per_month */
function buildDates(periodStart: string, periodEnd: string, frequency: string, postsPerMonth: number): string[] {
  const start  = new Date(periodStart + 'T12:00:00Z');
  const end    = new Date(periodEnd   + 'T12:00:00Z');
  const dates: string[] = [];

  // Days between Mon-Sat (skip Sunday for most frequencies)
  const postDays = new Set([1, 2, 3, 4, 5, 6]); // Mon-Sat

  const addDate = (d: Date) => {
    const iso = d.toISOString().split('T')[0];
    if (!dates.includes(iso)) dates.push(iso);
  };

  if (frequency === 'daily') {
    const d = new Date(start);
    while (d <= end) { if (postDays.has(d.getUTCDay())) addDate(d); d.setUTCDate(d.getUTCDate() + 1); }
  } else if (frequency === '3x_week') {
    const days3 = new Set([1, 3, 5]); // Mon, Wed, Fri
    const d = new Date(start);
    while (d <= end) { if (days3.has(d.getUTCDay())) addDate(d); d.setUTCDate(d.getUTCDate() + 1); }
  } else if (frequency === 'twice_weekly') {
    const days2 = new Set([2, 4]); // Tue, Thu
    const d = new Date(start);
    while (d <= end) { if (days2.has(d.getUTCDay())) addDate(d); d.setUTCDate(d.getUTCDate() + 1); }
  } else if (frequency === 'weekly') {
    const d = new Date(start);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); // advance to Monday
    while (d <= end) { addDate(d); d.setUTCDate(d.getUTCDate() + 7); }
  } else if (frequency === 'biweekly') {
    const d = new Date(start);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    while (d <= end) { addDate(d); d.setUTCDate(d.getUTCDate() + 14); }
  } else {
    // monthly / fallback — one per week up to posts_per_month
    const d = new Date(start);
    while (d <= end && dates.length < postsPerMonth) {
      if (postDays.has(d.getUTCDay())) addDate(d);
      d.setUTCDate(d.getUTCDate() + 7);
    }
  }

  // Cap at posts_per_month (proportional to period length vs 30 days)
  const periodDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const cap = Math.ceil(postsPerMonth * (periodDays / 30));
  return dates.slice(0, Math.max(cap, 1));
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

const DEFAULT_PACKAGE: PackageRow = {
  id: '', slug: 'default',
  posts_per_month: 8, images_per_month: 6, videos_per_month: 1,
  reels_per_month: 1, blog_posts_per_month: 0,
  platforms_included: '["facebook","instagram"]',
  posting_frequency: 'twice_weekly',
};

export async function runGeneration(env: Env, params: GenerationParams): Promise<void> {
  const db  = env.DB;
  const now = () => Math.floor(Date.now() / 1000);

  console.log('[gen] starting run', params.run_id, '— period:', params.period_start, '→', params.period_end);

  let posts_created = 0;
  const errors: string[] = [];

  try {
    // ── 1. Resolve clients ──────────────────────────────────────────────────
    const allClients = await listClients(db, 'active');
    const clients = params.client_slugs.length > 0
      ? allClients.filter(c => params.client_slugs.includes(c.slug))
      : allClients;

    if (clients.length === 0) throw new Error('No matching active clients found');

    // ── 2. Loop per client ──────────────────────────────────────────────────
    for (const client of clients) {
      try {
        // Load package for this client
        let pkg: PackageRow = DEFAULT_PACKAGE;
        if (client.package) {
          const p = await db
            .prepare('SELECT * FROM packages WHERE slug = ? AND active = 1')
            .bind(client.package)
            .first<PackageRow>();
          if (p) pkg = p;
        }

        // Build content-type sequence and dates from package
        const sequence = buildContentSequence(pkg);
        const dates    = buildDates(params.period_start, params.period_end, pkg.posting_frequency, pkg.posts_per_month);

        // Determine platforms from package (fall back to client's configured platforms)
        let defaultPlatforms: string[] = [];
        try { defaultPlatforms = JSON.parse(pkg.platforms_included); } catch { /* */ }
        if (defaultPlatforms.length === 0) {
          const cp = await getClientPlatforms(db, client.id);
          defaultPlatforms = cp.map(p => p.platform);
        }
        if (defaultPlatforms.length === 0) defaultPlatforms = ['facebook', 'instagram'];

        // Load shared context once per client
        const intel = await db
          .prepare('SELECT * FROM client_intelligence WHERE client_id = ?')
          .bind(client.id)
          .first<IntelRow>() ?? null;

        const fbRows = await db
          .prepare('SELECT sentiment, note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 10')
          .bind(client.id)
          .all<{ sentiment: string; note: string }>();

        // ── 3. Generate one post per date ───────────────────────────────────
        for (let di = 0; di < dates.length; di++) {
          const date        = dates[di];
          const contentType = sequence[di % sequence.length];

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
              },
              intelligence:  intel,
              recentTitles,
              feedback:      fbRows.results,
              publishDate:   date,
              contentType,
              platforms:     defaultPlatforms,
            };

            const generated = await generatePostContent(env.OPENAI_API_KEY, ctx);

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
            console.log(`[gen] ✓ ${client.slug} / ${date} / ${contentType}`);

          } catch (err) {
            const msg = `${client.slug}/${date}: ${String(err)}`;
            errors.push(msg);
            console.error('[gen] ✗', msg);
          }
        }
      } catch (err) {
        errors.push(`${client.slug} setup: ${String(err)}`);
        console.error('[gen] client error:', err);
      }
    }
  } catch (err) {
    errors.push(`Fatal: ${String(err)}`);
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
