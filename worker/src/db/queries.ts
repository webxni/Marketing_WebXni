/**
 * D1 query helpers — raw SQL, no ORM.
 * All queries use prepared statements via env.DB.prepare().bind().
 */

import type {
  ClientRow,
  ClientPlatformRow,
  ClientGbpLocationRow,
  PostRow,
  PostPlatformRow,
  PostingJobRow,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS
// ─────────────────────────────────────────────────────────────────────────────

export async function getClientBySlug(
  db: D1Database,
  slug: string,
): Promise<ClientRow | null> {
  const result = await db
    .prepare('SELECT * FROM clients WHERE slug = ?')
    .bind(slug)
    .first<ClientRow>();
  return result ?? null;
}

export async function getClientById(
  db: D1Database,
  id: string,
): Promise<ClientRow | null> {
  const result = await db
    .prepare('SELECT * FROM clients WHERE id = ?')
    .bind(id)
    .first<ClientRow>();
  return result ?? null;
}

export async function listClients(
  db: D1Database,
  status: 'active' | 'inactive' | 'all' = 'active',
): Promise<ClientRow[]> {
  if (status === 'all') {
    const r = await db.prepare('SELECT * FROM clients ORDER BY canonical_name').all<ClientRow>();
    return r.results;
  }
  const r = await db
    .prepare('SELECT * FROM clients WHERE status = ? ORDER BY canonical_name')
    .bind(status)
    .all<ClientRow>();
  return r.results;
}

export async function getClientPlatforms(
  db: D1Database,
  clientId: string,
): Promise<ClientPlatformRow[]> {
  const r = await db
    .prepare('SELECT * FROM client_platforms WHERE client_id = ?')
    .bind(clientId)
    .all<ClientPlatformRow>();
  return r.results;
}

export async function getClientGbpLocations(
  db: D1Database,
  clientId: string,
): Promise<ClientGbpLocationRow[]> {
  const r = await db
    .prepare(
      'SELECT * FROM client_gbp_locations WHERE client_id = ? ORDER BY sort_order',
    )
    .bind(clientId)
    .all<ClientGbpLocationRow>();
  return r.results;
}

export async function getClientRestrictions(
  db: D1Database,
  clientId: string,
): Promise<string[]> {
  const r = await db
    .prepare('SELECT term FROM client_restrictions WHERE client_id = ?')
    .bind(clientId)
    .all<{ term: string }>();
  return r.results.map((row) => row.term);
}

/** Load a client with all related data needed for posting preflight */
export async function getClientWithConfig(
  db: D1Database,
  clientId: string,
): Promise<
  | (ClientRow & {
      platforms: ClientPlatformRow[];
      gbp_locations: ClientGbpLocationRow[];
      restrictions: string[];
    })
  | null
> {
  const client = await getClientById(db, clientId);
  if (!client) return null;
  const [platforms, gbp_locations, restrictions] = await Promise.all([
    getClientPlatforms(db, clientId),
    getClientGbpLocations(db, clientId),
    getClientRestrictions(db, clientId),
  ]);
  return { ...client, platforms, gbp_locations, restrictions };
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTS
// ─────────────────────────────────────────────────────────────────────────────

export interface ListPostsParams {
  clientId?: string;
  status?: string;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export async function listPosts(
  db: D1Database,
  params: ListPostsParams = {},
): Promise<PostRow[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (params.clientId) {
    conditions.push('client_id = ?');
    binds.push(params.clientId);
  }
  if (params.status) {
    conditions.push('status = ?');
    binds.push(params.status);
  }
  if (params.dateFrom) {
    conditions.push('publish_date >= ?');
    binds.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push('publish_date <= ?');
    binds.push(params.dateTo);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  const r = await db
    .prepare(`SELECT * FROM posts ${where} ORDER BY publish_date ASC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<PostRow>();
  return r.results;
}

/** Query posts ready for automation (the posting gate) */
export async function listReadyPosts(
  db: D1Database,
  clientFilter?: string,
  limit = 50,
): Promise<PostRow[]> {
  // Only pick up posts whose scheduled time has arrived (or have no time set).
  // publish_date is stored as-entered in Nicaragua time (CST = UTC-6, no DST).
  // We compare against NIC "now" = datetime('now', '-6 hours').
  //
  // Accept both 'ready' and 'approved' — after the approval=ready change,
  // 'approved' is semantically equivalent to 'ready'. Posts approved under
  // the old two-step flow land here via the 'approved' branch.
  const nowExpr = `strftime('%Y-%m-%dT%H:%M','now','-6 hours')`;
  const statusClause = `(
    (status = 'ready' AND ready_for_automation = 1 AND asset_delivered = 1)
    OR status = 'approved'
  )`;
  if (clientFilter) {
    const client = await getClientBySlug(db, clientFilter);
    if (!client) return [];
    const r = await db
      .prepare(
        `SELECT * FROM posts
         WHERE ${statusClause}
           AND client_id = ?
           AND (publish_date IS NULL OR publish_date <= ${nowExpr})
         ORDER BY publish_date ASC
         LIMIT ?`,
      )
      .bind(client.id, limit)
      .all<PostRow>();
    return r.results;
  }
  const r = await db
    .prepare(
      `SELECT * FROM posts
       WHERE ${statusClause}
         AND (publish_date IS NULL OR publish_date <= ${nowExpr})
       ORDER BY publish_date ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<PostRow>();
  return r.results;
}

export async function getPostById(db: D1Database, id: string): Promise<PostRow | null> {
  const result = await db
    .prepare('SELECT * FROM posts WHERE id = ?')
    .bind(id)
    .first<PostRow>();
  return result ?? null;
}

export async function createPost(
  db: D1Database,
  data: Partial<PostRow> & { client_id: string; title: string },
): Promise<PostRow> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO posts (id, client_id, title, status, content_type, platforms,
        publish_date, master_caption, cap_facebook, cap_instagram, cap_linkedin,
        cap_x, cap_threads, cap_tiktok, cap_pinterest, cap_bluesky,
        cap_google_business, cap_gbp_la, cap_gbp_wa, cap_gbp_or,
        youtube_title, youtube_description, blog_content, blog_excerpt, seo_title,
        meta_description, slug, target_keyword, ai_image_prompt, ai_video_prompt,
        video_script, asset_r2_key, asset_r2_bucket, asset_type, canva_link,
        ready_for_automation, asset_delivered, skarleth_notes, error_log,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, data.client_id, data.title, data.status ?? 'draft',
      data.content_type ?? 'image', data.platforms ?? '[]',
      data.publish_date ?? null, data.master_caption ?? null,
      data.cap_facebook ?? null, data.cap_instagram ?? null,
      data.cap_linkedin ?? null, data.cap_x ?? null,
      data.cap_threads ?? null, data.cap_tiktok ?? null,
      data.cap_pinterest ?? null, data.cap_bluesky ?? null,
      data.cap_google_business ?? null, data.cap_gbp_la ?? null,
      data.cap_gbp_wa ?? null, data.cap_gbp_or ?? null,
      data.youtube_title ?? null, data.youtube_description ?? null,
      data.blog_content ?? null, data.blog_excerpt ?? null, data.seo_title ?? null,
      data.meta_description ?? null, data.slug ?? null,
      data.target_keyword ?? null, data.ai_image_prompt ?? null,
      data.ai_video_prompt ?? null, data.video_script ?? null,
      data.asset_r2_key ?? null, data.asset_r2_bucket ?? null,
      data.asset_type ?? null, data.canva_link ?? null,
      data.ready_for_automation ?? 0, data.asset_delivered ?? 0,
      data.skarleth_notes ?? null, data.error_log ?? null,
      now, now,
    )
    .run();
  return (await getPostById(db, id))!;
}

export async function updatePost(
  db: D1Database,
  id: string,
  data: Partial<PostRow>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const fields = Object.keys(data)
    .filter((k) => k !== 'id' && k !== 'created_at')
    .map((k) => `${k} = ?`);
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  const values = [
    ...Object.entries(data)
      .filter(([k]) => k !== 'id' && k !== 'created_at')
      .map(([, v]) => v),
    now,
    id,
  ];
  await db
    .prepare(`UPDATE posts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function setPostStatus(
  db: D1Database,
  id: string,
  status: string,
  automationStatus?: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  if (automationStatus) {
    await db
      .prepare(
        'UPDATE posts SET status = ?, automation_status = ?, updated_at = ? WHERE id = ?',
      )
      .bind(status, automationStatus, now, id)
      .run();
  } else {
    await db
      .prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, id)
      .run();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST PLATFORMS  (per-platform posting status)
// ─────────────────────────────────────────────────────────────────────────────

export async function getPostPlatforms(
  db: D1Database,
  postId: string,
): Promise<PostPlatformRow[]> {
  const r = await db
    .prepare('SELECT * FROM post_platforms WHERE post_id = ?')
    .bind(postId)
    .all<PostPlatformRow>();
  return r.results;
}

export async function getPostPlatform(
  db: D1Database,
  postId: string,
  platform: string,
): Promise<PostPlatformRow | null> {
  const r = await db
    .prepare('SELECT * FROM post_platforms WHERE post_id = ? AND platform = ?')
    .bind(postId, platform)
    .first<PostPlatformRow>();
  return r ?? null;
}

export async function upsertPostPlatform(
  db: D1Database,
  data: Partial<PostPlatformRow> & { post_id: string; platform: string },
): Promise<void> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  await db
    .prepare(
      `INSERT INTO post_platforms (id, post_id, platform, tracking_id, real_url,
         status, error_message, attempted_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(post_id, platform) DO UPDATE SET
         tracking_id    = excluded.tracking_id,
         real_url       = COALESCE(excluded.real_url, real_url),
         status         = excluded.status,
         error_message  = excluded.error_message,
         attempted_at   = excluded.attempted_at,
         idempotency_key = excluded.idempotency_key`,
    )
    .bind(
      id,
      data.post_id,
      data.platform,
      data.tracking_id ?? null,
      data.real_url ?? null,
      data.status ?? 'pending',
      data.error_message ?? null,
      data.attempted_at ?? new Date().toISOString(),
      data.idempotency_key ?? null,
    )
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTING JOBS
// ─────────────────────────────────────────────────────────────────────────────

export async function createPostingJob(
  db: D1Database,
  data: Partial<PostingJobRow> & { mode: string },
): Promise<PostingJobRow> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO posting_jobs (id, triggered_by, mode, client_filter,
         platform_filter, limit_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
    )
    .bind(
      id,
      data.triggered_by ?? 'api',
      data.mode,
      data.client_filter ?? null,
      data.platform_filter ?? null,
      data.limit_count ?? null,
      now,
    )
    .run();
  return (await getPostingJobById(db, id))!;
}

export async function getPostingJobById(
  db: D1Database,
  id: string,
): Promise<PostingJobRow | null> {
  const r = await db
    .prepare('SELECT * FROM posting_jobs WHERE id = ?')
    .bind(id)
    .first<PostingJobRow>();
  return r ?? null;
}

export async function updatePostingJob(
  db: D1Database,
  id: string,
  status: string,
  statsJson: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      'UPDATE posting_jobs SET status = ?, stats_json = ?, completed_at = ? WHERE id = ?',
    )
    .bind(status, statsJson, now, id)
    .run();
}

export async function listPostingJobs(
  db: D1Database,
  limit = 20,
): Promise<PostingJobRow[]> {
  const r = await db
    .prepare('SELECT * FROM posting_jobs ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<PostingJobRow>();
  return r.results;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION RUNS
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerationRunRow {
  id:                string;
  phase:             number;
  triggered_by:      string | null;
  week_start:        string;
  client_filter:     string | null;
  status:            string;
  clients_processed: string | null;
  posts_created:     number;
  posts_updated:     number;
  error_log:         string | null;
  created_at:        number;
  completed_at:      number | null;
}

export async function createGenerationRun(
  db: D1Database,
  data: { triggered_by: string; date_range: string; client_filter: string | null },
): Promise<GenerationRunRow> {
  const id  = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO generation_runs
         (id, phase, triggered_by, week_start, client_filter, status, posts_created, posts_updated, created_at)
       VALUES (?, 1, ?, ?, ?, 'running', 0, 0, ?)`,
    )
    .bind(id, data.triggered_by, data.date_range, data.client_filter, now)
    .run();
  return (await getGenerationRunById(db, id))!;
}

export async function getGenerationRunById(
  db: D1Database,
  id: string,
): Promise<GenerationRunRow | null> {
  const r = await db
    .prepare('SELECT * FROM generation_runs WHERE id = ?')
    .bind(id)
    .first<GenerationRunRow>();
  return r ?? null;
}

export async function listGenerationRuns(
  db: D1Database,
  limit = 20,
): Promise<GenerationRunRow[]> {
  const r = await db
    .prepare('SELECT * FROM generation_runs ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<GenerationRunRow>();
  return r.results;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────

export async function writeAuditLog(
  db: D1Database,
  entry: {
    user_id?: string;
    action: string;
    entity_type?: string;
    entity_id?: string;
    old_value?: unknown;
    new_value?: unknown;
    ip?: string;
  },
): Promise<void> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id,
         old_value, new_value, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      entry.user_id ?? null,
      entry.action,
      entry.entity_type ?? null,
      entry.entity_id ?? null,
      entry.old_value ? JSON.stringify(entry.old_value) : null,
      entry.new_value ? JSON.stringify(entry.new_value) : null,
      entry.ip ?? null,
      now,
    )
    .run();
}
