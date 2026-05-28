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
import { getPostById, getClientWithConfig, insertPostAsset, updatePost, writeAuditLog } from '../db/queries';
import {
  parseBlogBodyImages,
  serializeBlogBodyImages,
  upsertBlogBodyImage,
  findDuplicateBlogImageSlot,
  BLOG_IMAGE_SLOTS,
  type BlogImageSlot,
  type BlogBodyImage,
} from '../modules/blog-body-images';
import {
  buildStructuredBlogPrompt,
  validateImagePrompt,
  MAX_BLOG_IMAGE_ATTEMPTS,
} from '../services/stability';
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

function isImageContentType(value: string | null | undefined): boolean {
  return String(value ?? '').startsWith('image/');
}

function getUploadedImageFile(form: FormData): File | null {
  const file = form.get('file') as File | string | null;
  if (!file || typeof file === 'string' || !file.name) return null;
  return file;
}

function publicBlogImageUrl(env: Env, r2Key: string | null | undefined): string | null {
  if (!r2Key) return null;
  const publicBase = env.R2_MEDIA_PUBLIC_URL?.replace(/\/$/, '') ?? '';
  return publicBase ? `${publicBase}/${r2Key}` : `/media/${encodeURIComponent(r2Key)}`;
}

async function ensureAssetBelongsToPost(db: D1Database, postId: string, clientId: string, r2Key: string): Promise<void> {
  if (!r2Key.startsWith(`${clientId}/`)) throw new Error('Image does not belong to this client');
  const row = await db.prepare('SELECT post_id, client_id, content_type FROM assets WHERE r2_key = ?')
    .bind(r2Key)
    .first<{ post_id: string | null; client_id: string; content_type: string | null }>();
  if (row && row.client_id !== clientId) throw new Error('Image asset belongs to a different client');
  if (row?.post_id && row.post_id !== postId) throw new Error('Image asset is attached to a different post');
  if (row && !isImageContentType(row.content_type)) throw new Error('Assigned asset is not an image');
}

async function auditBlogImage(
  db: D1Database,
  user: SessionData,
  action: string,
  postId: string,
  value: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog(db, {
    user_id: user.userId,
    action,
    entity_type: 'post',
    entity_id: postId,
    new_value: value,
  });
}

function slotHeading(slot: BlogImageSlot, title: string, headings: string[]): string {
  return resolveBlogSlotHeading(slot, title, headings);
}

function enrichImageForUi(
  img: BlogBodyImage,
  post: { title: string | null; target_keyword: string | null; blog_content: string | null },
  client: { industry: string | null; state: string | null; canonical_name: string },
) {
  const headings = extractSectionHeadings(post.blog_content ?? '');
  const audit = validateImagePrompt(img.prompt, {
    slot: img.slot,
    blogTitle: post.title ?? '',
    targetKeyword: post.target_keyword ?? undefined,
    sectionHeading: slotHeading(img.slot, post.title ?? '', headings),
    serviceType: post.target_keyword ?? client.industry ?? '',
    industry: client.industry ?? '',
    location: client.state ?? '',
    clientName: client.canonical_name,
  });
  const attempts = img.attempts ?? 0;
  return {
    ...img,
    prompt_quality_score: img.prompt_quality_score ?? audit.score,
    prompt_quality_label: img.prompt_quality_label ?? audit.label,
    attempts_remaining: Math.max(0, MAX_BLOG_IMAGE_ATTEMPTS - attempts),
  };
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
    if (existing) return enrichImageForUi(existing, post, {
      industry: client?.industry ?? '',
      state: client?.state ?? '',
      canonical_name: client?.canonical_name ?? '',
    });
    const prompt = buildStructuredBlogPrompt({
      slot,
      blogTitle:      post.title ?? '',
      targetKeyword:  post.target_keyword ?? undefined,
      sectionHeading: slotHeading(slot, post.title ?? '', headings),
      serviceType:    post.target_keyword ?? client?.industry ?? '',
      industry:       client?.industry ?? '',
      location:       client?.state ?? '',
      clientName:     client?.canonical_name ?? '',
    });
    return enrichImageForUi({
      slot,
      r2_key: null,
      prompt,
      wp_media_id: null,
      attempts: 0,
      status: 'pending' as const,
    }, post, {
      industry: client?.industry ?? '',
      state: client?.state ?? '',
      canonical_name: client?.canonical_name ?? '',
    });
  });

  const publicBase = c.env.R2_MEDIA_PUBLIC_URL?.replace(/\/$/, '') ?? '';
  const withUrls = all.map((img) => ({
    ...img,
    url: img.r2_key && publicBase ? `${publicBase}/${img.r2_key}` : (img.r2_key ? `/media/${encodeURIComponent(img.r2_key)}` : null),
  }));

  return c.json({ images: withUrls });
});

