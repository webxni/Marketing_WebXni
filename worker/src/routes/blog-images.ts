/**
 * Blog body-image routes — manual / on-demand generation for the 3 structured
 * Stability images per blog post.
 *
 *   GET  /api/posts/:id/blog-images              → list all 3 slots
 *   POST /api/posts/:id/blog-images/generate     → generate all 3
 *   POST /api/posts/:id/blog-images/:slot        → generate single slot
 *        body: { prompt?: string }   — custom prompt override
 *   PUT  /api/posts/:id/blog-images/:slot        → save prompt only (no generation)
 *        body: { prompt: string }
 *   DELETE /api/posts/:id/blog-images/:slot      → clear slot
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { getPostById, getClientWithConfig, updatePost, writeAuditLog } from '../db/queries';
import {
  parseBlogBodyImages,
  serializeBlogBodyImages,
  upsertBlogBodyImage,
  BLOG_IMAGE_SLOTS,
  type BlogImageSlot,
  type BlogBodyImage,
} from '../modules/blog-body-images';
import { buildStructuredBlogPrompt } from '../services/stability';
import {
  ensureBlogBodyImagesGenerated,
  extractSectionHeadings,
  resolveBlogSlotHeading,
} from '../loader/autonomous-content';
import { resolveStabilityApiKeys } from '../services/stability';

export const blogImageRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

function parseSlot(raw: string): BlogImageSlot | null {
  const n = Number(raw);
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

function slotHeading(slot: BlogImageSlot, title: string, headings: string[]): string {
  return resolveBlogSlotHeading(slot, title, headings);
}

blogImageRoutes.get('/:id/blog-images', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.content_type !== 'blog') return c.json({ error: 'Not a blog post' }, 400);

  const stored = parseBlogBodyImages(post.blog_body_images);
  const client = await getClientWithConfig(c.env.DB, post.client_id);
  const headings = extractSectionHeadings(post.blog_content ?? '');

  // Hydrate missing slots with their auto-built prompts so the UI can show what
  // *would* be generated without persisting anything.
  const all = BLOG_IMAGE_SLOTS.map((slot) => {
    const existing = stored.find((s) => s.slot === slot);
    if (existing) return existing;
    const prompt = buildStructuredBlogPrompt({
      slot,
      blogTitle:      post.title ?? '',
      targetKeyword:  post.target_keyword ?? undefined,
      sectionHeading: slotHeading(slot, post.title ?? '', headings),
      serviceType:    post.target_keyword ?? client?.industry ?? '',
      industry:       client?.industry ?? '',
      location:       '',
      clientName:     client?.canonical_name ?? '',
    });
    return {
      slot,
      r2_key: null,
      prompt,
      wp_media_id: null,
      attempts: 0,
      status: 'pending' as const,
    };
  });

  const publicBase = c.env.R2_MEDIA_PUBLIC_URL?.replace(/\/$/, '') ?? '';
  const withUrls = all.map((img) => ({
    ...img,
    url: img.r2_key && publicBase ? `${publicBase}/${img.r2_key}` : (img.r2_key ? `/media/${encodeURIComponent(img.r2_key)}` : null),
  }));

  return c.json({ images: withUrls });
});

blogImageRoutes.post('/:id/blog-images/generate', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.content_type !== 'blog') return c.json({ error: 'Not a blog post' }, 400);

  const client = await getClientWithConfig(c.env.DB, post.client_id);
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const { openAiKey, stabilityKey } = await resolveStabilityApiKeys(c.env);
  if (!stabilityKey) return c.json({ error: 'STABILITY_API_KEY not configured' }, 503);

  const serviceType = post.target_keyword ?? client.industry ?? '';
  const location = client.state ?? '';
  const updated = await ensureBlogBodyImagesGenerated(c.env, openAiKey, stabilityKey, {
    blogTitle: post.title ?? '',
    blogContent: post.blog_content,
    targetKeyword: post.target_keyword,
    serviceType,
    industry: client.industry ?? '',
    location,
    clientName: client.canonical_name,
    clientId: client.id,
    existing: parseBlogBodyImages(post.blog_body_images),
    forceSlots: [...BLOG_IMAGE_SLOTS],
  });
  await updatePost(c.env.DB, post.id, { blog_body_images: serializeBlogBodyImages(updated) });

  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'blog_images_generate_all',
    entity_type: 'post',
    entity_id: post.id,
  });

  return c.json({ ok: true, images: updated });
});

blogImageRoutes.post('/:id/blog-images/:slot', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.content_type !== 'blog') return c.json({ error: 'Not a blog post' }, 400);

  const slot = parseSlot(c.req.param('slot'));
  if (!slot) return c.json({ error: 'slot must be 1, 2, or 3' }, 400);

  const client = await getClientWithConfig(c.env.DB, post.client_id);
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const body = await c.req.json().catch(() => ({})) as { prompt?: string };
  const promptOverride = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : undefined;

  const { openAiKey, stabilityKey } = await resolveStabilityApiKeys(c.env);
  if (!stabilityKey) return c.json({ error: 'STABILITY_API_KEY not configured' }, 503);

  const serviceType = post.target_keyword ?? client.industry ?? '';
  const location = client.state ?? '';
  const updated = await ensureBlogBodyImagesGenerated(c.env, openAiKey, stabilityKey, {
    blogTitle: post.title ?? '',
    blogContent: post.blog_content,
    targetKeyword: post.target_keyword,
    serviceType,
    industry: client.industry ?? '',
    location,
    clientName: client.canonical_name,
    clientId: client.id,
    existing: parseBlogBodyImages(post.blog_body_images),
    forceSlots: [slot],
    promptOverrides: promptOverride ? { [slot]: promptOverride } : undefined,
  });
  const img = updated.find((entry) => entry.slot === slot);
  if (!img) return c.json({ error: 'Image generation failed unexpectedly' }, 500);

  await updatePost(c.env.DB, post.id, { blog_body_images: serializeBlogBodyImages(updated) });

  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'blog_image_generate_slot',
    entity_type: 'post',
    entity_id: post.id,
  });

  return c.json({ ok: true, image: img });
});

blogImageRoutes.put('/:id/blog-images/:slot', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.content_type !== 'blog') return c.json({ error: 'Not a blog post' }, 400);

  const slot = parseSlot(c.req.param('slot'));
  if (!slot) return c.json({ error: 'slot must be 1, 2, or 3' }, 400);

  const body = await c.req.json().catch(() => ({})) as { prompt?: string };
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return c.json({ error: 'prompt required' }, 400);
  }

  const existing = parseBlogBodyImages(post.blog_body_images);
  const current = existing.find((e) => e.slot === slot);
  const entry: BlogBodyImage = current
    ? { ...current, prompt: body.prompt.trim(), updated_at: Math.floor(Date.now() / 1000) }
    : { slot, r2_key: null, prompt: body.prompt.trim(), wp_media_id: null, attempts: 0, status: 'pending', updated_at: Math.floor(Date.now() / 1000) };

  const updated = upsertBlogBodyImage(existing, entry);
  await updatePost(c.env.DB, post.id, { blog_body_images: serializeBlogBodyImages(updated) });
  return c.json({ ok: true, image: entry });
});

blogImageRoutes.delete('/:id/blog-images/:slot', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.content_type !== 'blog') return c.json({ error: 'Not a blog post' }, 400);

  const slot = parseSlot(c.req.param('slot'));
  if (!slot) return c.json({ error: 'slot must be 1, 2, or 3' }, 400);

  const existing = parseBlogBodyImages(post.blog_body_images);
  const updated = existing.filter((e) => e.slot !== slot);
  await updatePost(c.env.DB, post.id, { blog_body_images: serializeBlogBodyImages(updated) });
  return c.json({ ok: true });
});
