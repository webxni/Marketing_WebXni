/**
 * Blog publishing routes
 *   POST /api/posts/:id/publish-blog   — push blog post to WordPress
 *   POST /api/posts/:id/unpublish-blog — revert WP post to draft
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { getPostById, updatePost, getClientWithConfig } from '../db/queries';
import {
  BLOG_BODY_IMAGE_PLACEHOLDER,
  buildWordPressClient,
  inferBusinessTemplateKey,
  injectBodyImageIntoHtml,
  renderStructuredBlogHtml,
  renderTemplate,
  stripHtml,
  type TemplateTokens,
} from '../services/wordpress';
import { requirePermission } from '../middleware/auth';

export const blogRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// ── Preflight validation ───────────────────────────────────────────────────────

interface BlogPreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function preflight(post: {
  content_type:   string | null;
  blog_content:   string | null;
  title:          string | null;
  seo_title:      string | null;
  meta_description: string | null;
  target_keyword: string | null;
  secondary_keywords?: string | null;
  slug:           string | null;
  blog_excerpt:   string | null;
  ai_image_prompt?: string | null;
}): BlogPreflightResult {
  const errors:   string[] = [];
  const warnings: string[] = [];

  if (post.content_type !== 'blog') errors.push('Post content_type is not "blog"');
  if (!post.blog_content || post.blog_content.length < 200) errors.push('Blog content is missing or too short');
  if (!post.title)          errors.push('Post title is required');
  if (!post.seo_title)      warnings.push('SEO title missing — WordPress will use the post title');
  if (!post.meta_description) warnings.push('Meta description missing — Rank Math will generate one');
  if (!post.target_keyword) errors.push('Target keyword is required for Rank Math integration');
  if (!post.slug)           warnings.push('URL slug missing — WordPress will auto-generate one');
  if (!post.blog_excerpt)   warnings.push('Blog excerpt missing — WordPress excerpt field will be empty');
  if (!post.ai_image_prompt) warnings.push('Image prompt missing — alt text and body image context may be weaker');

  return { ok: errors.length === 0, errors, warnings };
}

// ── POST /api/posts/:id/publish-blog ─────────────────────────────────────────

blogRoutes.post('/:id/publish-blog', requirePermission('posts.edit'), async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id') as string);
  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Preflight
  const check = preflight(post as Parameters<typeof preflight>[0]);
  if (!check.ok) return c.json({ error: 'Blog preflight failed', details: check.errors, warnings: check.warnings }, 400);

  const client = await getClientWithConfig(c.env.DB, post.client_id);
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const wp = buildWordPressClient(client);
  if (!wp) {
    return c.json({
      error: 'WordPress not configured for this client',
      hint: 'Set wp_base_url, wp_username, and wp_application_password on the client record',
    }, 400);
  }

  let body: { status?: string; force_update?: boolean } = {};
  try { body = (await c.req.json()) as typeof body; } catch { /* use defaults */ }

  const wpStatus = (body.status === 'publish' || body.status === 'draft' || body.status === 'pending')
    ? body.status as 'draft' | 'publish' | 'pending'
    : ((client as unknown as { wp_default_post_status?: string }).wp_default_post_status ?? 'draft') as 'draft' | 'publish';

  // ── Featured image upload from R2 ────────────────────────────────────────
  let featuredMediaId: number | undefined = (post as unknown as { wp_featured_media_id?: number }).wp_featured_media_id ?? undefined;
  let bodyImageHtml = BLOG_BODY_IMAGE_PLACEHOLDER;

  if (!featuredMediaId && post.asset_r2_key) {
    const imageMode = (client as unknown as { wp_featured_image_mode?: string }).wp_featured_image_mode ?? 'upload';
    if (imageMode !== 'none') {
      try {
        const bucket = post.asset_r2_bucket === 'IMAGES' ? c.env.IMAGES : c.env.MEDIA;
        const r2Obj = await bucket.get(post.asset_r2_key);
        if (r2Obj) {
          const blob    = await new Response(r2Obj.body).blob();
          const ext     = post.asset_r2_key.split('.').pop() ?? 'jpg';
          const fname   = `${(post.slug ?? post.id).replace(/[^a-z0-9-]/gi, '-')}.${ext}`;
          const altText = `${post.target_keyword ?? post.title ?? client.canonical_name} | ${client.canonical_name}`;
          const media   = await wp.uploadMediaBlob(blob, fname, altText, post.title ?? '');
          featuredMediaId = media.id;
          await c.env.DB.prepare('UPDATE posts SET wp_featured_media_id = ? WHERE id = ?')
            .bind(featuredMediaId, post.id).run();
          bodyImageHtml = `
            <img src="${media.source_url}" alt="${altText.replace(/"/g, '&quot;')}" />
            <figcaption>${post.title ?? client.canonical_name}</figcaption>
          `;
        }
      } catch (imgErr) {
        // Non-fatal — log and continue without featured image
        console.warn('[publish-blog] featured image upload failed:', imgErr instanceof Error ? imgErr.message : imgErr);
        check.warnings.push(`Featured image upload failed: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`);
      }
    }
  }
  if (!post.asset_r2_key) bodyImageHtml = '';

  // ── Build categories ──────────────────────────────────────────────────────
  let categoryIds: number[] = [];
  try {
    const rawCats = (client as unknown as { wp_default_category_ids?: string }).wp_default_category_ids ?? '[]';
    categoryIds = JSON.parse(rawCats);
  } catch { /* empty */ }

  // ── Build Rank Math meta ──────────────────────────────────────────────────
  const rankMathMeta: Record<string, string> = {};
  const focusKeyword = post.target_keyword?.trim() || client.industry?.trim() || post.title?.trim() || '';
  const seoTitle = post.seo_title?.trim() || post.title?.trim() || '';
  const metaDescription = post.meta_description?.trim() || (post.blog_excerpt?.trim() ?? '').slice(0, 155);
  const secondaryKeywords = post.secondary_keywords?.trim() ?? '';
  if (focusKeyword) {
    rankMathMeta['rank_math_focus_keyword'] = focusKeyword;
    rankMathMeta['rank_math_pillar_content'] = 'off';
    rankMathMeta['rank_math_schema_type'] = 'Article';
  }
  if (metaDescription) {
    rankMathMeta['rank_math_description'] = metaDescription;
    rankMathMeta['rank_math_twitter_description'] = metaDescription;
    rankMathMeta['rank_math_facebook_description'] = metaDescription;
  }
  if (seoTitle) {
    rankMathMeta['rank_math_title'] = seoTitle.includes('%') ? seoTitle : `${seoTitle} %sep% %sitename%`;
    rankMathMeta['rank_math_facebook_title'] = seoTitle;
    rankMathMeta['rank_math_twitter_title'] = seoTitle;
  }
  if (secondaryKeywords) rankMathMeta['rank_math_secondary_keywords'] = secondaryKeywords;

  // ── Build HTML content (apply WP template if configured) ─────────────────
  let htmlContent = post.blog_content ?? '';
  const templateKey = (client as unknown as { wp_template_key?: string }).wp_template_key;
  if (templateKey) {
    const tpl = await c.env.DB
      .prepare(
        `SELECT html_template, css FROM wp_templates
         WHERE template_key = ? AND (client_id = ? OR client_id IS NULL)
         ORDER BY client_id IS NOT NULL DESC LIMIT 1`,
      )
      .bind(templateKey, client.id)
      .first<{ html_template: string; css: string | null }>();

    if (tpl) {
      const clientCast = client as unknown as {
        brand_primary_color?: string | null;
        phone?: string | null;
        cta_text?: string | null;
      };
      const tokens: TemplateTokens = {
        title:           post.title ?? '',
        content:         htmlContent,
        excerpt:         (post as unknown as { blog_excerpt?: string }).blog_excerpt ?? post.master_caption ?? '',
        keyword:         post.target_keyword ?? '',
        meta_description: post.meta_description ?? '',
        client_name:     client.canonical_name,
        cta:             clientCast.cta_text ?? '',
        phone:           clientCast.phone ?? '',
        primary_color:   clientCast.brand_primary_color ?? '#1a73e8',
      };
      htmlContent = renderTemplate(tpl.html_template, tokens);
      if (tpl.css) {
        htmlContent = `<style scoped>\n${tpl.css}\n</style>\n${htmlContent}`;
      }
    }
  }
  if (!templateKey && post.blog_content) {
    const sections = post.blog_content.split(/<h2[^>]*>/i).filter(Boolean);
    htmlContent = renderStructuredBlogHtml({
      templateKey: inferBusinessTemplateKey({
        wp_template_key: templateKey ?? null,
        industry: client.industry,
      }),
      primaryColor: (client as unknown as { brand_primary_color?: string | null }).brand_primary_color ?? '#1a73e8',
      clientName: client.canonical_name,
      phone: client.phone,
      ctaDefault: client.cta_text,
      bodyImageHtml,
      blog: {
        title: post.title ?? '',
        excerpt: post.blog_excerpt ?? post.master_caption ?? '',
        focusKeyword,
        secondaryKeywords,
        seoTitle,
        metaDescription,
        slug: post.slug ?? '',
        intro: stripHtml(sections[0] ?? post.blog_excerpt ?? post.master_caption ?? ''),
        sections: sections.length > 1
          ? sections.slice(1).map((raw, index) => {
            const [headingPart, ...rest] = raw.split(/<\/h2>/i);
            return {
              heading: stripHtml(headingPart || `Section ${index + 1}`),
              html: rest.join('</h2>') || `<p>${stripHtml(raw)}</p>`,
            };
          })
          : [{ heading: post.title ?? 'Overview', html: post.blog_content }],
        faq: [],
        ctaHeading: client.cta_text ?? 'Talk With Our Team',
        ctaBody: `Contact ${client.canonical_name} for guidance tailored to your needs.`,
        ctaButtonLabel: client.cta_text ?? 'Contact Us Today',
        imagePrompt: post.ai_image_prompt ?? undefined,
      },
    });
  }
  htmlContent = injectBodyImageIntoHtml(htmlContent, bodyImageHtml);

  const excerpt = (post as unknown as { blog_excerpt?: string }).blog_excerpt
    ?? post.master_caption
    ?? '';

  // ── Create or update WP post ──────────────────────────────────────────────
  let wpPost;
  const existingWpId = (post as unknown as { wp_post_id?: number }).wp_post_id;

  try {
    if (existingWpId) {
      wpPost = await wp.updatePost(existingWpId, {
        title:   post.title ?? '',
        content: htmlContent,
        excerpt,
        status:  wpStatus,
        slug:    post.slug ?? undefined,
        featured_media: featuredMediaId,
        meta: Object.keys(rankMathMeta).length > 0 ? rankMathMeta : undefined,
      });
    } else {
      wpPost = await wp.createPost({
        title:          post.title ?? '',
        content:        htmlContent,
        excerpt,
        status:         wpStatus,
        slug:           post.slug ?? undefined,
        author:         (client as unknown as { wp_default_author_id?: number }).wp_default_author_id ?? undefined,
        categories:     categoryIds.length > 0 ? categoryIds : undefined,
        featured_media: featuredMediaId,
        meta:           Object.keys(rankMathMeta).length > 0 ? rankMathMeta : undefined,
      });
    }
  } catch (wpErr) {
    const msg = wpErr instanceof Error ? wpErr.message : String(wpErr);
    return c.json({ error: `WordPress publish failed: ${msg}` }, 502);
  }

  // ── Update local post record ──────────────────────────────────────────────
  await updatePost(c.env.DB, post.id, {
    wp_post_id:     wpPost.id,
    wp_post_url:    wpPost.link,
    wp_post_status: wpPost.status,
    slug:           wpPost.slug ?? post.slug,
    meta_description: metaDescription || post.meta_description,
    seo_title: seoTitle || post.seo_title,
    target_keyword: focusKeyword || post.target_keyword,
    secondary_keywords: secondaryKeywords || post.secondary_keywords,
  } as Parameters<typeof updatePost>[2]);

  return c.json({
    ok:          true,
    wp_post_id:  wpPost.id,
    wp_post_url: wpPost.link,
    status:      wpPost.status,
    warnings:    check.warnings.length > 0 ? check.warnings : undefined,
  });
});

