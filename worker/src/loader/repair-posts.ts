import type { ClientGbpLocationRow, ClientPlatformRow, ClientRow, Env, PostRow } from '../types';
import { generatePostContent, type GenerationContext } from '../services/openai';
import {
  getCompatiblePlatforms,
  getGbpCaptionField,
  getGbpPostedKey,
  getPlatformRule,
  isPostContentComplete,
  normalizeContentType,
  parsePlatforms,
  resolvePlatformSelection,
} from '../modules/platform-compatibility';
import { requiresMedia } from '../modules/media';
import type { GeneratedPost } from '../services/openai';

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

export interface RepairStats {
  posts_scanned: number;
  posts_updated: number;
  content_fixed: number;
  platforms_corrected: number;
  duplicates_merged: number;
  etb_fixed: boolean;
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 55);
}

function fallbackCaption(
  base: string,
  platform: string,
  client: { canonical_name: string; industry?: string | null; phone?: string | null },
): string {
  const core = base.trim() || `${client.canonical_name} ${client.industry ?? 'services'}`.trim();
  const phone = client.phone ? ` Call ${client.phone}.` : '';
  switch (platform) {
    case 'instagram': return `${core}\n\n#${slugify(client.canonical_name).replace(/-/g, '')} #${slugify(client.industry ?? 'business').replace(/-/g, '')}`;
    case 'linkedin': return `${core} Learn how ${client.canonical_name} helps clients with ${client.industry ?? 'their projects'}.`;
    case 'x': return core.slice(0, 275);
    case 'threads': return core;
    case 'tiktok': return `${core}\n#fyp #${slugify(client.canonical_name).replace(/-/g, '')}`;
    case 'pinterest': return core.slice(0, 190);
    case 'bluesky': return core.slice(0, 280);
    case 'google_business': return `${core}${phone}`.slice(0, 220);
    default: return core;
  }
}

function fallbackBlogHtml(ctx: GenerationContext, title: string, base: string): string {
  const keyword = ctx.intelligence?.primary_keyword ?? title.toLowerCase();
  return [
    `<p>${ctx.client.canonical_name} helps clients with ${keyword}. ${base || 'This post covers what to expect, common issues, and practical next steps.'}</p>`,
    `<h2>What To Know Before You Start</h2><p>Every project should begin with clear goals, a realistic timeline, and the right team. ${ctx.client.canonical_name} focuses on quality, communication, and results that fit the client's needs.</p>`,
    `<h2>How ${ctx.client.canonical_name} Approaches The Work</h2><p>We review the scope, recommend the right solution, and complete the work with careful attention to detail. That helps clients avoid delays, reduce stress, and get a better final result.</p>`,
    `<h2>Common Questions Clients Ask</h2><p>Most clients want to know what the process looks like, how long it takes, and how to prepare. The best next step is to speak with the team directly and get guidance based on the property, scope, and goals.</p>`,
    `<div style="background:#1a73e818;border-left:4px solid #1a73e8;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0;"><h3 style="color:#1a73e8;margin:0 0 8px 0;font-size:1.1rem;">Talk With ${ctx.client.canonical_name}</h3><p style="margin:0 0 14px 0;">Get a clear recommendation and next steps from an experienced team.</p><a href="${ctx.client.phone ? `tel:${ctx.client.phone}` : '#contact'}" style="display:inline-block;background:#1a73e8;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:0.95rem;">${ctx.client.cta_text ?? 'Contact Us Today'}</a></div>`,
    `<h2>Final Thoughts</h2><p>${ctx.client.canonical_name} is focused on dependable service, strong communication, and results that last. Contact the team to discuss your goals and the right next step.</p>`,
  ].join('');
}

