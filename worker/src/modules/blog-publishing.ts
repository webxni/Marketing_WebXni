import type { ClientPlatformRow, ClientRow, Env, PostRow } from '../types';
import { createPost, getClientWithConfig, getPostByAutomationSlotKey, getPostById, updatePost, writeAuditLog } from '../db/queries';
import {
  BLOG_BODY_IMAGE_PLACEHOLDER,
  buildWordPressClient,
  extractStructuredBlogContent,
  inferBusinessTemplateKey,
  injectBodyImageIntoHtml,
  injectBodyImagesIntoHtml,
  renderStructuredBlogHtml,
  renderTemplate,
  withWordPressBlogChrome,
  type TemplateTokens,
  type WpMediaItem,
  type WpPost,
} from '../services/wordpress';
import { parseBlogBodyImages, serializeBlogBodyImages } from './blog-body-images';
import { ensureBlogBodyImagesGenerated } from '../loader/autonomous-content';
import { getBlogDistributionPlatforms } from './platform-compatibility';
import { resolveStabilityApiKeys } from '../services/stability';
import { resolveBlogTemplateConfig } from './blog-templates';
import {
  buildBlogSocialCaption,
  getCompatibleBlogDistributionPlatforms,
  sanitizeStructuredBlogContent,
  uniqueImageHtmlBySource,
  validateBlogPublishingContent,
  type BlogPublishingValidationContext,
} from './blog-quality';

export interface BlogPreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface PublishBlogOptions {
  status?: 'draft' | 'publish' | 'pending';
  forceUpdate?: boolean;
  defaultStatus?: 'draft' | 'publish' | 'pending';
  userId?: string;
  ip?: string;
}

export interface PublishBlogResult {
  post: PostRow;
  client: ClientRow & {
    platforms: unknown[];
    gbp_locations: unknown[];
    restrictions: string[];
  };
  wpPost: WpPost;
  warnings: string[];
  htmlContent: string;
  featuredMediaId: number | null;
}

type BlogDraftClient = Pick<ClientRow, 'canonical_name' | 'industry' | 'state' | 'phone' | 'cta_text' | 'brand_json' | 'wp_template_key'> & {
  slug?: string | null;
  brand_primary_color?: string | null;
};

export function normalizeBlogDraftPayload(
  client: BlogDraftClient,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const contentType = String(data['content_type'] ?? '');
  if (contentType !== 'blog') return data;

  const rawHtml = typeof data['blog_content'] === 'string' ? data['blog_content'].trim() : '';
  if (!rawHtml) return data;

  const title = typeof data['title'] === 'string' && data['title'].trim()
    ? data['title'].trim()
    : `${client.canonical_name} Guide`;
  const excerpt = typeof data['blog_excerpt'] === 'string' && data['blog_excerpt'].trim()
    ? data['blog_excerpt'].trim()
    : '';
  const fallbackKeyword = typeof data['target_keyword'] === 'string' && data['target_keyword'].trim()
    ? data['target_keyword'].trim()
    : (client.industry?.trim() || title);
  const secondary = typeof data['secondary_keywords'] === 'string' ? data['secondary_keywords'].trim() : '';
  const seoTitle = typeof data['seo_title'] === 'string' && data['seo_title'].trim()
    ? data['seo_title'].trim()
    : title;
  const metaDescription = typeof data['meta_description'] === 'string' && data['meta_description'].trim()
    ? data['meta_description'].trim()
    : excerpt;
  const slug = typeof data['slug'] === 'string' ? data['slug'].trim() : '';

  const structured = sanitizeStructuredBlogContent(extractStructuredBlogContent(rawHtml, {
    title,
    excerpt,
    focusKeyword: fallbackKeyword,
    secondaryKeywords: secondary,
    seoTitle,
    metaDescription,
    slug,
    intro: excerpt || title,
    sections: [{ heading: title, html: rawHtml }],
    faq: [],
    ctaHeading: client.cta_text ?? `Talk With ${client.canonical_name}`,
    ctaBody: `Connect with ${client.canonical_name} for guidance tailored to your goals and project needs.`,
    ctaButtonLabel: client.cta_text ?? 'Contact Us Today',
    imagePrompt: typeof data['ai_image_prompt'] === 'string' ? data['ai_image_prompt'] : undefined,
  })).blog;
  const templateConfig = resolveBlogTemplateConfig({
    slug: client.slug ?? '',
    canonical_name: client.canonical_name,
    industry: client.industry ?? null,
    state: client.state ?? null,
    brand_json: client.brand_json ?? null,
    wp_template_key: client.wp_template_key ?? null,
    cta_text: client.cta_text ?? null,
    brand_primary_color: client.brand_primary_color ?? null,
  });

  return {
    ...data,
    blog_content: renderStructuredBlogHtml({
      templateKey: inferBusinessTemplateKey({
        wp_template_key: client.wp_template_key ?? null,
        industry: client.industry ?? null,
      }),
      primaryColor: getPrimaryColor(client),
      accentColor: templateConfig.accentColor,
      clientName: client.canonical_name,
      clientSlug: client.slug ?? undefined,
      industry: client.industry,
      phone: client.phone ?? null,
      ctaDefault: client.cta_text ?? null,
      template: templateConfig,
      blog: structured,
    }),
    blog_excerpt: data['blog_excerpt'] ?? structured.excerpt,
    seo_title: data['seo_title'] ?? structured.seoTitle,
    meta_description: data['meta_description'] ?? structured.metaDescription,
    target_keyword: data['target_keyword'] ?? structured.focusKeyword,
    secondary_keywords: data['secondary_keywords'] ?? structured.secondaryKeywords,
    slug: data['slug'] ?? structured.slug,
  };
}

