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
  includePosted?: boolean;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export async function listPosts(
  db: D1Database,
  params: ListPostsParams = {},
): Promise<{ rows: PostRow[]; total: number }> {
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (params.clientId) {
    conditions.push('client_id = ?');
    binds.push(params.clientId);
  }
  if (params.status) {
    conditions.push('status = ?');
    binds.push(params.status);
  } else if (!params.includePosted) {
    conditions.push("status != 'posted'");
  }
  if (params.platform) {
    // platforms is stored as a JSON array — use LIKE for substring match
    conditions.push("platforms LIKE ?");
    binds.push(`%"${params.platform}"%`);
  }
  if (params.dateFrom) {
    conditions.push("substr(publish_date,1,10) >= ?");
    binds.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push("substr(publish_date,1,10) <= ?");
    binds.push(params.dateTo);
  }
  if (params.search) {
    conditions.push("(title LIKE ? OR master_caption LIKE ?)");
    const term = `%${params.search}%`;
    binds.push(term, term);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = params.sort === 'asc' ? 'ASC' : 'DESC';
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  const [data, countRow] = await Promise.all([
    db
      .prepare(`SELECT * FROM posts ${where} ORDER BY publish_date ${order} LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all<PostRow>(),
    db
      .prepare(`SELECT COUNT(*) as n FROM posts ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ]);
  return { rows: data.results, total: countRow?.n ?? data.results.length };
}

/** Query posts ready for automation (the posting gate) */
export async function listReadyPosts(
  db: D1Database,
  clientFilter?: string,
  limit = 50,
  postIds?: string[],
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
    (content_type = 'blog' AND ready_for_automation = 1 AND asset_delivered = 1 AND status IN ('ready','approved','scheduled'))
    OR
    (content_type != 'blog' AND (
      (status = 'ready' AND ready_for_automation = 1 AND asset_delivered = 1)
      OR status = 'approved'
    ))
  )`;
  if (postIds && postIds.length > 0) {
    const placeholders = postIds.map(() => '?').join(',');
    const r = await db
      .prepare(
        `SELECT * FROM posts
         WHERE id IN (${placeholders})
           AND ((status = 'ready' AND ready_for_automation = 1 AND asset_delivered = 1)
             OR status IN ('approved','scheduled','failed'))
         ORDER BY publish_date ASC
         LIMIT ?`,
      )
      .bind(...postIds, limit)
      .all<PostRow>();
    return r.results;
  }
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
        meta_description, slug, target_keyword, secondary_keywords, ai_image_prompt, ai_video_prompt,
        video_script, asset_r2_key, asset_r2_bucket, asset_type, canva_link,
        ready_for_automation, asset_delivered, skarleth_notes, error_log,
        scheduled_by_automation, platform_manual_override, automation_slot_key, generation_run_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?)`,
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
      data.target_keyword ?? null, data.secondary_keywords ?? null, data.ai_image_prompt ?? null,
      data.ai_video_prompt ?? null, data.video_script ?? null,
      data.asset_r2_key ?? null, data.asset_r2_bucket ?? null,
      data.asset_type ?? null, data.canva_link ?? null,
      data.ready_for_automation ?? 0, data.asset_delivered ?? 0,
      data.skarleth_notes ?? null, data.error_log ?? null,
      data.scheduled_by_automation ?? 0, data.platform_manual_override ?? 0,
      data.automation_slot_key ?? null, data.generation_run_id ?? null,
      now, now,
    )
    .run();
  return (await getPostById(db, id))!;
}

