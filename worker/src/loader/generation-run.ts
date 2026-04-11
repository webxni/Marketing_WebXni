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
  dates:           string[];   // YYYY-MM-DD array
  content_types:   string[];   // ['image','video','blog'] — cycles per date if multiple
  platform_filter: string[];   // [] = use each client's configured platforms
  triggered_by:    string;
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

export async function runGeneration(env: Env, params: GenerationParams): Promise<void> {
  const db  = env.DB;
  const now = () => Math.floor(Date.now() / 1000);

  console.log('[gen] starting run', params.run_id, '— clients:', params.client_slugs.length || 'all', '— dates:', params.dates.length);

  let posts_created = 0;
  const errors: string[] = [];

  try {
    // ── 1. Resolve clients ──────────────────────────────────────────────────
    const allClients = await listClients(db, 'active');
    const clients = params.client_slugs.length > 0
      ? allClients.filter(c => params.client_slugs.includes(c.slug))
      : allClients;

    if (clients.length === 0) {
      throw new Error('No matching active clients found');
    }

    // ── 2. Loop clients × dates ─────────────────────────────────────────────
    for (const client of clients) {
      for (let di = 0; di < params.dates.length; di++) {
        const date = params.dates[di];

        try {
          // Load intelligence
          const intel = await db
            .prepare('SELECT * FROM client_intelligence WHERE client_id = ?')
            .bind(client.id)
            .first<IntelRow>() ?? null;

          // Load recent post titles to avoid duplication
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

          // Load feedback
          const fbRows = await db
            .prepare(
              `SELECT sentiment, note FROM client_feedback
               WHERE client_id = ? ORDER BY created_at DESC LIMIT 10`,
            )
            .bind(client.id)
            .all<{ sentiment: string; note: string }>();

          // Determine platforms
          let platforms: string[];
          if (params.platform_filter.length > 0) {
            platforms = params.platform_filter;
          } else {
            const cp = await getClientPlatforms(db, client.id);
            platforms = cp.map(p => p.platform);
            if (platforms.length === 0) platforms = ['facebook', 'instagram'];
          }

          // Determine content type — cycle through content_types if multiple
          const contentType = params.content_types.length > 0
            ? params.content_types[di % params.content_types.length]
            : 'image';

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
            platforms,
          };

          const generated = await generatePostContent(env.OPENAI_API_KEY, ctx);

          // Build per-platform caption fields
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
            platforms:          JSON.stringify(platforms),
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
          } as Parameters<typeof createPost>[1]);

          posts_created++;
          console.log(`[gen] ✓ ${client.slug} / ${date} / ${contentType}`);

        } catch (err) {
          const msg = `${client.slug}/${date}: ${String(err)}`;
          errors.push(msg);
          console.error('[gen] ✗', msg);
        }
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