export function preflightBlogPost(post: {
  content_type: string | null;
  blog_content: string | null;
  title: string | null;
  seo_title: string | null;
  meta_description: string | null;
  target_keyword: string | null;
  secondary_keywords?: string | null;
  slug: string | null;
  blog_excerpt: string | null;
  ai_image_prompt?: string | null;
}, context: BlogPublishingValidationContext = { clientName: '' }): BlogPreflightResult {
  const result = validateBlogPublishingContent(post, context);
  return { ok: result.ok, errors: result.errors, warnings: result.warnings };
}

export function isBlogAutomationEligible(post: Pick<PostRow, 'content_type' | 'status' | 'ready_for_automation'>): boolean {
  if (post.content_type !== 'blog') return false;
  if (post.ready_for_automation !== 1) return false;
  return ['ready', 'approved', 'scheduled'].includes(String(post.status ?? ''));
}

export function isBlogDueForAutomation(post: Pick<PostRow, 'publish_date'>): boolean {
  if (!post.publish_date) return true;
  const nowUtc = Date.now();
  const cstNow = new Date(nowUtc - (6 * 60 * 60 * 1000)).toISOString().slice(0, 16);
  return post.publish_date.slice(0, 16) <= cstNow;
}

function chooseCanonicalWpPost(posts: WpPost[], slug: string): WpPost | null {
  if (posts.length === 0) return null;
  const ranked = [...posts].sort((a, b) => {
    const score = (post: WpPost): number => {
      let value = 0;
      if (post.slug === slug) value += 5;
      if (post.status === 'publish') value += 4;
      if (post.status === 'draft') value += 2;
      return value + (post.id / 100000);
    };
    return score(b) - score(a);
  });
  return ranked[0] ?? null;
}