export async function getPostByAutomationSlot(
  db: D1Database,
  clientId: string,
  automationSlotKey: string,
  publishDate: string,
  contentType: string,
): Promise<PostRow | null> {
  const bySlot = await db
    .prepare('SELECT * FROM posts WHERE client_id = ? AND automation_slot_key = ? LIMIT 1')
    .bind(clientId, automationSlotKey)
    .first<PostRow>();
  if (bySlot) return bySlot;

  const fallback = await db
    .prepare(`SELECT * FROM posts
              WHERE client_id = ?
                AND substr(publish_date, 1, 10) = ?
                AND content_type = ?
                AND scheduled_by_automation = 1
              ORDER BY updated_at DESC
              LIMIT 1`)
    .bind(clientId, publishDate, contentType)
    .first<PostRow>();
  return fallback ?? null;
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
  const setPostedAt = status === 'posted';
  if (automationStatus) {
    await db
      .prepare(
        setPostedAt
          ? 'UPDATE posts SET status = ?, automation_status = ?, posted_at = ?, updated_at = ? WHERE id = ?'
          : 'UPDATE posts SET status = ?, automation_status = ?, updated_at = ? WHERE id = ?',
      )
      .bind(...(setPostedAt ? [status, automationStatus, now, now, id] : [status, automationStatus, now, id]))
      .run();
  } else {
    await db
      .prepare(
        setPostedAt
          ? 'UPDATE posts SET status = ?, posted_at = ?, updated_at = ? WHERE id = ?'
          : 'UPDATE posts SET status = ?, updated_at = ? WHERE id = ?',
      )
      .bind(...(setPostedAt ? [status, now, now, id] : [status, now, id]))
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

// Terminal success states — once a platform reaches one of these, it must never be
// overwritten by a retry, concurrent run, or any subsequent upsert.
const TERMINAL_SUCCESS = `('sent','posted','idempotent')`;

export async function upsertPostPlatform(
  db: D1Database,
  data: Partial<PostPlatformRow> & { post_id: string; platform: string },
): Promise<void> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const isSuccess = ['sent', 'posted', 'idempotent'].includes(data.status ?? '');
  const publishedAt = isSuccess ? (data.published_at ?? new Date().toISOString()) : (data.published_at ?? null);

  await db
    .prepare(
      `INSERT INTO post_platforms (id, post_id, platform, tracking_id, real_url,
         status, error_message, attempted_at, idempotency_key, attempt_count, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(post_id, platform) DO UPDATE SET
         -- Never downgrade a terminal success state
         tracking_id     = CASE
                             WHEN post_platforms.status IN ${TERMINAL_SUCCESS} THEN post_platforms.tracking_id
                             ELSE COALESCE(excluded.tracking_id, post_platforms.tracking_id)
                           END,
         real_url        = CASE
                             WHEN post_platforms.status IN ${TERMINAL_SUCCESS} THEN post_platforms.real_url
                             ELSE COALESCE(excluded.real_url, post_platforms.real_url)
                           END,
         status          = CASE
                             WHEN post_platforms.status IN ${TERMINAL_SUCCESS} THEN post_platforms.status
                             ELSE excluded.status
                           END,
         error_message   = CASE
                             WHEN post_platforms.status IN ${TERMINAL_SUCCESS} THEN post_platforms.error_message
                             ELSE excluded.error_message
                           END,
         idempotency_key = CASE
                             WHEN post_platforms.status IN ${TERMINAL_SUCCESS} THEN post_platforms.idempotency_key
                             ELSE excluded.idempotency_key
                           END,
         -- Increment attempt_count each time we claim ('processing') on a non-terminal record
         attempt_count   = CASE
                             WHEN post_platforms.status IN ${TERMINAL_SUCCESS} THEN post_platforms.attempt_count
                             WHEN excluded.status = 'processing' THEN post_platforms.attempt_count + 1
                             ELSE post_platforms.attempt_count
                           END,
         -- Record when it first succeeded
         published_at    = CASE
                             WHEN post_platforms.published_at IS NOT NULL THEN post_platforms.published_at
                             WHEN excluded.status IN ${TERMINAL_SUCCESS} THEN excluded.published_at
                             ELSE NULL
                           END,
         attempted_at    = excluded.attempted_at`,
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
      data.attempt_count ?? 0,
      publishedAt,
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
  overwrite_existing: number;
  error_log:         string | null;
  progress_json:     string | null;
  execution_log:     string | null;   // timestamped append-only log lines
  last_activity_at:  number | null;   // unix timestamp — updated after every action
  created_at:        number;
  completed_at:      number | null;
  // Added in migration 0010 — slot-based generation
  post_slots:        string | null;   // JSON: PostSlot[]
  total_slots:       number | null;
  current_slot_idx:  number | null;
  publish_time:      string | null;   // HH:MM
}

export interface GenerationProgress {
  current_client:   string;
  current_post:     string;    // e.g. "2026-05-12 / image"
  completed:        number;
  total_estimated:  number;
  errors:           number;
  clients_done:     number;
  clients_total:    number;
}

export async function createGenerationRun(
  db: D1Database,
  data: { triggered_by: string; date_range: string; client_filter: string | null; overwrite_existing?: boolean },
): Promise<GenerationRunRow> {
  const id  = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO generation_runs
         (id, phase, triggered_by, week_start, client_filter, status, posts_created, posts_updated, overwrite_existing, created_at, last_activity_at)
       VALUES (?, 1, ?, ?, ?, 'running', 0, 0, ?, ?, ?)`,
    )
    .bind(id, data.triggered_by, data.date_range, data.client_filter, data.overwrite_existing ? 1 : 0, now, now)
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

export async function updateGenerationProgress(
  db: D1Database,
  id: string,
  progress: GenerationProgress,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('UPDATE generation_runs SET progress_json = ?, last_activity_at = ? WHERE id = ?')
    .bind(JSON.stringify(progress), now, id)
    .run();
}

/** Store computed slot plan into the run record (migration 0010). */
export async function storeGenerationPlan(
  db: D1Database,
  id: string,
  slots: unknown[],
  publishTime: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE generation_runs
              SET post_slots = ?, total_slots = ?, current_slot_idx = 0,
                  publish_time = ?, last_activity_at = ?
              WHERE id = ?`)
    .bind(JSON.stringify(slots), slots.length, publishTime ?? '10:00', now, id)
    .run();
}

/** Advance current_slot_idx and update posts_created counter after one step completes. */
export async function advanceGenerationSlot(
  db: D1Database,
  id: string,
  newIdx: number,
  postsCreated: number,
  progressJson: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE generation_runs
              SET current_slot_idx = ?, posts_created = ?,
                  progress_json = ?, last_activity_at = ?
              WHERE id = ?`)
    .bind(newIdx, postsCreated, progressJson, now, id)
    .run();
}

/** Mark a generation run as completed or failed. */
export async function finalizeGenerationRun(
  db: D1Database,
  id: string,
  status: 'completed' | 'completed_with_errors' | 'failed',
  postsCreated: number,
  errorLog: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE generation_runs
              SET status = ?, posts_created = ?, error_log = ?, completed_at = ?, last_activity_at = ?
              WHERE id = ?`)
    .bind(status, postsCreated, errorLog, now, now, id)
    .run();
}