blogImageRoutes.put('/:id/blog-images/featured', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.content_type !== 'blog') return c.json({ error: 'Not a blog post' }, 400);

  const body = await c.req.json().catch(() => ({})) as {
    r2_key?: string;
    bucket?: 'MEDIA' | 'IMAGES';
    alt_text?: string;
    caption?: string;
  };
  const r2Key = typeof body.r2_key === 'string' ? body.r2_key.trim() : '';
  if (!r2Key) return c.json({ error: 'r2_key required' }, 400);

  try {
    await ensureAssetBelongsToPost(c.env.DB, post.id, post.client_id, r2Key);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const bucket = body.bucket === 'IMAGES' ? 'IMAGES' : 'MEDIA';
  await updatePost(c.env.DB, post.id, {
    asset_r2_key: r2Key,
    asset_r2_bucket: bucket,
    asset_type: 'image',
    asset_delivered: 1,
  });
  await auditBlogImage(c.env.DB, c.get('user'), 'blog.image.featured.assigned', post.id, {
    client_id: post.client_id,
    r2_key: r2Key,
    bucket,
    alt_text: body.alt_text ?? null,
    caption: body.caption ?? null,
    url: publicBlogImageUrl(c.env, r2Key),
  });
  return c.json({ ok: true, image: { r2_key: r2Key, bucket, url: publicBlogImageUrl(c.env, r2Key) } });
});

blogImageRoutes.post('/:id/blog-images/featured/upload', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.content_type !== 'blog') return c.json({ error: 'Not a blog post' }, 400);

  const form = await c.req.formData();
  const file = getUploadedImageFile(form);
  if (!file) return c.json({ error: 'file required' }, 400);
  if (!isImageContentType(file.type)) return c.json({ error: 'Featured blog image must be an image file' }, 400);

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
  const assetId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const r2Key = `${post.client_id}/${post.id}/blog-featured-${assetId}.${ext}`;
  await c.env.MEDIA.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      clientId: post.client_id,
      postId: post.id,
      source: 'blog-featured-upload',
      originalName: file.name,
    },
  });
  await insertPostAsset(c.env.DB, {
    id: assetId,
    post_id: post.id,
    client_id: post.client_id,
    r2_key: r2Key,
    r2_bucket: 'MEDIA',
    filename: file.name,
    content_type: file.type,
    size_bytes: file.size,
    source: 'upload',
    sort_order: 0,
  });
  await updatePost(c.env.DB, post.id, {
    asset_r2_key: r2Key,
    asset_r2_bucket: 'MEDIA',
    asset_type: 'image',
    asset_delivered: 1,
    wp_featured_media_id: null,
  });
  await auditBlogImage(c.env.DB, c.get('user'), 'blog.image.uploaded', post.id, {
    client_id: post.client_id,
    role: 'featured',
    image_id: assetId,
    r2_key: r2Key,
    filename: file.name,
    content_type: file.type,
    size_bytes: file.size,
    url: publicBlogImageUrl(c.env, r2Key),
  });
  await auditBlogImage(c.env.DB, c.get('user'), 'blog.image.featured.assigned', post.id, {
    client_id: post.client_id,
    image_id: assetId,
    r2_key: r2Key,
    url: publicBlogImageUrl(c.env, r2Key),
  });
  return c.json({ ok: true, image: { id: assetId, r2_key: r2Key, bucket: 'MEDIA', url: publicBlogImageUrl(c.env, r2Key) } }, 201);
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
  });
  await updatePost(c.env.DB, post.id, { blog_body_images: serializeBlogBodyImages(updated) });

  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'blog.images.generated',
    entity_type: 'post',
    entity_id: post.id,
    new_value: {
      client_id: client.id,
      slots: updated.map((img) => ({ slot: img.slot, r2_key: img.r2_key, status: img.status, error: img.error ?? null })),
    },
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
  const existing = parseBlogBodyImages(post.blog_body_images);
  const current = existing.find((entry) => entry.slot === slot);
  if ((current?.attempts ?? 0) >= MAX_BLOG_IMAGE_ATTEMPTS) {
    return c.json({ error: 'Attempt limit reached for this image slot' }, 409);
  }

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
    existing,
    forceSlots: [slot],
    promptOverrides: promptOverride ? { [slot]: promptOverride } : undefined,
  });
  const img = updated.find((entry) => entry.slot === slot);
  if (!img) return c.json({ error: 'Image generation failed unexpectedly' }, 500);

  await updatePost(c.env.DB, post.id, { blog_body_images: serializeBlogBodyImages(updated) });

  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'blog.image.generated',
    entity_type: 'post',
    entity_id: post.id,
    new_value: {
      client_id: client.id,
      slot,
      r2_key: img.r2_key,
      status: img.status,
      error: img.error ?? null,
      url: publicBlogImageUrl(c.env, img.r2_key),
    },
  });

  return c.json({ ok: true, image: img });
});

