/**
 * Blog publishing routes
 *   POST /api/posts/:id/publish-blog   — push blog post to WordPress
 *   POST /api/posts/:id/unpublish-blog — revert WP post to draft
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { getPostById, getClientWithConfig, updatePost } from '../db/queries';
import { buildWordPressClient } from '../services/wordpress';
import { publishBlogPost } from '../modules/blog-publishing';
import { requirePermission } from '../middleware/auth';

export const blogRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

blogRoutes.post('/:id/publish-blog', requirePermission('posts.edit'), async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id') as string);
  if (!post) return c.json({ error: 'Post not found' }, 404);

  let body: { status?: string; force_update?: boolean } = {};
  try { body = (await c.req.json()) as typeof body; } catch { /* defaults */ }

  try {
    const result = await publishBlogPost(c.env, post.id, {
      status: body.status === 'publish' || body.status === 'draft' || body.status === 'pending'
        ? body.status
        : undefined,
    });

    return c.json({
      ok: true,
      wp_post_id: result.wpPost.id,
      wp_post_url: result.wpPost.link,
      status: result.wpPost.status,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes('not configured') || message.includes('preflight failed') ? 400 : 502;
    return c.json({ error: message }, code);
  }
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
      status: wpPost.status === 'publish' ? 'posted' : 'draft',
      ready_for_automation: 0,
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

blogRoutes.post('/:id/unpublish-blog', requirePermission('posts.edit'), async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id') as string);
  if (!post) return c.json({ error: 'Post not found' }, 404);
  if (!post.wp_post_id) return c.json({ error: 'No WordPress post ID — post has not been published yet' }, 400);

  const client = await getClientWithConfig(c.env.DB, post.client_id);
  const wp = client ? buildWordPressClient(client) : null;
  if (!wp) return c.json({ error: 'WordPress not configured for this client' }, 400);

  try {
    const wpPost = await wp.updatePost(post.wp_post_id, { status: 'draft' });
    await updatePost(c.env.DB, post.id, {
      wp_post_status: 'draft',
      status: 'draft',
      ready_for_automation: 0,
    } as Parameters<typeof updatePost>[2]);
    return c.json({ ok: true, status: wpPost.status });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
