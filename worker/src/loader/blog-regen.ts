/**
 * Blog regen — regenerates ALL existing blog posts with the high-quality SEO system.
 *
 * Architecture mirrors generation-run.ts: each /internal/blog-regen-step call
 * handles exactly one post, then queues the next via waitUntil.
 *
 * Per-post flow:
 *  1. Load post + client + intelligence + service areas
 *  2. Run researchTopic() — picks fresh, specific, locally-relevant topic
 *  3. Run generatePostContent() (gpt-4o, highQuality=true)
 *  4. Update DB: overwrite all content fields; preserve slug for published posts
 *  5. If post is already published on WordPress: push updated content live
 *  6. Replace [blog_url] in captions with real URL (for published posts)
 */

import type { Env, ClientRow } from '../types';
import {
  getPostById,
  updatePost,
  appendGenerationLog,
  appendGenerationError,
  finalizeGenerationRun,
  getGenerationRunById,
} from '../db/queries';
import {
  generatePostContent,
  researchTopic,
  validateGeneratedContent,
  detectFormatFromTitle,
  type GenerationContext,
  type ContentFormat,
  type TopicResearch,
} from '../services/openai';
import { publishBlogPost } from '../modules/blog-publishing';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BlogRegenSlot {
  post_id:          string;
  client_id:        string;
  client_slug:      string;
  original_title:   string;
  original_keyword: string | null;
  existing_slug:    string | null;
  is_published:     boolean;
  wp_post_id:       number | null;
  wp_post_url:      string | null;
  wp_post_status:   string | null;
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

export interface BlogRegenSlotResult {
  outcome:   'skipped' | 'continue' | 'completed';
  nextSlot?: number;
  total?:    number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

async function loadSystemSettings(env: Env): Promise<Record<string, string>> {
  try {
    const raw = await env.KV_BINDING.get('settings:system');
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch { return {}; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-dispatch (same pattern as generation-run.ts)
// ─────────────────────────────────────────────────────────────────────────────

export async function triggerBlogRegenStep(
  env: Env,
  baseUrl: string,
  runId: string,
  slotIdx: number,
): Promise<void> {
  const selfFetcher = (env as unknown as { SELF?: { fetch: (req: Request) => Promise<Response> } }).SELF;
  const targetUrl   = selfFetcher
    ? 'https://self/internal/blog-regen-step'
    : `${baseUrl}/internal/blog-regen-step`;
  const isLocal = !selfFetcher && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl);

  if (!selfFetcher && !isLocal) {
    throw new Error('SELF service binding unavailable; refusing public self-fetch for blog-regen-step in production');
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const req = new Request(targetUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id: runId, slot_idx: slotIdx }),
      });
      const res = selfFetcher
        ? await selfFetcher.fetch(req)
        : await fetch(req, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`blog-regen-step returned ${res.status}: ${text.slice(0, 200)}`);
      }
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 3) await sleep(attempt * 250);
    }
  }
  throw lastError ?? new Error('Unknown blog-regen-step dispatch error');
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Plan: enumerate blog posts, store as slots, dispatch slot 0
// ─────────────────────────────────────────────────────────────────────────────