blogImageRoutes.put('/:id/blog-images/:slot/assign', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.content_type !== 'blog') return c.json({ error: 'Not a blog post' }, 400);

  const slot = parseSlot(c.req.param('slot'));
  if (!slot) return c.json({ error: 'slot must be 1, 2, or 3' }, 400);

  const body = await c.req.json().catch(() => ({})) as {
    r2_key?: string;
    prompt?: string;
    alt_text?: string;
    caption?: string;
    filename?: string;
    content_type?: string;
    allow_duplicate?: boolean;
  };
  const r2Key = typeof body.r2_key === 'string' ? body.r2_key.trim() : '';
  if (!r2Key) return c.json({ error: 'r2_key required' }, 400);

  try {
    await ensureAssetBelongsToPost(c.env.DB, post.id, post.client_id, r2Key);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const existing = parseBlogBodyImages(post.blog_body_images);
  const duplicateSlot = findDuplicateBlogImageSlot(existing, r2Key, slot);
  if (duplicateSlot && body.allow_duplicate !== true) {
    return c.json({ error: `Image already assigned to blog image slot ${duplicateSlot}`, duplicate_slot: duplicateSlot }, 409);
  }

  const entry: BlogBodyImage = {
    slot,
    r2_key: r2Key,
    prompt: typeof body.prompt === 'string' ? body.prompt : '',
    wp_media_id: null,
    attempts: 0,
    status: 'generated',
    source: 'assigned',
    role: slot === 1 ? 'hero' : 'body',
    alt_text: body.alt_text,
    caption: body.caption,
    filename: body.filename,
    content_type: body.content_type,
    allow_duplicate: body.allow_duplicate === true,
    updated_at: Math.floor(Date.now() / 1000),
  };
  const updated = upsertBlogBodyImage(existing, entry);
  await updatePost(c.env.DB, post.id, { blog_body_images: serializeBlogBodyImages(updated) });
  await auditBlogImage(c.env.DB, c.get('user'), 'blog.image.slot.assigned', post.id, {
    client_id: post.client_id,
    slot,
    r2_key: r2Key,
    source: 'assigned',
    allow_duplicate: entry.allow_duplicate,
    url: publicBlogImageUrl(c.env, r2Key),
  });
  return c.json({ ok: true, image: { ...entry, url: publicBlogImageUrl(c.env, r2Key) } });
});

blogImageRoutes.post('/:id/blog-images/:slot/upload', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.content_type !== 'blog') return c.json({ error: 'Not a blog post' }, 400);

  const slot = parseSlot(c.req.param('slot'));
  if (!slot) return c.json({ error: 'slot must be 1, 2, or 3' }, 400);

  const form = await c.req.formData();
  const file = getUploadedImageFile(form);
  if (!file) return c.json({ error: 'file required' }, 400);
  if (!isImageContentType(file.type)) return c.json({ error: 'Blog slot upload must be an image file' }, 400);

  const allowDuplicate = form.get('allow_duplicate') === 'true';
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
  const assetId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const r2Key = `${post.client_id}/${post.id}/blog-slot-${slot}-${assetId}.${ext}`;
  const existing = parseBlogBodyImages(post.blog_body_images);
  const duplicateSlot = findDuplicateBlogImageSlot(existing, r2Key, slot);
  if (duplicateSlot && !allowDuplicate) {
    return c.json({ error: `Image already assigned to blog image slot ${duplicateSlot}`, duplicate_slot: duplicateSlot }, 409);
  }

  await c.env.MEDIA.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      clientId: post.client_id,
      postId: post.id,
      source: 'blog-slot-upload',
      slot: String(slot),
      originalName: file.name,
    },
  });
  await insertPostAsset(c.env.DB, {
    id: assetId,
    post_id: post.id,
    client_id: post.client_id,
    r2_key: r2Key,
    r2_bucket: 'MEDIA',
    filename: file.name,
    content_type: file.type,
    size_bytes: file.size,
    source: 'upload',
    sort_order: slot,
  });

  const entry: BlogBodyImage = {
    slot,
    r2_key: r2Key,
    prompt: String(form.get('prompt') ?? ''),
    wp_media_id: null,
    attempts: 0,
    status: 'generated',
    source: 'upload',
    role: slot === 1 ? 'hero' : 'body',
    alt_text: String(form.get('alt_text') ?? '') || undefined,
    caption: String(form.get('caption') ?? '') || undefined,
    filename: file.name,
    content_type: file.type,
    allow_duplicate: allowDuplicate,
    updated_at: Math.floor(Date.now() / 1000),
  };
  const updated = upsertBlogBodyImage(existing, entry);
  await updatePost(c.env.DB, post.id, { blog_body_images: serializeBlogBodyImages(updated) });
  await auditBlogImage(c.env.DB, c.get('user'), 'blog.image.uploaded', post.id, {
    client_id: post.client_id,
    role: 'body',
    slot,
    image_id: assetId,
    r2_key: r2Key,
    filename: file.name,
    content_type: file.type,
    size_bytes: file.size,
    url: publicBlogImageUrl(c.env, r2Key),
  });
  await auditBlogImage(c.env.DB, c.get('user'), 'blog.image.slot.assigned', post.id, {
    client_id: post.client_id,
    slot,
    image_id: assetId,
    r2_key: r2Key,
    source: 'upload',
    allow_duplicate: entry.allow_duplicate,
    url: publicBlogImageUrl(c.env, r2Key),
  });
  return c.json({ ok: true, image: { ...entry, url: publicBlogImageUrl(c.env, r2Key) } }, 201);
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
