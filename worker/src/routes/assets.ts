/**
 * Asset routes — R2 upload / delete
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';

export const assetRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

/** POST /api/assets/upload — multipart upload to R2 MEDIA bucket */
assetRoutes.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const clientId = formData.get('client_id') as string | null;
  const postId = formData.get('post_id') as string | null;
  const bucket = (formData.get('bucket') as string | null) ?? 'MEDIA';

  if (!file || !clientId) {
    return c.json({ error: 'file and client_id required' }, 400);
  }

  const ext = file.name.split('.').pop() ?? 'bin';
  const assetId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const r2Key = `${clientId}/${postId ?? 'unlinked'}/${assetId}.${ext}`;

  const r2Bucket = bucket === 'IMAGES' ? c.env.IMAGES : c.env.MEDIA;

  await r2Bucket.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { clientId, postId: postId ?? '', originalName: file.name },
  });

  // Register in assets table
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(
      `INSERT INTO assets (id, post_id, client_id, r2_key, r2_bucket, filename,
         content_type, size_bytes, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?)`,
    )
    .bind(assetId, postId, clientId, r2Key, bucket, file.name, file.type, file.size, now)
    .run();

  // Update post.asset_r2_key if post_id was provided
  if (postId) {
    await c.env.DB
      .prepare('UPDATE posts SET asset_r2_key = ?, asset_r2_bucket = ?, updated_at = ? WHERE id = ?')
      .bind(r2Key, bucket, now, postId)
      .run();
  }

  const publicBase = (c.env as { R2_MEDIA_PUBLIC_URL?: string }).R2_MEDIA_PUBLIC_URL;
  const url = publicBase && bucket !== 'IMAGES'
    ? `${publicBase.replace(/\/$/, '')}/${r2Key}`
    : null;

  return c.json({ ok: true, asset_id: assetId, r2_key: r2Key, bucket, url }, 201);
});

/** DELETE /api/assets/:id */
assetRoutes.delete('/:id', async (c) => {
  const asset = await c.env.DB
    .prepare('SELECT * FROM assets WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ r2_key: string; r2_bucket: string }>();

  if (!asset) return c.json({ error: 'Not found' }, 404);

  const r2Bucket = asset.r2_bucket === 'IMAGES' ? c.env.IMAGES : c.env.MEDIA;
  await r2Bucket.delete(asset.r2_key);
  await c.env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(c.req.param('id')).run();

  return c.json({ ok: true });
});
