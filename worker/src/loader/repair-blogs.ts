import type { ClientRow, Env, PostRow } from '../types';
import { updatePost } from '../db/queries';
import {
  buildWordPressClient,
  extractStructuredBlogContent,
  inferBusinessTemplateKey,
  injectBodyImageIntoHtml,
  renderStructuredBlogHtml,
  stripHtml,
  type StructuredBlogContent,
  type WpMediaItem,
  type WpPost,
} from '../services/wordpress';
import { isBlogAutomationEligible, isBlogDueForAutomation, publishBlogPost } from '../modules/blog-publishing';
import { ensureBlogBodyImagesGenerated } from './autonomous-content';
import { parseBlogBodyImages, serializeBlogBodyImages } from '../modules/blog-body-images';
import { resolveStabilityApiKeys } from '../services/stability';

const REPAIR_KEY = 'repair-posts-2026-04-14-webxni';

export interface BlogAuditItem {
  post_id: string;
  client: string;
  title: string;
  status: 'compliant' | 'partially_broken' | 'broken';
  fixed: boolean;
  issues: string[];
}

export interface BlogRepairStats {
  reviewed: number;
  compliant: number;
  partially_broken: number;
  broken: number;
  fixed: number;
  items: BlogAuditItem[];
}

export function isRepairKeyValid(value: string | null | undefined): boolean {
  return value === REPAIR_KEY;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function trimTo(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function dedupeKeywords(values: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const cleaned = normalizeSpaces(String(raw ?? ''))
      .replace(/[|;/]+/g, ',')
      .split(',')
      .map((part) => normalizeSpaces(part))
      .filter(Boolean);
    for (const item of cleaned) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
  }
  return result.slice(0, 6).join(', ');
}

function isStructuredTemplateHtml(html: string | null): boolean {
  return Boolean(html && html.includes('class="wx-blog"'));
}

function deriveExcerpt(post: PostRow): string {
  const existing = stringValue(post.blog_excerpt) ?? stringValue(post.master_caption);
  if (existing) return trimTo(existing, 155);
  return trimTo(stripHtml(post.blog_content ?? ''), 155);
}

function deriveFocusKeyword(post: PostRow, client: ClientRow): string {
  return stringValue(post.target_keyword)
    ?? stringValue(client.industry)
    ?? stringValue(post.title)
    ?? client.canonical_name;
}

function deriveSecondaryKeywords(post: PostRow, client: ClientRow): string {
  const title = stringValue(post.title);
  const focus = stringValue(post.target_keyword);
  const industry = stringValue(client.industry);
  const state = stringValue(client.state);
  return dedupeKeywords([
    post.secondary_keywords,
    focus ? `${focus} tips` : null,
    focus ? `${focus} guide` : null,
    industry ? `${industry} services` : null,
    title ? title.replace(/[:|,-].*$/, '') : null,
    state && industry ? `${industry} ${state}` : state,
  ]);
}

function deriveSeoTitle(post: PostRow, client: ClientRow): string {
  return trimTo(
    stringValue(post.seo_title)
      ?? stringValue(post.title)
      ?? `${client.canonical_name} Insights`,
    60,
  );
}

function deriveMetaDescription(post: PostRow, client: ClientRow): string {
  return trimTo(
    stringValue(post.meta_description)
      ?? stringValue(post.blog_excerpt)
      ?? stringValue(post.master_caption)
      ?? `${client.canonical_name} shares practical guidance about ${deriveFocusKeyword(post, client)}.`,
    155,
  );
}

function deriveImagePrompt(post: PostRow, client: ClientRow): string {
  const legacy = stringValue((post as PostRow & { featured_image_prompt?: string | null }).featured_image_prompt);
  return stringValue(post.ai_image_prompt)
    ?? legacy
    ?? `Professional editorial blog image for ${client.canonical_name} about ${deriveFocusKeyword(post, client)}. Clean composition, brand-safe, realistic, high trust.`;
}

function buildStructuredBlog(post: PostRow, client: ClientRow): StructuredBlogContent {
  const title = stringValue(post.title) ?? `${client.canonical_name} Guide`;
  const fallback = {
    title,
    excerpt: deriveExcerpt(post),
    focusKeyword: deriveFocusKeyword(post, client),
    secondaryKeywords: deriveSecondaryKeywords(post, client),
    seoTitle: deriveSeoTitle(post, client),
    metaDescription: deriveMetaDescription(post, client),
    slug: stringValue(post.slug) ?? slugify(title),
    imagePrompt: deriveImagePrompt(post, client),
  };
  const parsed = extractStructuredBlogContent(post.blog_content, {
    ...fallback,
    intro: undefined,
    sections: undefined,
    faq: [],
    ctaHeading: stringValue(client.cta_text) ?? `Talk With ${client.canonical_name}`,
    ctaBody: `Connect with ${client.canonical_name} for guidance tailored to your goals, timeline, and property needs.`,
    ctaButtonLabel: stringValue(client.cta_text) ?? 'Contact Us Today',
  });
  return {
    ...parsed,
    imagePrompt: deriveImagePrompt(post, client),
  };
}

function buildBodyImageHtml(media: WpMediaItem | null, caption: string): string {
  if (!media?.source_url) return '';
  const alt = (media.alt_text || caption).replace(/"/g, '&quot;');
  return `<img src="${media.source_url}" alt="${alt}" /><figcaption>${caption.replace(/</g, '&lt;')}</figcaption>`;
}

function chooseCanonicalWpPost(posts: WpPost[], slug: string): WpPost | null {
  if (posts.length === 0) return null;
  const scored = [...posts].sort((a, b) => {
    const score = (post: WpPost): number => {
      let value = 0;
      if (post.slug === slug) value += 5;
      if (post.status === 'publish') value += 4;
      if (post.status === 'draft') value += 2;
      return value + (post.id / 100000);
    };
    return score(b) - score(a);
  });
  return scored[0] ?? null;
}

async function listBlogPosts(db: D1Database): Promise<PostRow[]> {
  const result = await db.prepare(`SELECT * FROM posts WHERE content_type = 'blog' ORDER BY created_at DESC`).all<PostRow>();
  return result.results;
}

async function listBlogClients(db: D1Database): Promise<Map<string, ClientRow>> {
  const result = await db.prepare(
    `SELECT * FROM clients WHERE id IN (SELECT DISTINCT client_id FROM posts WHERE content_type = 'blog')`,
  ).all<ClientRow>();
  return new Map(result.results.map((row) => [row.id, row]));
}

async function uploadFeaturedMediaIfNeeded(env: Env, post: PostRow, client: ClientRow, existingMediaId: number | null): Promise<{
  mediaId: number | null;
  media: WpMediaItem | null;
  uploaded: boolean;
}> {
  const wp = buildWordPressClient(client);
  if (!wp) return { mediaId: existingMediaId, media: null, uploaded: false };

  if (existingMediaId) {
    try {
      return { mediaId: existingMediaId, media: await wp.getMedia(existingMediaId), uploaded: false };
    } catch {
      return { mediaId: existingMediaId, media: null, uploaded: false };
    }
  }

  if (!post.asset_r2_key) return { mediaId: null, media: null, uploaded: false };

  const bucket = post.asset_r2_bucket === 'IMAGES' ? env.IMAGES : env.MEDIA;
  const object = await bucket.get(post.asset_r2_key);
  if (!object) return { mediaId: null, media: null, uploaded: false };

  const blob = await new Response(object.body).blob();
  const ext = post.asset_r2_key.split('.').pop() ?? 'jpg';
  const filename = `${(post.slug ?? post.id).replace(/[^a-z0-9-]/gi, '-')}.${ext}`;
  const altText = `${deriveFocusKeyword(post, client)} | ${client.canonical_name}`;
  const uploaded = await wp.uploadMediaBlob(blob, filename, altText, post.title ?? client.canonical_name);
  return { mediaId: uploaded.id, media: uploaded, uploaded: true };
}

export async function repairExistingBlogs(env: Env): Promise<BlogRepairStats> {
  const { openAiKey, stabilityKey } = await resolveStabilityApiKeys(env);
  const [posts, clientMap] = await Promise.all([
    listBlogPosts(env.DB),
    listBlogClients(env.DB),
  ]);

  const items: BlogAuditItem[] = [];
  let compliant = 0;
  let partiallyBroken = 0;
  let broken = 0;
  let fixed = 0;

  for (const post of posts) {
    const client = clientMap.get(post.client_id);
    if (!client) continue;

    const issues: string[] = [];
    let didFix = false;
    const structured = isStructuredTemplateHtml(post.blog_content);
    if (!structured) issues.push('Old raw HTML instead of structured template layout');
    if (!stringValue(post.blog_excerpt)) issues.push('Missing excerpt');
    if (!stringValue(post.target_keyword)) issues.push('Missing Rank Math focus keyword');
    if (!stringValue(post.secondary_keywords)) issues.push('Missing secondary keywords');
    if (!stringValue(post.seo_title)) issues.push('Missing SEO title');
    if (!stringValue(post.meta_description)) issues.push('Missing meta description');
    if (!stringValue(post.slug)) issues.push('Missing slug');
    if (!stringValue(post.ai_image_prompt) && !stringValue((post as PostRow & { featured_image_prompt?: string | null }).featured_image_prompt)) {
      issues.push('Missing image prompt');
    }
    const storedImages = parseBlogBodyImages(post.blog_body_images);
    if (storedImages.filter((img) => img.r2_key).length < 3) {
      issues.push('Missing structured body images');
    }
    if (client.wp_template_key && !structured) {
      issues.push(`Configured template key "${client.wp_template_key}" has no reusable WP template fallback stored locally`);
    }

    const wp = buildWordPressClient(client);
    let linkedWpPost: WpPost | null = null;
    let mediaId = post.wp_featured_media_id ?? null;
    let media: WpMediaItem | null = null;

    if (wp && stringValue(post.slug)) {
      try {
        if (post.wp_post_id) {
          linkedWpPost = await wp.getPost(post.wp_post_id);
        } else {
          const matches = await wp.findPostsBySlug(post.slug!);
          if (matches.length > 0) {
            linkedWpPost = chooseCanonicalWpPost(matches, post.slug!);
            if (linkedWpPost) issues.push('WordPress post existed but local wp_post_id was missing');
          }
        }
      } catch (err) {
        issues.push(`WordPress sync lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (post.wp_post_id && !linkedWpPost) {
      issues.push('Local wp_post_id exists but WordPress post could not be loaded');
    }
    if (linkedWpPost && !stringValue(post.wp_post_url)) issues.push('Missing local WordPress URL');
    if (linkedWpPost && !stringValue(post.wp_post_status)) issues.push('Missing local WordPress status');
    if (linkedWpPost && linkedWpPost.featured_media && !post.wp_featured_media_id) {
      issues.push('Missing local featured media ID');
      mediaId = linkedWpPost.featured_media;
    }

    const structuredBlog = buildStructuredBlog(post, client);
    let nextBlogBodyImages = post.blog_body_images;
    if (stabilityKey) {
      try {
        const generatedImages = await ensureBlogBodyImagesGenerated(env, openAiKey, stabilityKey, {
          blogTitle: structuredBlog.title,
          blogContent: post.blog_content,
          targetKeyword: structuredBlog.focusKeyword,
          serviceType: structuredBlog.focusKeyword || client.industry || '',
          industry: client.industry ?? '',
          location: client.state ?? '',
          clientName: client.canonical_name,
          clientId: client.id,
          existing: storedImages,
          regenerateWeakPrompts: true,
        });
        const serialized = serializeBlogBodyImages(generatedImages);
        if (serialized !== (post.blog_body_images ?? null)) {
          nextBlogBodyImages = serialized;
          didFix = true;
        }
      } catch (err) {
        issues.push(`Body image generation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (storedImages.filter((img) => img.r2_key).length < 3) {
      issues.push('Structured body images skipped because STABILITY_API_KEY is not configured');
    }

    const hasImageCandidate = Boolean(post.asset_r2_key || mediaId || linkedWpPost?.featured_media);
    const templateKey = inferBusinessTemplateKey({
      wp_template_key: client.wp_template_key,
      industry: client.industry,
    });
    const storedHtml = renderStructuredBlogHtml({
      templateKey,
      primaryColor: client.brand_json ? (() => {
        try {
          const parsed = JSON.parse(client.brand_json);
          return parsed.primary_color ?? parsed.primaryColor ?? '#1a73e8';
        } catch {
          return '#1a73e8';
        }
      })() : '#1a73e8',
      clientName: client.canonical_name,
      phone: client.phone,
      ctaDefault: client.cta_text,
      bodyImageHtml: hasImageCandidate ? undefined : '',
      blog: structuredBlog,
    });

    if (wp && (linkedWpPost || post.asset_r2_key)) {
      try {
        const mediaResult = await uploadFeaturedMediaIfNeeded(env, post, client, mediaId);
        mediaId = mediaResult.mediaId;
        media = mediaResult.media;
        if (mediaResult.uploaded || mediaId !== (post.wp_featured_media_id ?? null)) didFix = true;
      } catch (err) {
        issues.push(`Featured image sync failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!media && wp && mediaId) {
      try {
        media = await wp.getMedia(mediaId);
      } catch (err) {
        issues.push(`Featured media lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const bodyImageHtml = buildBodyImageHtml(media, post.title ?? client.canonical_name);
    const wpHtml = bodyImageHtml ? injectBodyImageIntoHtml(storedHtml, bodyImageHtml) : storedHtml;

    const nextFields: Partial<PostRow> = {
      blog_content: storedHtml,
      blog_excerpt: structuredBlog.excerpt,
      seo_title: structuredBlog.seoTitle,
      meta_description: structuredBlog.metaDescription,
      target_keyword: structuredBlog.focusKeyword,
      secondary_keywords: structuredBlog.secondaryKeywords ?? null,
      slug: structuredBlog.slug,
      ai_image_prompt: structuredBlog.imagePrompt ?? null,
      blog_body_images: nextBlogBodyImages,
    };

    if (mediaId) nextFields.wp_featured_media_id = mediaId;
    if (
      nextFields.blog_content !== post.blog_content ||
      nextFields.blog_excerpt !== post.blog_excerpt ||
      nextFields.seo_title !== post.seo_title ||
      nextFields.meta_description !== post.meta_description ||
      nextFields.target_keyword !== post.target_keyword ||
      nextFields.secondary_keywords !== post.secondary_keywords ||
      nextFields.slug !== post.slug ||
      nextFields.ai_image_prompt !== post.ai_image_prompt ||
      nextFields.blog_body_images !== post.blog_body_images ||
      nextFields.wp_featured_media_id !== (post.wp_featured_media_id ?? undefined)
    ) {
      await updatePost(env.DB, post.id, nextFields);
      didFix = true;
    }

    if (wp && linkedWpPost) {
      const rankMathMeta: Record<string, string> = {
        rank_math_focus_keyword: structuredBlog.focusKeyword,
        rank_math_title: structuredBlog.seoTitle.includes('%') ? structuredBlog.seoTitle : `${structuredBlog.seoTitle} %sep% %sitename%`,
        rank_math_description: structuredBlog.metaDescription,
        rank_math_schema_type: 'Article',
        rank_math_pillar_content: 'off',
        rank_math_facebook_title: structuredBlog.seoTitle,
        rank_math_facebook_description: structuredBlog.metaDescription,
        rank_math_twitter_title: structuredBlog.seoTitle,
        rank_math_twitter_description: structuredBlog.metaDescription,
      };
      if (structuredBlog.secondaryKeywords) {
        rankMathMeta.rank_math_secondary_keywords = structuredBlog.secondaryKeywords;
      }

      try {
        const synced = await wp.updatePost(linkedWpPost.id, {
          title: structuredBlog.title,
          content: wpHtml,
          excerpt: structuredBlog.excerpt,
          status: linkedWpPost.status,
          slug: structuredBlog.slug,
          featured_media: mediaId ?? linkedWpPost.featured_media,
          meta: rankMathMeta,
        });
        await updatePost(env.DB, post.id, {
          status: synced.status === 'publish' ? 'posted' : 'draft',
          ready_for_automation: 0,
          wp_post_id: synced.id,
          wp_post_url: synced.link,
          wp_post_status: synced.status,
          slug: synced.slug ?? structuredBlog.slug,
          wp_featured_media_id: mediaId ?? synced.featured_media ?? null,
        });
        didFix = true;
      } catch (err) {
        issues.push(`WordPress update failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (wp && !linkedWpPost && isBlogAutomationEligible(post) && isBlogDueForAutomation(post)) {
      try {
        const published = await publishBlogPost(env, post.id, {
          status: 'publish',
          defaultStatus: 'publish',
        });
        issues.push(`Published missing WordPress post automatically (wp_post_id=${published.wpPost.id})`);
        didFix = true;
      } catch (err) {
        issues.push(`WordPress publish failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const postStatus: BlogAuditItem['status'] =
      issues.length === 0 ? 'compliant' : issues.length <= 3 ? 'partially_broken' : 'broken';

    if (postStatus === 'compliant') compliant += 1;
    else if (postStatus === 'partially_broken') partiallyBroken += 1;
    else broken += 1;
    if (didFix) fixed += 1;

    items.push({
      post_id: post.id,
      client: client.canonical_name,
      title: post.title ?? post.id,
      status: postStatus,
      fixed: didFix,
      issues,
    });
  }

  return {
    reviewed: items.length,
    compliant,
    partially_broken: partiallyBroken,
    broken,
    fixed,
    items,
  };
}
