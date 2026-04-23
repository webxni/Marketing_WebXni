/**
 * Asset routes — R2 upload / delete + multi-image post media management.
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  insertPostAsset,
  listPostAssetsRows,
  reorderPostAssets,
  attachAssetsToPost,
  writeAuditLog,
} from '../db/queries';

export const assetRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();
export const publicAssetRoutes = new Hono<{ Bindings: Env }>();

const DEFAULT_PUBLIC_MEDIA_PROXY = 'https://marketing.webxni.com/media';

function resolveMediaBase(env: Env): string {
  const publicBase = env.R2_MEDIA_PUBLIC_URL?.trim();
  return (publicBase && publicBase.length > 0) ? publicBase.replace(/\/$/, '') : DEFAULT_PUBLIC_MEDIA_PROXY;
}

function mediaUrlFor(env: Env, r2Key: string, bucket: string): string | null {
  if (bucket === 'IMAGES') return null;
  return `${resolveMediaBase(env)}/${r2Key}`;
}

async function nextSortOrderForPost(db: D1Database, postId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxSort FROM assets WHERE post_id = ?')
    .bind(postId)
    .first<{ maxSort: number }>();
  return (row?.maxSort ?? -1) + 1;
}

async function refreshPostPrimaryAsset(db: D1Database, postId: string): Promise<void> {
  // Point post.asset_r2_key at the asset with the smallest sort_order.
  // If no assets remain, clear it so the UI reflects an empty media set.
  const row = await db
    .prepare(
      `SELECT r2_key, r2_bucket, content_type
       FROM assets WHERE post_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
    )
    .bind(postId)
    .first<{ r2_key: string; r2_bucket: string; content_type: string | null }>();
  const now = Math.floor(Date.now() / 1000);
  if (!row) {
    await db
      .prepare(
        `UPDATE posts SET asset_r2_key = NULL, asset_r2_bucket = NULL,
                          asset_type = NULL, asset_delivered = 0, updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, postId)
      .run();
    return;
  }
  const isVideo = (row.content_type ?? '').startsWith('video/');
  await db
    .prepare(
      `UPDATE posts SET asset_r2_key = ?, asset_r2_bucket = ?, asset_type = ?,
                        asset_delivered = 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(row.r2_key, row.r2_bucket, isVideo ? 'video' : 'image', now, postId)
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/assets/upload — multipart upload
//
// Accepts either:
//   • file           — single-file upload (original shape, still supported)
//   • files[]        — multi-file upload in a single request
// Other form fields: client_id (required), post_id?, bucket? ('MEDIA'|'IMAGES')
//
// When post_id is provided, the asset is attached immediately with the next
// available sort_order and the post's primary asset pointer is refreshed so
// the first image becomes `post.asset_r2_key`.
// ─────────────────────────────────────────────────────────────────────────────
assetRoutes.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const clientId = formData.get('client_id') as string | null;
  const postId   = (formData.get('post_id') as string | null) || null;
  const bucket   = ((formData.get('bucket') as string | null) ?? 'MEDIA') === 'IMAGES' ? 'IMAGES' : 'MEDIA';

  // Gather every uploaded file: prefer files[] for multi, fall back to single file.
  const files: File[] = [];
  const multi = formData.getAll('files[]') as Array<File | string>;
  for (const entry of multi) {
    if (typeof entry !== 'string') files.push(entry as File);
  }
  if (files.length === 0) {
    const single = formData.get('file') as File | string | null;
    if (single && typeof single !== 'string') files.push(single);
  }

  if (!clientId) return c.json({ error: 'client_id required' }, 400);
  if (files.length === 0) return c.json({ error: 'At least one file required (use `file` or `files[]`)' }, 400);

  const r2Bucket = bucket === 'IMAGES' ? c.env.IMAGES : c.env.MEDIA;
  let nextSort = postId ? await nextSortOrderForPost(c.env.DB, postId) : 0;

  const uploaded: Array<{ id: string; r2_key: string; bucket: string; url: string | null; sort_order: number; filename: string; content_type: string }> = [];

  for (const file of files) {
    const ext     = (file.name.split('.').pop() ?? 'bin').toLowerCase();
    const assetId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
    const r2Key   = `${clientId}/${postId ?? 'unlinked'}/${assetId}.${ext}`;

    await r2Bucket.put(r2Key, file.stream(), {
      httpMetadata:   { contentType: file.type },
      customMetadata: { clientId, postId: postId ?? '', originalName: file.name },
    });

    await insertPostAsset(c.env.DB, {
      id:           assetId,
      post_id:      postId,
      client_id:    clientId,
      r2_key:       r2Key,
      r2_bucket:    bucket,
      filename:     file.name,
      content_type: file.type,
      size_bytes:   file.size,
      source:       'upload',
      sort_order:   postId ? nextSort : 0,
    });

    uploaded.push({
      id:           assetId,
      r2_key:       r2Key,
      bucket,
      url:          mediaUrlFor(c.env, r2Key, bucket),
      sort_order:   postId ? nextSort : 0,
      filename:     file.name,
      content_type: file.type,
    });
    if (postId) nextSort++;
  }

  // Refresh the post's primary asset pointer so post.asset_r2_key stays in sync.
  if (postId) await refreshPostPrimaryAsset(c.env.DB, postId);

  // Back-compat: legacy single-file uploads returned a flat shape with asset_id/r2_key/url.
  if (uploaded.length === 1) {
    const one = uploaded[0];
    return c.json({
      ok: true,
      asset_id:   one.id,
      r2_key:     one.r2_key,
      bucket:     one.bucket,
      url:        one.url,
      sort_order: one.sort_order,
      assets:     uploaded,
    }, 201);
  }
  return c.json({ ok: true, count: uploaded.length, assets: uploaded }, 201);
});

/**
 * GET /api/assets/preview — stream an R2 object by key (auth-protected proxy).
 * Usage: /api/assets/preview?key=clientId/postId/filename.png
 */
