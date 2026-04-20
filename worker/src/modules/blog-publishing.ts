import type { ClientRow, Env, PostRow } from '../types';
import { getClientWithConfig, getPostById, updatePost } from '../db/queries';
import {
  BLOG_BODY_IMAGE_PLACEHOLDER,
  buildWordPressClient,
  extractStructuredBlogContent,
  inferBusinessTemplateKey,
  injectBodyImageIntoHtml,
  renderStructuredBlogHtml,
  renderTemplate,
  withWordPressBlogChrome,
  type TemplateTokens,
  type WpMediaItem,
  type WpPost,
} from '../services/wordpress';

export interface BlogPreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface PublishBlogOptions {
  status?: 'draft' | 'publish' | 'pending';
  forceUpdate?: boolean;
  defaultStatus?: 'draft' | 'publish' | 'pending';
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

  const structured = extractStructuredBlogContent(rawHtml, {
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
  });

  return {
    ...data,
    blog_content: renderStructuredBlogHtml({
      templateKey: inferBusinessTemplateKey({
        wp_template_key: client.wp_template_key ?? null,
        industry: client.industry ?? null,
      }),
      primaryColor: getPrimaryColor(client),
      clientName: client.canonical_name,
      phone: client.phone ?? null,
      ctaDefault: client.cta_text ?? null,
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
}): BlogPreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (post.content_type !== 'blog') errors.push('Post content_type is not "blog"');
  if (!post.blog_content || post.blog_content.length < 200) errors.push('Blog content is missing or too short');
  if (!post.title) errors.push('Post title is required');
  if (!post.seo_title) warnings.push('SEO title missing — WordPress will use the post title');
  if (!post.meta_description) warnings.push('Meta description missing — Rank Math will generate one');
  if (!post.target_keyword) errors.push('Target keyword is required for Rank Math integration');
  if (!post.slug) warnings.push('URL slug missing — WordPress will auto-generate one');
  if (!post.blog_excerpt) warnings.push('Blog excerpt missing — WordPress excerpt field will be empty');
  if (!post.ai_image_prompt) warnings.push('Image prompt missing — alt text and body image context may be weaker');

  return { ok: errors.length === 0, errors, warnings };
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
  return `<img src="${media.source_url}" alt="${alt}" /><figcaption>${caption.replace(/</g, '&lt;')}</figcaption>`;
}

async function ensureFeaturedMedia(env: Env, post: PostRow, client: ClientRow, warnings: string[]): Promise<{
  featuredMediaId: number | null;
  bodyImageHtml: string;
}> {
  const wp = buildWordPressClient(client);
  if (!wp) return { featuredMediaId: post.wp_featured_media_id ?? null, bodyImageHtml: post.asset_r2_key ? BLOG_BODY_IMAGE_PLACEHOLDER : '' };

  let featuredMediaId = post.wp_featured_media_id ?? null;
  let media: WpMediaItem | null = null;

  if (!featuredMediaId && post.asset_r2_key) {
    const imageMode = (client as ClientRow & { wp_featured_image_mode?: string | null }).wp_featured_image_mode ?? 'upload';
    if (imageMode !== 'none') {
      try {
        const bucket = post.asset_r2_bucket === 'IMAGES' ? env.IMAGES : env.MEDIA;
        const r2Obj = await bucket.get(post.asset_r2_key);
        if (r2Obj) {
          const blob = await new Response(r2Obj.body).blob();
          const ext = post.asset_r2_key.split('.').pop() ?? 'jpg';
          const fname = `${(post.slug ?? post.id).replace(/[^a-z0-9-]/gi, '-')}.${ext}`;
          const altText = `${post.target_keyword ?? post.title ?? client.canonical_name} | ${client.canonical_name}`;
          media = await wp.uploadMediaBlob(blob, fname, altText, post.title ?? '');
          featuredMediaId = media.id;
          await updatePost(env.DB, post.id, { wp_featured_media_id: featuredMediaId });
        }
      } catch (err) {
        warnings.push(`Featured image upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else if (featuredMediaId) {
    try {
      media = await wp.getMedia(featuredMediaId);
    } catch (err) {
      warnings.push(`Featured image lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!post.asset_r2_key) return { featuredMediaId, bodyImageHtml: '' };
  return {
    featuredMediaId,
    bodyImageHtml: media ? buildBodyImageHtml(media, post.title ?? client.canonical_name) : BLOG_BODY_IMAGE_PLACEHOLDER,
  };
}

async function buildPublishHtml(env: Env, post: PostRow, client: ClientRow, bodyImageHtml: string): Promise<string> {
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
    htmlContent = renderStructuredBlogHtml({
      templateKey: inferBusinessTemplateKey({
        wp_template_key: templateKey ?? null,
        industry: client.industry,
      }),
      primaryColor: getPrimaryColor(client),
      clientName: client.canonical_name,
      phone: client.phone,
      ctaDefault: client.cta_text,
      bodyImageHtml,
      blog: extractStructuredBlogContent(post.blog_content, {
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
      }),
    });
  }

  return injectBodyImageIntoHtml(htmlContent, bodyImageHtml);
}

export async function publishBlogPost(env: Env, postId: string, options: PublishBlogOptions = {}): Promise<PublishBlogResult> {
  const post = await getPostById(env.DB, postId);
  if (!post) throw new Error('Post not found');

  const check = preflightBlogPost(post);
  if (!check.ok) {
    throw new Error(`Blog preflight failed: ${check.errors.join('; ')}`);
  }

  const client = await getClientWithConfig(env.DB, post.client_id);
  if (!client) throw new Error('Client not found');

  const wp = buildWordPressClient(client);
  if (!wp) {
    throw new Error('WordPress not configured for this client');
  }

  const wpStatus = options.status
    ?? options.defaultStatus
    ?? ((client as ClientRow & { wp_default_post_status?: string | null }).wp_default_post_status === 'publish' ? 'publish' : 'draft');

  const warnings = [...check.warnings];
  const { featuredMediaId, bodyImageHtml } = await ensureFeaturedMedia(env, post, client, warnings);

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

  const htmlContent = await buildPublishHtml(env, post, client, bodyImageHtml);
  const excerpt = post.blog_excerpt ?? post.master_caption ?? '';

  let existingWpId = post.wp_post_id ?? null;
  if (!existingWpId && post.slug) {
    try {
      const matches = await wp.findPostsBySlug(post.slug);
      const linked = chooseCanonicalWpPost(matches, post.slug);
      if (linked) existingWpId = linked.id;
    } catch (err) {
      warnings.push(`WordPress slug lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const payload = {
    title: post.title ?? '',
    content: htmlContent,
    excerpt,
    status: wpStatus,
    slug: post.slug ?? undefined,
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

  const nextStatus = wpPost.status === 'publish' ? 'posted' : (wpPost.status === 'draft' ? 'draft' : post.status);
  const now = Math.floor(Date.now() / 1000);
  await updatePost(env.DB, post.id, {
    status: nextStatus,
    ready_for_automation: 0,
    wp_post_id: wpPost.id,
    wp_post_url: wpPost.link,
    wp_post_status: wpPost.status,
    slug: wpPost.slug ?? post.slug,
    wp_featured_media_id: featuredMediaId ?? wpPost.featured_media ?? null,
    posted_at: wpPost.status === 'publish' ? now : post.posted_at,
  });

  const refreshed = await getPostById(env.DB, post.id);
  if (!refreshed) throw new Error('Post disappeared after WordPress sync');

  return {
    post: refreshed,
    client,
    wpPost,
    warnings,
    htmlContent,
    featuredMediaId: featuredMediaId ?? wpPost.featured_media ?? null,
  };
}