function fallbackGeneratedPost(ctx: GenerationContext, existing: PostRow): GeneratedPost {
  const title = stringValue(existing.title) ?? `${ctx.client.canonical_name} ${titleCase(ctx.contentType)}`;
  const base = stringValue(existing.master_caption)
    ?? stringValue(existing.cap_google_business)
    ?? `${ctx.client.canonical_name} provides ${ctx.client.industry ?? 'professional services'}${ctx.client.state ? ` in ${ctx.client.state}` : ''}.`;
  const result: GeneratedPost = {
    title,
    master_caption: base,
    ai_image_prompt: `Crear una pieza visual para ${ctx.client.canonical_name}. Mostrar ${title.toLowerCase()} con estilo profesional, colores limpios y composición clara. Incluir ambiente confiable, elementos de ${ctx.client.industry ?? 'servicio'} y espacio para texto breve.`,
  };
  for (const platform of ctx.platforms) {
    if (platform === 'youtube') {
      result.youtube_title = title;
      result.youtube_description = `${base} Learn more about ${ctx.client.canonical_name}.`;
      continue;
    }
    const key = `cap_${platform}` as keyof GeneratedPost;
    result[key] = fallbackCaption(base, platform, ctx.client);
  }
  if (ctx.platforms.includes('google_business')) {
    result.cap_google_business = fallbackCaption(base, 'google_business', ctx.client);
    for (const loc of ctx.gbpLocations ?? []) {
      if (!loc.captionField) continue;
      (result as unknown as Record<string, string | undefined>)[loc.captionField] =
        `${result.cap_google_business ?? base} ${loc.label.toUpperCase()}`.slice(0, 220);
    }
  }
  if (ctx.contentType === 'video' || ctx.contentType === 'reel') {
    result.video_script = `Hook: ${title}. Body: Explain the key benefit, process, and what makes ${ctx.client.canonical_name} different. CTA: ${ctx.client.cta_text ?? 'Contact us today'}.`;
    result.ai_video_prompt = `Crear un video para ${ctx.client.canonical_name} con enfoque en ${title.toLowerCase()}. Mostrar tomas limpias, transiciones suaves y estilo profesional. Cerrar con llamada a la acción clara.`;
  }
  if (ctx.contentType === 'blog') {
    result.blog_content = fallbackBlogHtml(ctx, title, base);
    result.blog_excerpt = base.slice(0, 155);
    result.seo_title = title.slice(0, 60);
    result.meta_description = base.slice(0, 155);
    result.target_keyword = ctx.intelligence?.primary_keyword ?? slugify(title).replace(/-/g, ' ');
    result.slug = slugify(title);
  }
  return result;
}

type MutablePost = PostRow & { _platforms: string[] };

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function completenessForSort(post: PostRow, gbpLocations: ClientGbpLocationRow[]): number {
  let score = 0;
  if (post.master_caption) score += 2;
  if (post.blog_content) score += 3;
  if (post.ai_image_prompt) score += 2;
  if (post.ai_video_prompt) score += 2;
  if (post.video_script) score += 2;
  if (post.cap_google_business) score += 1;
  for (const key of [
    post.cap_facebook,
    post.cap_instagram,
    post.cap_linkedin,
    post.cap_x,
    post.cap_threads,
    post.cap_tiktok,
    post.cap_pinterest,
    post.cap_bluesky,
    post.youtube_title,
    post.youtube_description,
  ]) {
    if (key) score += 1;
  }
  for (const loc of gbpLocations) {
    const field = getGbpCaptionField(loc);
    if (field && post[field]) score += 1;
  }
  return score;
}

function mergeValue<T>(canonical: T | null | undefined, duplicate: T | null | undefined): T | null {
  return (canonical ?? duplicate ?? null) as T | null;
}

async function getAllPosts(db: D1Database): Promise<PostRow[]> {
  const res = await db.prepare('SELECT * FROM posts ORDER BY client_id, publish_date, content_type, updated_at DESC').all<PostRow>();
  return res.results;
}

async function getAllClients(db: D1Database): Promise<ClientRow[]> {
  const res = await db.prepare('SELECT * FROM clients').all<ClientRow>();
  return res.results;
}

async function getPlatformsByClient(db: D1Database): Promise<Map<string, ClientPlatformRow[]>> {
  const res = await db.prepare('SELECT * FROM client_platforms').all<ClientPlatformRow>();
  const map = new Map<string, ClientPlatformRow[]>();
  for (const row of res.results) {
    const list = map.get(row.client_id) ?? [];
    list.push(row);
    map.set(row.client_id, list);
  }
  return map;
}

async function getGbpByClient(db: D1Database): Promise<Map<string, ClientGbpLocationRow[]>> {
  const res = await db.prepare('SELECT * FROM client_gbp_locations ORDER BY client_id, sort_order').all<ClientGbpLocationRow>();
  const map = new Map<string, ClientGbpLocationRow[]>();
  for (const row of res.results) {
    const list = map.get(row.client_id) ?? [];
    list.push(row);
    map.set(row.client_id, list);
  }
  return map;
}

async function getIntel(db: D1Database, clientId: string): Promise<IntelRow | null> {
  return await db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(clientId).first<IntelRow>() ?? null;
}

async function getFeedback(db: D1Database, clientId: string): Promise<FeedbackRow[]> {
  const res = await db.prepare('SELECT sentiment, message AS note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 10').bind(clientId).all<FeedbackRow>();
  return res.results;
}