export async function planBlogRegen(
  env: Env,
  runId: string,
  params: { clientSlugs?: string[] },
  baseUrl: string,
): Promise<void> {
  const db = env.DB;

  const log = async (level: Parameters<typeof appendGenerationLog>[2], msg: string) => {
    console.log(`[blog-regen:${runId.slice(0, 8)}] [${level}] ${msg}`);
    try { await appendGenerationLog(db, runId, level, msg); } catch { /* */ }
  };

  try {
    await log('START', 'Blog regen planning started');

    const settings = await loadSystemSettings(env);
    const apiKey   = env.OPENAI_API_KEY || settings.ai_api_key || '';
    if (!apiKey) throw new Error('Missing OpenAI API key — set OPENAI_API_KEY secret');

    // Enumerate blog posts — newest first, optionally filtered by client
    const clientFilter = params.clientSlugs && params.clientSlugs.length > 0;
    const filterClause = clientFilter
      ? `AND c.slug IN (${params.clientSlugs!.map(() => '?').join(',')})`
      : '';

    const rows = await db
      .prepare(`
        SELECT p.id, p.client_id, p.title, p.target_keyword, p.slug,
               p.wp_post_id, p.wp_post_url, p.wp_post_status,
               c.slug AS client_slug
        FROM   posts p
        JOIN   clients c ON c.id = p.client_id
        WHERE  p.content_type = 'blog'
          AND  p.status NOT IN ('cancelled')
          ${filterClause}
        ORDER  BY p.created_at DESC
      `)
      .bind(...(clientFilter ? params.clientSlugs! : []))
      .all<{
        id: string; client_id: string; title: string | null; target_keyword: string | null;
        slug: string | null; wp_post_id: number | null; wp_post_url: string | null;
        wp_post_status: string | null; client_slug: string;
      }>();

    if (rows.results.length === 0) throw new Error('No blog posts found');

    const slots: BlogRegenSlot[] = rows.results.map(r => ({
      post_id:          r.id,
      client_id:        r.client_id,
      client_slug:      r.client_slug,
      original_title:   r.title ?? '',
      original_keyword: r.target_keyword,
      existing_slug:    r.slug,
      is_published:     Boolean(r.wp_post_id),
      wp_post_id:       r.wp_post_id,
      wp_post_url:      r.wp_post_url,
      wp_post_status:   r.wp_post_status,
    }));

    const publishedCount = slots.filter(s => s.is_published).length;
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(`UPDATE generation_runs
                SET post_slots = ?, total_slots = ?, status = 'running', started_at = ?, last_activity_at = ?
                WHERE id = ?`)
      .bind(JSON.stringify(slots), slots.length, now, now, runId)
      .run();

    await log('INFO', `${slots.length} blogs queued (${publishedCount} published → WP will also be updated)`);
    await log('INFO', 'Dispatching slot 0');
    await triggerBlogRegenStep(env, baseUrl, runId, 0);
    await log('INFO', 'Slot 0 dispatched');

  } catch (err) {
    const msg = `Fatal (planning): ${str(err)}`;
    await log('ERROR', msg);
    await finalizeGenerationRun(db, runId, 'failed', 0, msg);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Execute one slot: regenerate one blog post
// ─────────────────────────────────────────────────────────────────────────────

export async function executeBlogRegenSlot(
  env: Env,
  runId: string,
  slotIdx: number,
): Promise<BlogRegenSlotResult> {
  const db = env.DB;

  const log = async (level: Parameters<typeof appendGenerationLog>[2], msg: string) => {
    console.log(`[blog-regen:${runId.slice(0, 8)}] slot${slotIdx} [${level}] ${msg}`);
    try { await appendGenerationLog(db, runId, level, msg); } catch { /* */ }
  };

  const recordError = async (msg: string) => {
    try { await appendGenerationError(db, runId, msg); } catch { /* */ }
  };

  const advance = async (outcome: 'updated' | 'skipped', total: number): Promise<BlogRegenSlotResult> => {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(`UPDATE generation_runs
                SET current_slot_idx = ?,
                    posts_updated    = posts_updated + ?,
                    last_activity_at = ?
                WHERE id = ?`)
      .bind(slotIdx + 1, outcome === 'updated' ? 1 : 0, now, runId)
      .run();

    const next = slotIdx + 1;
    if (next >= total) {
      await finalizeGenerationRun(db, runId, 'completed', 0, null);
      await log('DONE', `Blog regen complete — ${total} posts processed`);
      return { outcome: 'completed', total };
    }
    return { outcome: 'continue', nextSlot: next, total };
  };

  let totalSlots = 0;

  try {
    await db
      .prepare('UPDATE generation_runs SET last_activity_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), runId)
      .run();

    const run = await getGenerationRunById(db, runId);
    if (!run || run.status !== 'running') {
      await log('WARN', `Slot ${slotIdx}: skipped — status: ${run?.status ?? 'not found'}`);
      return { outcome: 'skipped' };
    }

    const slots: BlogRegenSlot[] = JSON.parse(run.post_slots ?? '[]');
    totalSlots = run.total_slots ?? slots.length;

    if (slotIdx >= slots.length) {
      await log('WARN', `Slot ${slotIdx} out of range (${slots.length})`);
      return { outcome: 'skipped' };
    }

    const slot = slots[slotIdx];
    await log('INFO', `${slotIdx + 1}/${totalSlots}: "${slot.original_title.slice(0, 60)}" [${slot.client_slug}]${slot.is_published ? ' ★ published' : ''}`);

    const settings = await loadSystemSettings(env);
    const apiKey   = env.OPENAI_API_KEY || settings.ai_api_key || '';
    if (!apiKey) {
      await log('ERROR', 'Missing OpenAI API key — skipping slot');
      return await advance('skipped', totalSlots);
    }

    const post = await getPostById(db, slot.post_id);
    if (!post) {
      await log('WARN', `Post ${slot.post_id} not found in DB — skipping`);
      return await advance('skipped', totalSlots);
    }

    const client = await db
      .prepare('SELECT * FROM clients WHERE id = ?')
      .bind(slot.client_id)
      .first<ClientRow>();
    if (!client) {
      await log('WARN', `Client ${slot.client_id} not found — skipping`);
      return await advance('skipped', totalSlots);
    }

    // Parallel context fetch
    const [intel, fbRows, recRows, svcAreaRows, svcNameRows] = await Promise.all([
      db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?')
        .bind(client.id).first<IntelRow>().then(r => r ?? null),
      db.prepare('SELECT sentiment, message AS note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 8')
        .bind(client.id).all<{ sentiment: string; note: string }>(),
      db.prepare(`SELECT title, master_caption FROM posts
                  WHERE client_id = ? AND id != ? AND content_type = 'blog'
                    AND status NOT IN ('cancelled')
                  ORDER BY created_at DESC LIMIT 20`)
        .bind(client.id, slot.post_id).all<{ title: string | null; master_caption: string | null }>(),
      db.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 8')
        .bind(client.id).all<{ city: string }>(),
      db.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 12')
        .bind(client.id).all<{ name: string }>(),
    ]);

    const recentTitles  = recRows.results.map(r => r.title ?? r.master_caption?.slice(0, 80) ?? '').filter(Boolean) as string[];
    const serviceAreas  = svcAreaRows.results.map(r => r.city);
    const serviceNames  = svcNameRows.results.map(r => r.name);
    const recentFormats = recRows.results
      .map(r => detectFormatFromTitle(r.title ?? ''))
      .filter((f): f is ContentFormat => f !== null);

    // For published posts, use the established keyword as a primary signal
    const effectiveIntel: typeof intel = intel
      ? { ...intel, primary_keyword: slot.original_keyword ?? intel.primary_keyword }
      : (slot.original_keyword ? { primary_keyword: slot.original_keyword } as IntelRow : null);

    // Topic research
    let topicResearch: TopicResearch | null = null;
    try {
      topicResearch = await researchTopic(apiKey, {
        client: {
          canonical_name: client.canonical_name,
          industry:       client.industry,
          state:          client.state,
          language:       client.language,
        },
        intelligence: effectiveIntel ? {
          service_priorities: effectiveIntel.service_priorities,
          seasonal_notes:     effectiveIntel.seasonal_notes,
          local_seo_themes:   effectiveIntel.local_seo_themes,
        } : null,
        contentType:   'blog',
        contentIntent: 'educational',
        platforms:     ['website_blog'],
        publishDate:   post.publish_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        recentTitles,
        recentFormats,
        serviceAreas,
        serviceNames,
      });
      if (topicResearch) {
        await log('AI', `Topic: "${topicResearch.topic}" [${topicResearch.format}] kw: "${topicResearch.targetKeyword}"`);
      }
    } catch (err) {
      await log('WARN', `Topic research failed (non-fatal): ${str(err)}`);
    }

    const ctx: GenerationContext = {
      client: {
        canonical_name:      client.canonical_name,
        notes:               client.notes,
        brand_json:          client.brand_json,
        brand_primary_color: (client as ClientRow & { brand_primary_color?: string | null }).brand_primary_color ?? null,
        language:            client.language,
        phone:               client.phone,
        cta_text:            client.cta_text,
        industry:            client.industry,
        state:               client.state,
        owner_name:          client.owner_name,
        wp_template_key:     client.wp_template_key ?? client.wp_template ?? null,
      },
      intelligence:  effectiveIntel as GenerationContext['intelligence'],
      recentTitles,
      feedback:      fbRows.results,
      publishDate:   post.publish_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      contentType:   'blog',
      platforms:     ['website_blog'],
      contentIntent: 'educational',
      topicResearch,
      serviceAreas,
      serviceNames,
      recentFormats,
      highQuality:   true,
    };

    await log('AI', `GPT-4o generating blog (5500 tok budget)…`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Blog regen 130s timeout')), 130_000);
    let genResult: Awaited<ReturnType<typeof generatePostContent>>;
    try {
      genResult = await generatePostContent(apiKey, ctx, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    await log('AI', `Done: ${genResult.meta.elapsedMs}ms, model=${genResult.meta.model}, attempts=${genResult.meta.attempts}`);

    const quality = validateGeneratedContent(genResult.post, ctx);
    if (!quality.passed) {
      await log('WARN', `Quality flags: ${quality.warnings.join('; ')}`);
    }

    const p = genResult.post;
    const blogUrl  = slot.wp_post_url;

    // Replace [blog_url] in captions with the real URL for already-published posts
    const withUrl = (v: string | undefined): string | null => {
      if (!v) return null;
      return blogUrl ? v.replace(/\[blog_url\]/g, blogUrl) : v;
    };

    // For published posts: preserve the live slug (changing it would break existing URLs)
    const finalSlug = (slot.is_published && slot.existing_slug) ? slot.existing_slug : (p.slug ?? slot.existing_slug ?? null);

    await updatePost(db, slot.post_id, {
      title:               p.title              ?? null,
      master_caption:      p.master_caption     ?? null,
      blog_content:        p.blog_content       ?? null,
      blog_excerpt:        p.blog_excerpt       ?? null,
      seo_title:           p.seo_title          ?? null,
      meta_description:    p.meta_description   ?? null,
      target_keyword:      p.target_keyword     ?? null,
      secondary_keywords:  p.secondary_keywords ?? null,
      slug:                finalSlug,
      ai_image_prompt:     p.ai_image_prompt    ?? null,
      cap_google_business: withUrl(p.cap_google_business ?? undefined),
      cap_linkedin:        withUrl(p.cap_linkedin        ?? undefined),
      cap_facebook:        withUrl(p.cap_facebook        ?? undefined),
      gbp_cta_type:        'LEARN_MORE',
      gbp_topic_type:      'STANDARD',
      gbp_cta_url:         blogUrl ?? null,
    });
    await log('SAVED', `DB updated: "${p.title?.slice(0, 55)}" → ${finalSlug ?? '(no slug)'}`);

    // For already-published posts: push new content live to WordPress
    if (slot.is_published && slot.wp_post_id) {
      try {
        await log('INFO', `Pushing to WordPress (wp_post_id=${slot.wp_post_id})…`);
        const wpStatus = slot.wp_post_status === 'publish' ? 'publish' : ('draft' as const);
        await publishBlogPost(env, slot.post_id, { status: wpStatus });
        await log('INFO', `WordPress updated successfully`);
      } catch (err) {
        await log('WARN', `WordPress push failed (non-fatal, content saved in DB): ${str(err)}`);
        await recordError(`WP push for ${slot.post_id}: ${detail(err)}`);
      }
    }

    return await advance('updated', totalSlots);

  } catch (err) {
    console.error(`[blog-regen:${runId.slice(0, 8)}] slot${slotIdx} UNHANDLED:`, err);
    await log('ERROR', `Unhandled: ${str(err)}`);
    await recordError(`slot${slotIdx} UNHANDLED\n${detail(err)}`);
    return await advance('skipped', totalSlots || 1);
  }
}