function getPrimaryColor(client: Pick<ClientRow, 'brand_json'> & { brand_primary_color?: string | null }): string {
  if (client.brand_primary_color?.trim()) return client.brand_primary_color.trim();
  if (client.brand_json) {
    try {
      const parsed = JSON.parse(client.brand_json);
      const value = parsed.primary_color ?? parsed.primaryColor;
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch {
      // ignore malformed brand_json
    }
  }
  return '#1a73e8';
}

function buildBodyImageHtml(media: WpMediaItem | null, caption: string): string {
  if (!media?.source_url) return '';
  const alt = (media.alt_text || caption).replace(/"/g, '&quot;');
  return `<img src="${media.source_url}" alt="${alt}" loading="lazy" decoding="async" sizes="(max-width: 760px) 100vw, 760px" /><figcaption>${caption.replace(/</g, '&lt;')}</figcaption>`;
}

function getDistributionCaption(post: PostRow, platform: string): string | null {
  switch (platform) {
    case 'google_business':
      return post.cap_google_business ?? post.master_caption;
    case 'facebook':
      return post.cap_facebook ?? post.master_caption;
    case 'instagram':
      return post.cap_instagram ?? post.master_caption;
    case 'linkedin':
      return post.cap_linkedin ?? post.master_caption;
    case 'x':
      return post.cap_x ?? post.master_caption;
    case 'threads':
      return post.cap_threads ?? post.master_caption;
    case 'pinterest':
      return post.cap_pinterest ?? post.master_caption;
    case 'bluesky':
      return post.cap_bluesky ?? post.master_caption;
    default:
      return post.master_caption;
  }
}

async function loadBlogValidationContext(db: D1Database, client: ClientRow): Promise<BlogPublishingValidationContext> {
  const [serviceRows, areaRows, categoryRows] = await Promise.all([
    db.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 30')
      .bind(client.id)
      .all<{ name: string }>(),
    db.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 30')
      .bind(client.id)
      .all<{ city: string }>(),
    db.prepare('SELECT name FROM client_categories WHERE client_id = ? ORDER BY sort_order ASC LIMIT 30')
      .bind(client.id)
      .all<{ name: string }>(),
  ]);

  return {
    clientName: client.canonical_name,
    industry: client.industry,
    state: client.state,
    serviceNames: serviceRows.results.map((row) => row.name).filter(Boolean),
    serviceAreas: areaRows.results.map((row) => row.city).filter(Boolean),
    categoryNames: categoryRows.results.map((row) => row.name).filter(Boolean),
  };
}

async function auditBlogStep(
  db: D1Database,
  options: Pick<PublishBlogOptions, 'userId' | 'ip'>,
  action: string,
  postId: string,
  newValue: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog(db, {
    user_id: options.userId,
    action,
    entity_type: 'post',
    entity_id: postId,
    new_value: newValue,
    ip: options.ip,
  });
}

export async function syncBlogDistributionPost(
  env: Env,
  blogPost: PostRow,
  client: ClientRow & { platforms: unknown[] },
  options: Pick<PublishBlogOptions, 'userId' | 'ip'> = {},
): Promise<{ action: 'created' | 'updated' | 'skipped'; postId: string | null; platforms: string[] }> {
  if (!blogPost.wp_post_url) return { action: 'skipped', postId: null, platforms: [] };
  const clientPlatforms = (client.platforms ?? []) as ClientPlatformRow[];
  const distributionContentType = blogPost.asset_r2_key ? 'image' : 'text';
  const platforms = getCompatibleBlogDistributionPlatforms({
    candidatePlatforms: getBlogDistributionPlatforms(clientPlatforms),
    contentType: distributionContentType,
  });
  if (platforms.length === 0) return { action: 'skipped', postId: null, platforms: [] };

  const automationSlotKey = `blog_distribution:${blogPost.id}`;
  const existing = await getPostByAutomationSlotKey(env.DB, client.id, automationSlotKey);
  const title = blogPost.title?.trim()
    ? `${blogPost.title.trim()} — Blog Promo`
    : `${client.canonical_name} Blog Promo`;
  const captionFor = (platform: string): string => buildBlogSocialCaption({
    platform,
    title: blogPost.title,
    excerpt: blogPost.blog_excerpt ?? blogPost.master_caption,
    clientName: client.canonical_name,
    blogUrl: blogPost.wp_post_url!,
    existing: getDistributionCaption(blogPost, platform),
  });
  const usedCaptions = new Map<string, string>();
  const captionCache = new Map<string, string>();
  const uniqueCaptionFor = (platform: string): string => {
    const cached = captionCache.get(platform);
    if (cached) return cached;
    const base = captionFor(platform);
    const key = base.replace(blogPost.wp_post_url!, '[url]').replace(/\s+/g, ' ').trim().toLowerCase();
    const previous = usedCaptions.get(key);
    if (!previous) {
      usedCaptions.set(key, platform);
      captionCache.set(platform, base);
      return base;
    }
    const revised = buildBlogSocialCaption({
      platform,
      title: `${blogPost.title ?? client.canonical_name} (${platform.replace(/_/g, ' ')})`,
      excerpt: blogPost.blog_excerpt ?? blogPost.master_caption,
      clientName: client.canonical_name,
      blogUrl: blogPost.wp_post_url!,
      existing: null,
    });
    captionCache.set(platform, revised);
    return revised;
  };
  const masterPlatform = platforms[0] ?? 'facebook';
  const payload: Omit<Partial<PostRow>, 'title' | 'client_id'> = {
    status: existing?.status ?? 'pending_approval',
    content_type: distributionContentType,
    platforms: JSON.stringify(platforms),
    publish_date: blogPost.publish_date,
    master_caption: captionFor(masterPlatform),
    cap_google_business: platforms.includes('google_business') ? uniqueCaptionFor('google_business') : null,
    cap_facebook: platforms.includes('facebook') ? uniqueCaptionFor('facebook') : null,
    cap_instagram: platforms.includes('instagram') ? uniqueCaptionFor('instagram') : null,
    cap_linkedin: platforms.includes('linkedin') ? uniqueCaptionFor('linkedin') : null,
    cap_x: platforms.includes('x') ? uniqueCaptionFor('x') : null,
    cap_threads: platforms.includes('threads') ? uniqueCaptionFor('threads') : null,
    cap_pinterest: platforms.includes('pinterest') ? uniqueCaptionFor('pinterest') : null,
    cap_bluesky: platforms.includes('bluesky') ? uniqueCaptionFor('bluesky') : null,
    asset_r2_key: blogPost.asset_r2_key,
    asset_r2_bucket: blogPost.asset_r2_bucket,
    asset_type: blogPost.asset_r2_key ? 'image' : null,
    asset_delivered: blogPost.asset_r2_key ? 1 : 0,
    ready_for_automation: 0,
    gbp_topic_type: platforms.includes('google_business') ? 'STANDARD' : null,
    gbp_cta_type: platforms.includes('google_business') ? 'LEARN_MORE' : null,
    gbp_cta_url: platforms.includes('google_business') ? blogPost.wp_post_url : null,
    scheduled_by_automation: 0,
    platform_manual_override: 0,
    automation_slot_key: automationSlotKey,
    generation_run_id: blogPost.generation_run_id,
  };
  await auditBlogStep(env.DB, options, 'blog.social_summary.generated', blogPost.id, {
    client_id: client.id,
    distribution_content_type: distributionContentType,
    platforms,
    wp_post_url: blogPost.wp_post_url,
  });

  if (existing) {
    await updatePost(env.DB, existing.id, payload);
    await auditBlogStep(env.DB, options, 'blog.social_summary.updated', existing.id, {
      source_blog_id: blogPost.id,
      client_id: client.id,
      platforms,
      wp_post_url: blogPost.wp_post_url,
    });
    return { action: 'updated', postId: existing.id, platforms };
  }

  const created = await createPost(env.DB, {
    client_id: client.id,
    title,
    ...payload,
  });
  await auditBlogStep(env.DB, options, 'blog.social_summary.created', created.id, {
    source_blog_id: blogPost.id,
    client_id: client.id,
    platforms,
    wp_post_url: blogPost.wp_post_url,
  });
  return { action: 'created', postId: created.id, platforms };
}

async function ensurePostBodyImages(
  env: Env,
  post: PostRow,
  client: ClientRow,
  warnings: string[],
): Promise<PostRow> {
  if (post.content_type !== 'blog') return post;

  const { openAiKey, stabilityKey } = await resolveStabilityApiKeys(env);
  if (!stabilityKey) {
    if (parseBlogBodyImages(post.blog_body_images).length === 0) {
      warnings.push('Body images not generated: STABILITY_API_KEY not configured');
    }
    return post;
  }

  const existing = parseBlogBodyImages(post.blog_body_images);
  const next = await ensureBlogBodyImagesGenerated(env, openAiKey, stabilityKey, {
    blogTitle: post.title ?? '',
    blogContent: post.blog_content,
    targetKeyword: post.target_keyword,
    serviceType: post.target_keyword ?? client.industry ?? '',
    industry: client.industry ?? '',
    location: client.state ?? '',
    clientName: client.canonical_name,
    clientId: client.id,
    existing,
  });

  const changed = JSON.stringify(existing) !== JSON.stringify(next);
  if (!changed) return post;

  await updatePost(env.DB, post.id, { blog_body_images: serializeBlogBodyImages(next) });
  return { ...post, blog_body_images: serializeBlogBodyImages(next) };
}

async function ensureFeaturedMedia(env: Env, post: PostRow, client: ClientRow, warnings: string[]): Promise<{
  featuredMediaId: number | null;
  bodyImageHtml: string;
  slotHtml: { slot1?: string; slot2?: string; slot3?: string };
}> {
  const wp = buildWordPressClient(client);
  if (!wp) return {
    featuredMediaId: post.wp_featured_media_id ?? null,
    bodyImageHtml: post.asset_r2_key ? BLOG_BODY_IMAGE_PLACEHOLDER : '',
    slotHtml: {},
  };

  const imageMode = (client as ClientRow & { wp_featured_image_mode?: string | null }).wp_featured_image_mode ?? 'upload';
  let featuredMediaId = post.wp_featured_media_id ?? null;
  let legacyMedia: WpMediaItem | null = null;

  // Upload legacy single-asset if present — this remains the default featured-media source.
  if (!featuredMediaId && post.asset_r2_key && imageMode !== 'none') {
    try {
      const bucket = post.asset_r2_bucket === 'IMAGES' ? env.IMAGES : env.MEDIA;
      const r2Obj = await bucket.get(post.asset_r2_key);
      if (r2Obj) {
        const blob = await new Response(r2Obj.body).blob();
        const ext = post.asset_r2_key.split('.').pop() ?? 'jpg';
        const fname = `${(post.slug ?? post.id).replace(/[^a-z0-9-]/gi, '-')}.${ext}`;
        const altText = `${post.target_keyword ?? post.title ?? client.canonical_name} | ${client.canonical_name}`;
        legacyMedia = await wp.uploadMediaBlob(blob, fname, altText, post.title ?? '');
        featuredMediaId = legacyMedia.id;
        await updatePost(env.DB, post.id, { wp_featured_media_id: featuredMediaId });
      }
    } catch (err) {
      warnings.push(`Featured image upload failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (featuredMediaId) {
    try {
      legacyMedia = await wp.getMedia(featuredMediaId);
    } catch (err) {
      warnings.push(`Featured image lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Per-slot body images from posts.blog_body_images JSON.
  let slotHtml: { slot1?: string; slot2?: string; slot3?: string } = {};
  const stored = parseBlogBodyImages(post.blog_body_images);
  let mutatedStored = false;

  for (const img of stored) {
    if (!img.r2_key) continue;
    let mediaId = img.wp_media_id ?? null;
    let media: WpMediaItem | null = null;

    if (!mediaId && imageMode !== 'none') {
      try {
        const r2Obj = await env.MEDIA.get(img.r2_key);
        if (r2Obj) {
          const blob = await new Response(r2Obj.body).blob();
          const ext = img.r2_key.split('.').pop() ?? 'webp';
          const base = (post.slug ?? post.id).replace(/[^a-z0-9-]/gi, '-');
          const fname = `${base}-body-${img.slot}.${ext}`;
          const altText = `${post.target_keyword ?? post.title ?? client.canonical_name} | slot ${img.slot}`;
          media = await wp.uploadMediaBlob(blob, fname, altText, post.title ?? '');
          mediaId = media.id;
          img.wp_media_id = mediaId;
          mutatedStored = true;
        }
      } catch (err) {
        warnings.push(`Body image slot ${img.slot} upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (mediaId && !media) {
      try { media = await wp.getMedia(mediaId); } catch { /* best effort */ }
    }

    if (media) {
      const caption = post.title ?? client.canonical_name;
      const html = buildBodyImageHtml(media, caption);
      if (img.slot === 1) slotHtml.slot1 = html;
      if (img.slot === 2) slotHtml.slot2 = html;
      if (img.slot === 3) slotHtml.slot3 = html;
    }
  }

  if (mutatedStored) {
    await updatePost(env.DB, post.id, { blog_body_images: serializeBlogBodyImages(stored) });
  }

  // Backfill slot1 from legacy featured media if no per-slot slot1 was uploaded yet.
  if (!slotHtml.slot1 && legacyMedia) {
    slotHtml.slot1 = buildBodyImageHtml(legacyMedia, post.title ?? client.canonical_name);
  }

  slotHtml = uniqueImageHtmlBySource(slotHtml);

  const bodyImageHtml =
    slotHtml.slot1 ?? (legacyMedia ? buildBodyImageHtml(legacyMedia, post.title ?? client.canonical_name) : '');

  return { featuredMediaId, bodyImageHtml, slotHtml };
}

async function buildPublishHtml(
  env: Env,
  post: PostRow,
  client: ClientRow,
  bodyImageHtml: string,
  slotHtml: { slot1?: string; slot2?: string; slot3?: string },
): Promise<string> {
  let htmlContent = post.blog_content ?? '';
  const templateKey = (client as ClientRow & { wp_template_key?: string | null }).wp_template_key;
  let appliedCustomTemplate = false;

  if (templateKey) {
    const tpl = await env.DB
      .prepare(
        `SELECT html_template, css FROM wp_templates
         WHERE template_key = ? AND (client_id = ? OR client_id IS NULL)
         ORDER BY client_id IS NOT NULL DESC LIMIT 1`,
      )
      .bind(templateKey, client.id)
      .first<{ html_template: string; css: string | null }>();

    if (tpl) {
      const tokens: TemplateTokens = {
        title: post.title ?? '',
        content: htmlContent,
        excerpt: post.blog_excerpt ?? post.master_caption ?? '',
        keyword: post.target_keyword ?? '',
        meta_description: post.meta_description ?? '',
        client_name: client.canonical_name,
        cta: client.cta_text ?? '',
        phone: client.phone ?? '',
        primary_color: getPrimaryColor(client),
      };
      htmlContent = renderTemplate(tpl.html_template, tokens);
      if (tpl.css) htmlContent = `<style>\n${tpl.css}\n</style>\n${htmlContent}`;
      htmlContent = withWordPressBlogChrome(htmlContent);
      appliedCustomTemplate = true;
    }
  }

  if (!appliedCustomTemplate && post.blog_content) {
    const structured = sanitizeStructuredBlogContent(extractStructuredBlogContent(post.blog_content, {
      title: post.title ?? '',
      excerpt: post.blog_excerpt ?? post.master_caption ?? '',
      focusKeyword: post.target_keyword?.trim() || client.industry?.trim() || post.title?.trim() || '',
      secondaryKeywords: post.secondary_keywords?.trim() ?? '',
      seoTitle: post.seo_title?.trim() || post.title?.trim() || '',
      metaDescription: post.meta_description?.trim() || (post.blog_excerpt?.trim() ?? '').slice(0, 155),
      slug: post.slug ?? '',
      intro: post.blog_excerpt ?? post.master_caption ?? '',
      sections: [{ heading: post.title ?? 'Overview', html: post.blog_content }],
      faq: [],
      ctaHeading: client.cta_text ?? 'Talk With Our Team',
      ctaBody: `Contact ${client.canonical_name} for guidance tailored to your needs.`,
      ctaButtonLabel: client.cta_text ?? 'Contact Us Today',
      imagePrompt: post.ai_image_prompt ?? undefined,
    })).blog;
    const templateConfig = resolveBlogTemplateConfig({
      slug: client.slug,
      canonical_name: client.canonical_name,
      industry: client.industry,
      state: client.state,
      brand_json: client.brand_json,
      wp_template_key: templateKey ?? client.wp_template_key,
      cta_text: client.cta_text,
      brand_primary_color: (client as ClientRow & { brand_primary_color?: string | null }).brand_primary_color ?? null,
    });
    htmlContent = renderStructuredBlogHtml({
      templateKey: inferBusinessTemplateKey({
        wp_template_key: templateKey ?? null,
        industry: client.industry,
      }),
      primaryColor: getPrimaryColor(client),
      accentColor: templateConfig.accentColor,
      clientName: client.canonical_name,
      clientSlug: client.slug,
      industry: client.industry,
      publishDate: post.publish_date,
      phone: client.phone,
      ctaDefault: client.cta_text,
      template: templateConfig,
      bodyImageHtml,
      bodyImages: slotHtml,
      blog: structured,
    });
  }

  // Fill any numbered placeholders that survived from stored HTML (older posts
  // were rendered with only the generic placeholder — newer ones carry the
  // numbered placeholders). The single-placeholder fallback keeps slot 1
  // populated for legacy posts that don't have per-slot data yet.
  const withSlots = injectBodyImagesIntoHtml(htmlContent, {
    slot1: slotHtml.slot1 ?? bodyImageHtml,
    slot2: slotHtml.slot2,
    slot3: slotHtml.slot3,
  });
  return injectBodyImageIntoHtml(withSlots, slotHtml.slot1 ?? bodyImageHtml);
}

export async function publishBlogPost(env: Env, postId: string, options: PublishBlogOptions = {}): Promise<PublishBlogResult> {
  const post = await getPostById(env.DB, postId);
  if (!post) throw new Error('Post not found');

  const client = await getClientWithConfig(env.DB, post.client_id);
  if (!client) throw new Error('Client not found');

  const validationContext = await loadBlogValidationContext(env.DB, client);
  const check = preflightBlogPost(post, validationContext);
  if (!check.ok) {
    await auditBlogStep(env.DB, options, 'blog.validation.failed', post.id, {
      client_id: client.id,
      errors: check.errors,
      warnings: check.warnings,
    });
    throw new Error(`Blog preflight failed: ${check.errors.join('; ')}`);
  }
  await auditBlogStep(env.DB, options, 'blog.validation.passed', post.id, {
    client_id: client.id,
    warnings: check.warnings,
  });

  const wp = buildWordPressClient(client);
  if (!wp) {
    throw new Error('WordPress not configured for this client');
  }

  const wpStatus = options.status
    ?? options.defaultStatus
    ?? ((client as ClientRow & { wp_default_post_status?: string | null }).wp_default_post_status === 'publish' ? 'publish' : 'draft');

  const warnings = [...check.warnings];
  const templateConfig = resolveBlogTemplateConfig({
    slug: client.slug,
    canonical_name: client.canonical_name,
    industry: client.industry,
    state: client.state,
    brand_json: client.brand_json,
    wp_template_key: client.wp_template_key,
    cta_text: client.cta_text,
    brand_primary_color: (client as ClientRow & { brand_primary_color?: string | null }).brand_primary_color ?? null,
  });
  await auditBlogStep(env.DB, options, 'blog.template.selected', post.id, {
    client_id: client.id,
    client_slug: client.slug,
    template_key: templateConfig.key,
    template_label: templateConfig.label,
  });
  const postWithImages = await ensurePostBodyImages(env, post, client, warnings);
  const { featuredMediaId, bodyImageHtml, slotHtml } = await ensureFeaturedMedia(env, postWithImages, client, warnings);
  await auditBlogStep(env.DB, options, 'blog.images.selected', post.id, {
    client_id: client.id,
    featured_media_id: featuredMediaId,
    body_image_slots: Object.keys(slotHtml).filter((key) => Boolean(slotHtml[key as keyof typeof slotHtml])),
    warnings,
  });

  let categoryIds: number[] = [];
  try {
    const rawCats = (client as ClientRow & { wp_default_category_ids?: string | null }).wp_default_category_ids ?? '[]';
    categoryIds = JSON.parse(rawCats);
  } catch {
    categoryIds = [];
  }

  const focusKeyword = post.target_keyword?.trim() || client.industry?.trim() || post.title?.trim() || '';
  const seoTitle = post.seo_title?.trim() || post.title?.trim() || '';
  const metaDescription = post.meta_description?.trim() || (post.blog_excerpt?.trim() ?? '').slice(0, 155);
  const secondaryKeywords = post.secondary_keywords?.trim() ?? '';
  const rankMathMeta: Record<string, string> = {};
  if (focusKeyword) {
    rankMathMeta.rank_math_focus_keyword = focusKeyword;
    rankMathMeta.rank_math_pillar_content = 'off';
    rankMathMeta.rank_math_schema_type = 'Article';
  }
  if (metaDescription) {
    rankMathMeta.rank_math_description = metaDescription;
    rankMathMeta.rank_math_twitter_description = metaDescription;
    rankMathMeta.rank_math_facebook_description = metaDescription;
  }
  if (seoTitle) {
    rankMathMeta.rank_math_title = seoTitle.includes('%') ? seoTitle : `${seoTitle} %sep% %sitename%`;
    rankMathMeta.rank_math_facebook_title = seoTitle;
    rankMathMeta.rank_math_twitter_title = seoTitle;
  }
  if (secondaryKeywords) rankMathMeta.rank_math_secondary_keywords = secondaryKeywords;

  const htmlContent = await buildPublishHtml(env, postWithImages, client, bodyImageHtml, slotHtml);
  const excerpt = postWithImages.blog_excerpt ?? postWithImages.master_caption ?? '';
  await auditBlogStep(env.DB, options, 'blog.created', post.id, {
    client_id: client.id,
    title: postWithImages.title,
    target_keyword: postWithImages.target_keyword,
    slug: postWithImages.slug,
  });

  let existingWpId = post.wp_post_id ?? null;
  if (!existingWpId && postWithImages.slug) {
    try {
      const matches = await wp.findPostsBySlug(postWithImages.slug);
      const linked = chooseCanonicalWpPost(matches, postWithImages.slug);
      if (linked) existingWpId = linked.id;
    } catch (err) {
      warnings.push(`WordPress slug lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const payload = {
    title: postWithImages.title ?? '',
    content: htmlContent,
    excerpt,
    status: wpStatus,
    slug: postWithImages.slug ?? undefined,
    featured_media: featuredMediaId ?? undefined,
    meta: Object.keys(rankMathMeta).length > 0 ? rankMathMeta : undefined,
  };

  const wpPost = existingWpId
    ? await wp.updatePost(existingWpId, payload)
    : await wp.createPost({
        ...payload,
        author: (client as ClientRow & { wp_default_author_id?: number | null }).wp_default_author_id ?? undefined,
        categories: categoryIds.length > 0 ? categoryIds : undefined,
      });
  await auditBlogStep(env.DB, options, 'blog.published', post.id, {
    client_id: client.id,
    wp_post_id: wpPost.id,
    wp_post_url: wpPost.link,
    wp_post_status: wpPost.status,
    featured_media_id: featuredMediaId ?? wpPost.featured_media ?? null,
  });

  const nextStatus = wpPost.status === 'publish' ? 'posted' : (wpPost.status === 'draft' ? 'draft' : post.status);
  const now = Math.floor(Date.now() / 1000);
  const blogUrl = wpPost.link;

  // Replace [blog_url] placeholder in distribution captions now that the URL is known
  const CAPTION_FIELDS = [
    'cap_google_business',
    'cap_linkedin',
    'cap_facebook',
    'cap_instagram',
    'cap_x',
    'cap_threads',
    'cap_pinterest',
    'cap_bluesky',
    'master_caption',
  ] as const;
  const captionUpdates: Partial<Record<typeof CAPTION_FIELDS[number], string>> = {};
  for (const field of CAPTION_FIELDS) {
    const current = post[field as keyof typeof post] as string | null | undefined;
    if (typeof current === 'string' && current.includes('[blog_url]')) {
      captionUpdates[field] = current.replace(/\[blog_url\]/g, blogUrl);
    }
  }

  await updatePost(env.DB, post.id, {
    status: nextStatus,
    ready_for_automation: 0,
    wp_post_id: wpPost.id,
    wp_post_url: blogUrl,
    wp_post_status: wpPost.status,
    slug: wpPost.slug ?? post.slug,
    wp_featured_media_id: featuredMediaId ?? wpPost.featured_media ?? null,
    posted_at: wpPost.status === 'publish' ? now : post.posted_at,
    // GBP: set LEARN_MORE CTA pointing to the live blog URL
    gbp_cta_type: 'LEARN_MORE',
    gbp_cta_url: blogUrl,
    ...captionUpdates,
  });

  const refreshed = await getPostById(env.DB, post.id);
  if (!refreshed) throw new Error('Post disappeared after WordPress sync');
  const distributionResult = await syncBlogDistributionPost(env, refreshed, client, options);
  if (distributionResult.action === 'skipped') {
    warnings.push('No connected non-video distribution platforms available for this client');
  } else {
    warnings.push(`Distribution post ${distributionResult.action} for ${distributionResult.platforms.join(', ')}`);
  }

  return {
    post: refreshed,
    client,
    wpPost,
    warnings,
    htmlContent,
    featuredMediaId: featuredMediaId ?? wpPost.featured_media ?? null,
  };
}