async function getRecentTitles(db: D1Database, clientId: string, excludePostId: string): Promise<string[]> {
  const res = await db.prepare(
    `SELECT title, master_caption
     FROM posts
     WHERE client_id = ?
       AND id != ?
       AND status NOT IN ('cancelled','failed')
     ORDER BY updated_at DESC
     LIMIT 10`,
  ).bind(clientId, excludePostId).all<{ title: string | null; master_caption: string | null }>();
  return res.results.map((row) => row.title ?? row.master_caption?.slice(0, 80) ?? '').filter(Boolean) as string[];
}

async function deleteDuplicatePost(db: D1Database, postId: string): Promise<void> {
  await db.prepare('DELETE FROM posting_attempts WHERE post_id = ?').bind(postId).run();
  await db.prepare('DELETE FROM content_memory WHERE post_id = ?').bind(postId).run().catch(() => undefined);
  await db.prepare('DELETE FROM post_platforms WHERE post_id = ?').bind(postId).run();
  await db.prepare('DELETE FROM post_versions WHERE post_id = ?').bind(postId).run();
  await db.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
}

function normalizePublishDate(date: string | null): string {
  return date ? date.slice(0, 10) : 'nodate';
}

function applyPlatformCorrection(
  post: MutablePost,
  clientPlatforms: ClientPlatformRow[],
): { corrected: boolean; correctedPlatforms: string[] } {
  const existingPlatforms = post._platforms;
  if (post.platform_manual_override === 1) {
    return { corrected: false, correctedPlatforms: existingPlatforms };
  }
  const selection = resolvePlatformSelection({
    contentType: post.content_type,
    requestedPlatforms: existingPlatforms,
    clientPlatforms,
    assetType: post.asset_type,
  });
  const correctedPlatforms = selection.selected.length > 0
    ? selection.selected
    : getCompatiblePlatforms(post.content_type, existingPlatforms);
  const corrected = JSON.stringify(correctedPlatforms) !== JSON.stringify(existingPlatforms);
  return { corrected, correctedPlatforms };
}

function markReadyState(post: PostRow): Record<string, unknown> {
  const contentType = normalizeContentType(post.content_type, post.asset_type);
  const mediaRequired = requiresMedia(contentType);
  const hasAsset = Boolean(post.asset_r2_key);
  const assetDelivered = mediaRequired ? (hasAsset ? 1 : post.asset_delivered) : 1;
  const ready = mediaRequired ? (hasAsset ? 1 : 0) : 1;
  const status = ready === 1 ? 'ready' : (post.status ?? 'draft');
  return {
    asset_delivered: assetDelivered,
    ready_for_automation: ready,
    status,
  };
}