blogRoutes.post('/:id/sync-blog', requirePermission('posts.edit'), async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id') as string);
  if (!post) return c.json({ error: 'Post not found' }, 404);
  if (!post.wp_post_id) return c.json({ error: 'No WordPress post linked' }, 400);

  const client = await getClientWithConfig(c.env.DB, post.client_id);
  const wp = client ? buildWordPressClient(client) : null;
  if (!wp) return c.json({ error: 'WordPress not configured for this client' }, 400);

  try {
    const wpPost = await wp.getPost(post.wp_post_id);
    await updatePost(c.env.DB, post.id, {
      wp_post_url: wpPost.link,
      wp_post_status: wpPost.status,
      slug: wpPost.slug ?? post.slug,
      wp_featured_media_id: wpPost.featured_media ?? post.wp_featured_media_id,
    } as Parameters<typeof updatePost>[2]);
    return c.json({
      ok: true,
      wp_post_id: wpPost.id,
      wp_post_url: wpPost.link,
      status: wpPost.status,
      slug: wpPost.slug,
      featured_media: wpPost.featured_media ?? null,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// ── POST /api/posts/:id/unpublish-blog ────────────────────────────────────────

blogRoutes.post('/:id/unpublish-blog', requirePermission('posts.edit'), async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id') as string);
  if (!post) return c.json({ error: 'Post not found' }, 404);

  const wpId = (post as unknown as { wp_post_id?: number }).wp_post_id;
  if (!wpId) return c.json({ error: 'No WordPress post ID — post has not been published yet' }, 400);

  const client = await getClientWithConfig(c.env.DB, post.client_id);
  const wp     = client ? buildWordPressClient(client) : null;
  if (!wp) return c.json({ error: 'WordPress not configured for this client' }, 400);

  try {
    const wpPost = await wp.updatePost(wpId, { status: 'draft' });
    await updatePost(c.env.DB, post.id, { wp_post_status: 'draft' } as Parameters<typeof updatePost>[2]);
    return c.json({ ok: true, status: wpPost.status });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