/**
 * Append a single timestamped line to execution_log and bump last_activity_at.
 * Uses SQL string concatenation — no read needed, single write.
 */
export async function appendGenerationLog(
  db: D1Database,
  id: string,
  level: 'INFO' | 'AI' | 'SAVED' | 'WARN' | 'ERROR' | 'START' | 'DONE',
  message: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ts  = new Date(now * 1000).toISOString().slice(0, 19) + 'Z';
  const line = `${ts} [${level}] ${message}`;
  await db
    .prepare(`UPDATE generation_runs
              SET execution_log = substr(COALESCE(execution_log || char(10), '') || ?, -40000),
                  last_activity_at = ?
              WHERE id = ?`)
    .bind(line, now, id)
    .run();
}

export async function appendGenerationError(
  db: D1Database,
  id: string,
  message: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ts  = new Date(now * 1000).toISOString().slice(0, 19) + 'Z';
  const line = `${ts} ${message}`;
  await db
    .prepare(`UPDATE generation_runs
              SET error_log = substr(COALESCE(error_log || char(10), '') || ?, -40000),
                  last_activity_at = ?
              WHERE id = ?`)
    .bind(line, now, id)
    .run();
}

/**
 * Auto-heal stuck runs — mark any run that has been 'running' for > thresholdSeconds
 * with no last_activity_at update as 'timed_out'.  Safe to call on every list request.
 */
export async function healStuckGenerationRuns(db: D1Database, thresholdSeconds = 600): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - thresholdSeconds;
  const now    = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE generation_runs
              SET status = 'timed_out',
                  completed_at = ?,
                  error_log = COALESCE(error_log || char(10), '') || 'Auto-marked timed_out: no activity for ${thresholdSeconds}s',
                  execution_log = COALESCE(execution_log || char(10), '') || ?
              WHERE status = 'running'
                AND ((last_activity_at IS NULL AND created_at < ?) OR last_activity_at < ?)`)
    .bind(now, `${new Date(now * 1000).toISOString().slice(0, 19)}Z [ERROR] Worker timed out — run auto-cancelled after ${thresholdSeconds}s of inactivity`, cutoff, cutoff)
    .run();
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
  try {
    const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    // Only store user_id if it looks like a real UUID (not a synthetic bot/system ID)
    const userId = (entry.user_id && /^[0-9a-f]{32}$/i.test(entry.user_id.replace(/-/g, '')))
      ? entry.user_id
      : null;
    await db
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id,
           old_value, new_value, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        userId,
        entry.action,
        entry.entity_type ?? null,
        entry.entity_id ?? null,
        entry.old_value ? JSON.stringify(entry.old_value) : null,
        entry.new_value ? JSON.stringify(entry.new_value) : null,
        entry.ip ?? null,
        now,
      )
      .run();
  } catch { /* audit logs are non-fatal — never block business operations */ }
}