export async function repairExistingPosts(env: Env, opts?: { overwrite?: boolean }): Promise<RepairStats> {
  const overwrite = opts?.overwrite === true;
  const apiKey = env.OPENAI_API_KEY || '';

  const db = env.DB;
  const [posts, clients, platformMap, gbpMap] = await Promise.all([
    getAllPosts(db),
    getAllClients(db),
    getPlatformsByClient(db),
    getGbpByClient(db),
  ]);

  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const grouped = new Map<string, MutablePost[]>();
  for (const post of posts) {
    const key = `${post.client_id}:${normalizePublishDate(post.publish_date)}:${normalizeContentType(post.content_type, post.asset_type)}`;
    const list = grouped.get(key) ?? [];
    list.push({ ...post, _platforms: parsePlatforms(post.platforms) });
    grouped.set(key, list);
  }

  const stats: RepairStats = {
    posts_scanned: posts.length,
    posts_updated: 0,
    content_fixed: 0,
    platforms_corrected: 0,
    duplicates_merged: 0,
    etb_fixed: false,
  };

  for (const [, group] of grouped) {
    const client = clientMap.get(group[0].client_id);
    if (!client) continue;
    const clientPlatforms = platformMap.get(client.id) ?? [];
    const gbpLocations = gbpMap.get(client.id) ?? [];

    group.sort((a, b) => {
      const score = completenessForSort(b, gbpLocations) - completenessForSort(a, gbpLocations);
      if (score !== 0) return score;
      return (b.updated_at ?? 0) - (a.updated_at ?? 0);
    });

    const canonical = group[0];
    for (const duplicate of group.slice(1)) {
      canonical.title = mergeValue(canonical.title, duplicate.title);
      canonical.master_caption = mergeValue(canonical.master_caption, duplicate.master_caption);
      canonical.cap_facebook = mergeValue(canonical.cap_facebook, duplicate.cap_facebook);
      canonical.cap_instagram = mergeValue(canonical.cap_instagram, duplicate.cap_instagram);
      canonical.cap_linkedin = mergeValue(canonical.cap_linkedin, duplicate.cap_linkedin);
      canonical.cap_x = mergeValue(canonical.cap_x, duplicate.cap_x);
      canonical.cap_threads = mergeValue(canonical.cap_threads, duplicate.cap_threads);
      canonical.cap_tiktok = mergeValue(canonical.cap_tiktok, duplicate.cap_tiktok);
      canonical.cap_pinterest = mergeValue(canonical.cap_pinterest, duplicate.cap_pinterest);
      canonical.cap_bluesky = mergeValue(canonical.cap_bluesky, duplicate.cap_bluesky);
      canonical.cap_google_business = mergeValue(canonical.cap_google_business, duplicate.cap_google_business);
      canonical.cap_gbp_la = mergeValue(canonical.cap_gbp_la, duplicate.cap_gbp_la);
      canonical.cap_gbp_wa = mergeValue(canonical.cap_gbp_wa, duplicate.cap_gbp_wa);
      canonical.cap_gbp_or = mergeValue(canonical.cap_gbp_or, duplicate.cap_gbp_or);
      canonical.youtube_title = mergeValue(canonical.youtube_title, duplicate.youtube_title);
      canonical.youtube_description = mergeValue(canonical.youtube_description, duplicate.youtube_description);
      canonical.blog_content = mergeValue(canonical.blog_content, duplicate.blog_content);
      canonical.blog_excerpt = mergeValue(canonical.blog_excerpt, duplicate.blog_excerpt);
      canonical.seo_title = mergeValue(canonical.seo_title, duplicate.seo_title);
      canonical.meta_description = mergeValue(canonical.meta_description, duplicate.meta_description);
      canonical.slug = mergeValue(canonical.slug, duplicate.slug);
      canonical.target_keyword = mergeValue(canonical.target_keyword, duplicate.target_keyword);
      canonical.ai_image_prompt = mergeValue(canonical.ai_image_prompt, duplicate.ai_image_prompt);
      canonical.ai_video_prompt = mergeValue(canonical.ai_video_prompt, duplicate.ai_video_prompt);
      canonical.video_script = mergeValue(canonical.video_script, duplicate.video_script);
      canonical.asset_r2_key = mergeValue(canonical.asset_r2_key, duplicate.asset_r2_key);
      canonical.asset_r2_bucket = mergeValue(canonical.asset_r2_bucket, duplicate.asset_r2_bucket);
      canonical.asset_type = mergeValue(canonical.asset_type, duplicate.asset_type);
      canonical.publish_date = mergeValue(canonical.publish_date, duplicate.publish_date);
      canonical.status = mergeValue(canonical.status, duplicate.status);
      canonical.ready_for_automation = Math.max(canonical.ready_for_automation ?? 0, duplicate.ready_for_automation ?? 0);
      canonical.asset_delivered = Math.max(canonical.asset_delivered ?? 0, duplicate.asset_delivered ?? 0);
      canonical._platforms = Array.from(new Set([...canonical._platforms, ...duplicate._platforms]));
      await deleteDuplicatePost(db, duplicate.id);
      stats.duplicates_merged++;
    }

    const { corrected, correctedPlatforms } = applyPlatformCorrection(canonical, clientPlatforms);
    canonical._platforms = correctedPlatforms;
    canonical.platforms = JSON.stringify(correctedPlatforms);
    if (corrected) stats.platforms_corrected++;

    const needsContent = !isPostContentComplete(canonical, gbpLocations);
    if (needsContent || overwrite) {
      const intel = await getIntel(db, canonical.client_id);
      const feedback = await getFeedback(db, canonical.client_id);
      const recentTitles = await getRecentTitles(db, canonical.client_id, canonical.id);

      const ctx: GenerationContext = {
        client: {
          canonical_name: client.canonical_name,
          notes: client.notes,
          brand_json: client.brand_json,
          brand_primary_color: null,
          language: client.language,
          phone: client.phone,
          cta_text: client.cta_text,
          industry: client.industry,
          state: client.state,
          owner_name: client.owner_name,
        },
        intelligence: intel,
        recentTitles,
        feedback,
        publishDate: normalizePublishDate(canonical.publish_date),
        contentType: normalizeContentType(canonical.content_type, canonical.asset_type),
        platforms: correctedPlatforms,
        contentIntent: 'educational',
        gbpTopicType: canonical.gbp_topic_type,
        gbpCtaType: canonical.gbp_cta_type,
        gbpOfferTitle: canonical.title,
        gbpEventTitle: canonical.gbp_event_title,
        gbpLocations: gbpLocations
          .filter((location) => location.paused !== 1)
          .map((location) => ({
            label: location.label,
            captionField: getGbpCaptionField(location),
          }))
          .filter((location) => Boolean(location.captionField)),
      };

      const generated = apiKey
        ? await generatePostContent(apiKey, ctx)
        : { post: fallbackGeneratedPost(ctx, canonical) };
      const post = generated.post as unknown as Record<string, string | undefined>;
      const assignMissing = (key: keyof PostRow) => {
        const value = stringValue(post[key as string]);
        if (overwrite) {
          (canonical[key] as string | null) = value;
          return;
        }
        if (!stringValue(canonical[key])) (canonical[key] as string | null) = value;
      };

      for (const key of [
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
        'slug',
        'target_keyword',
        'ai_image_prompt',
        'ai_video_prompt',
        'video_script',
      ] as (keyof PostRow)[]) assignMissing(key);

      stats.content_fixed++;
    }

    // Ensure active GBP multi-location overrides exist when GBP is selected.
    if (canonical._platforms.includes('google_business')) {
      for (const location of gbpLocations.filter((row) => row.paused !== 1)) {
        const field = getGbpCaptionField(location);
        if (!field) continue;
        if (!stringValue(canonical[field])) {
          (canonical as unknown as Record<string, string | null | undefined>)[field] =
            canonical.cap_google_business ?? canonical.master_caption;
        }
        // Normalize posting key mapping at read-time for future posting attempts.
        void getGbpPostedKey(location);
      }
    }

    const readyState = markReadyState(canonical);
    await db.prepare(
      `UPDATE posts SET
        title = ?, status = ?, content_type = ?, platforms = ?, publish_date = ?,
        master_caption = ?, cap_facebook = ?, cap_instagram = ?, cap_linkedin = ?,
        cap_x = ?, cap_threads = ?, cap_tiktok = ?, cap_pinterest = ?, cap_bluesky = ?,
        cap_google_business = ?, cap_gbp_la = ?, cap_gbp_wa = ?, cap_gbp_or = ?,
        youtube_title = ?, youtube_description = ?, blog_content = ?, blog_excerpt = ?,
        seo_title = ?, meta_description = ?, slug = ?, target_keyword = ?,
        ai_image_prompt = ?, ai_video_prompt = ?, video_script = ?,
        ready_for_automation = ?, asset_delivered = ?, platform_manual_override = ?, updated_at = unixepoch()
       WHERE id = ?`,
    ).bind(
      canonical.title,
      readyState.status,
      normalizeContentType(canonical.content_type, canonical.asset_type),
      canonical.platforms,
      canonical.publish_date,
      canonical.master_caption,
      canonical.cap_facebook,
      canonical.cap_instagram,
      canonical.cap_linkedin,
      canonical.cap_x,
      canonical.cap_threads,
      canonical.cap_tiktok,
      canonical.cap_pinterest,
      canonical.cap_bluesky,
      canonical.cap_google_business,
      canonical.cap_gbp_la,
      canonical.cap_gbp_wa,
      canonical.cap_gbp_or,
      canonical.youtube_title,
      canonical.youtube_description,
      canonical.blog_content,
      canonical.blog_excerpt,
      canonical.seo_title,
      canonical.meta_description,
      canonical.slug,
      canonical.target_keyword,
      canonical.ai_image_prompt,
      canonical.ai_video_prompt,
      canonical.video_script,
      readyState.ready_for_automation,
      readyState.asset_delivered,
      canonical.platform_manual_override,
      canonical.id,
    ).run();
    stats.posts_updated++;
  }

  const etbClient = clients.find((client) => client.slug === 'elite-team-builders');
  if (etbClient) {
    const etbPosts = await db.prepare('SELECT * FROM posts WHERE client_id = ?').bind(etbClient.id).all<PostRow>();
    const etbGbp = gbpMap.get(etbClient.id) ?? [];
    stats.etb_fixed = etbPosts.results.every((post) => {
      const platforms = parsePlatforms(post.platforms);
      if (post.platform_manual_override !== 1) {
        const allowed = new Set(getPlatformRule(post.content_type, post.asset_type).allowed);
        if (platforms.some((platform) => !allowed.has(platform))) return false;
      }
      if (platforms.includes('google_business')) {
        for (const location of etbGbp.filter((row) => row.paused !== 1)) {
          const field = getGbpCaptionField(location);
          if (field && !stringValue(post[field])) return false;
        }
      }
      if (normalizeContentType(post.content_type, post.asset_type) === 'blog' && !stringValue(post.blog_content)) return false;
      return true;
    });
  }

  return stats;
}