assetRoutes.get('/preview', async (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ error: 'key required' }, 400);

  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ error: 'Asset not found' }, 404);

  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/assets/post/:postId — ordered assets for a post
// ─────────────────────────────────────────────────────────────────────────────
assetRoutes.get('/post/:postId', async (c) => {
  const postId = c.req.param('postId');
  const rows = await listPostAssetsRows(c.env.DB, postId);
  const items = rows.map(r => ({
    id:           r.id,
    r2_key:       r.r2_key,
    r2_bucket:    r.r2_bucket,
    filename:     r.filename,
    content_type: r.content_type,
    size_bytes:   r.size_bytes,
    sort_order:   r.sort_order,
    url:          mediaUrlFor(c.env, r.r2_key, r.r2_bucket),
    created_at:   r.created_at,
  }));
  return c.json({ assets: items });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/assets/post/:postId/attach — link previously-unattached asset rows
// Body: { asset_ids: string[] }
// Used by the New Post flow: files are uploaded before the post exists
// (post_id=NULL), then attached in order after create.
// ─────────────────────────────────────────────────────────────────────────────
assetRoutes.post('/post/:postId/attach', async (c) => {
  const postId = c.req.param('postId');
  let body: { asset_ids?: string[] };
  try { body = await c.req.json() as typeof body; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const assetIds = Array.isArray(body.asset_ids) ? body.asset_ids : [];
  if (assetIds.length === 0) return c.json({ error: 'asset_ids required' }, 400);

  const attached = await attachAssetsToPost(c.env.DB, postId, assetIds);
  await refreshPostPrimaryAsset(c.env.DB, postId);

  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId, action: 'post.assets.attach',
    entity_type: 'post', entity_id: postId,
    new_value: { attached, asset_ids: assetIds },
  });
  return c.json({ ok: true, attached });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/assets/post/:postId/reorder — reorder attached assets
// Body: { order: string[] }
// ─────────────────────────────────────────────────────────────────────────────
assetRoutes.post('/post/:postId/reorder', async (c) => {
  const postId = c.req.param('postId');
  let body: { order?: string[] };
  try { body = await c.req.json() as typeof body; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const order = Array.isArray(body.order) ? body.order : [];
  if (order.length === 0) return c.json({ error: 'order required' }, 400);

  await reorderPostAssets(c.env.DB, postId, order);
  await refreshPostPrimaryAsset(c.env.DB, postId);

  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId, action: 'post.assets.reorder',
    entity_type: 'post', entity_id: postId,
    new_value: { order },
  });
  return c.json({ ok: true });
});

/** GET /media/* — public media proxy with Range request support. */
publicAssetRoutes.get('/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/+media\/?/, ''));
  if (!key) return new Response('Not Found', { status: 404 });

  const rangeHeader = c.req.header('Range');

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': 'bytes */*' },
      });
    }

    const requestedStart = parseInt(match[1], 10);
    const rangeOpts = match[2]
      ? { offset: requestedStart, length: parseInt(match[2], 10) - requestedStart + 1 }
      : { offset: requestedStart };

    const obj = await c.env.MEDIA.get(key, { range: rangeOpts });
    if (!obj) return new Response('Not Found', { status: 404 });

    const total  = obj.size;
    const result = obj.range as { offset?: number; length?: number } | undefined;
    const start  = result?.offset  ?? requestedStart;
    const length = result?.length  ?? (total - start);
    const end    = start + length - 1;

    return new Response(obj.body, {
      status: 206,
      headers: {
        'Content-Type':                obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'Content-Range':               `bytes ${start}-${end}/${total}`,
        'Content-Length':              String(length),
        'Accept-Ranges':               'bytes',
        'Cache-Control':               'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const obj = await c.env.MEDIA.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type':                obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length':              String(obj.size),
      'Accept-Ranges':               'bytes',
      'Cache-Control':               'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

/**
 * DELETE /api/assets/:id — remove a single asset row + R2 object.
 * If the asset was the post's primary, the next asset (by sort_order) is
 * promoted automatically.
 */
assetRoutes.delete('/:id', async (c) => {
  const asset = await c.env.DB
    .prepare('SELECT id, post_id, r2_key, r2_bucket FROM assets WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; post_id: string | null; r2_key: string; r2_bucket: string }>();

  if (!asset) return c.json({ error: 'Not found' }, 404);

  const r2Bucket = asset.r2_bucket === 'IMAGES' ? c.env.IMAGES : c.env.MEDIA;
  try { await r2Bucket.delete(asset.r2_key); } catch { /* non-fatal */ }
  await c.env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(asset.id).run();

  if (asset.post_id) {
    await refreshPostPrimaryAsset(c.env.DB, asset.post_id);
    await writeAuditLog(c.env.DB, {
      user_id: c.get('user').userId, action: 'post.assets.delete',
      entity_type: 'post', entity_id: asset.post_id,
      new_value: { asset_id: asset.id, r2_key: asset.r2_key },
    });
  }

  return c.json({ ok: true });
});
