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
  ApprovedCommandJobRow,
  ContentRequestRow,
  ClientTopicRow,
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
      .prepare(
        // asset_count is a computed column used by list views (approvals card,
        // calendar, etc.) to show a "+N more" indicator for multi-image posts.
        `SELECT posts.*, (
           SELECT COUNT(*) FROM assets WHERE assets.post_id = posts.id
         ) AS asset_count
         FROM posts ${where} ORDER BY publish_date ${order} LIMIT ? OFFSET ?`,
      )
      .bind(...binds, limit, offset)
      .all<PostRow & { asset_count: number }>(),
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

export type ClaimResult =
  | { claimed: true }
  | { claimed: false; reason: 'already_sent' | 'already_processing' | 'tracking_recovered' | 'max_retries' | 'concurrent'; existingTrackingId?: string };

/**
 * Atomically claim a post_platforms slot before sending.
 *
 * Uses INSERT OR IGNORE so that exactly ONE concurrent worker can claim the slot —
 * SQLite serializes the insert and only one `meta.changes` will be 1.
 *
 * For existing failed records the same guarantee is achieved via a conditional
 * UPDATE WHERE status IN ('failed','skipped','pending'), which only succeeds for
 * the worker whose UPDATE actually changes the row.
 */
export async function claimPostPlatform(
  db: D1Database,
  postId: string,
  platform: string,
  idemKey: string,
): Promise<ClaimResult> {
  const id  = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = new Date().toISOString();

  // Fast path: try to insert a brand-new 'processing' row.
  // INSERT OR IGNORE is atomic — concurrent workers see changes=0.
  const insert = await db
    .prepare(
      `INSERT OR IGNORE INTO post_platforms
         (id, post_id, platform, status, idempotency_key, attempted_at, attempt_count)
       VALUES (?, ?, ?, 'processing', ?, ?, 1)`,
    )
    .bind(id, postId, platform, idemKey, now)
    .run();

  if (insert.meta.changes === 1) return { claimed: true };

  // Row already exists — read the current state.
  const row = await db
    .prepare('SELECT id, status, tracking_id, attempt_count FROM post_platforms WHERE post_id = ? AND platform = ?')
    .bind(postId, platform)
    .first<{ id: string; status: string | null; tracking_id: string | null; attempt_count: number | null }>();

  if (!row) return { claimed: true }; // Shouldn't happen but safe default

  const s        = (row.status ?? '').toLowerCase();
  const attempts = row.attempt_count ?? 0;

  if (['sent', 'posted', 'idempotent'].includes(s)) return { claimed: false, reason: 'already_sent' };
  if (s === 'processing')                           return { claimed: false, reason: 'already_processing' };
  if (s === 'failed' && row.tracking_id)            return { claimed: false, reason: 'tracking_recovered', existingTrackingId: row.tracking_id };
  if (s === 'failed' && attempts >= 3)              return { claimed: false, reason: 'max_retries' };

  // Existing failed/skipped/pending row within retry limit — attempt conditional claim.
  // The WHERE clause acts as an optimistic lock: only one concurrent worker succeeds.
  const update = await db
    .prepare(
      `UPDATE post_platforms
       SET status = 'processing', idempotency_key = ?, attempted_at = ?, attempt_count = attempt_count + 1
       WHERE id = ? AND status IN ('failed', 'skipped', 'pending', 'skip', 'blocked')`,
    )
    .bind(idemKey, now, row.id)
    .run();

  if (update.meta.changes === 1) return { claimed: true };

  // Another worker just claimed this row between our SELECT and UPDATE.
  return { claimed: false, reason: 'concurrent' };
}

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
// APPROVED COMMAND JOBS
// ─────────────────────────────────────────────────────────────────────────────

export async function createApprovedCommandJob(
  db: D1Database,
  data: {
    generation_run_id: string | null;
    command_name: string;
    provider: string;
    requested_by: string;
    args_json: string;
  },
): Promise<ApprovedCommandJobRow> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO approved_command_jobs
     (id, generation_run_id, command_name, provider, requested_by, args_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).bind(id, data.generation_run_id, data.command_name, data.provider, data.requested_by, data.args_json, now, now).run();
  return (await getApprovedCommandJobById(db, id))!;
}

export async function getApprovedCommandJobById(
  db: D1Database,
  id: string,
): Promise<ApprovedCommandJobRow | null> {
  const row = await db.prepare('SELECT * FROM approved_command_jobs WHERE id = ?').bind(id).first<ApprovedCommandJobRow>();
  return row ?? null;
}

export async function listApprovedCommandJobs(
  db: D1Database,
  limit = 30,
): Promise<ApprovedCommandJobRow[]> {
  const rows = await db
    .prepare('SELECT * FROM approved_command_jobs ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<ApprovedCommandJobRow>();
  return rows.results;
}

export async function claimNextApprovedCommandJob(
  db: D1Database,
  runnerId: string,
): Promise<ApprovedCommandJobRow | null> {
  const next = await db
    .prepare(`SELECT id FROM approved_command_jobs
              WHERE status = 'queued'
              ORDER BY created_at ASC
              LIMIT 1`)
    .first<{ id: string }>();
  if (!next?.id) return null;

  const now = Math.floor(Date.now() / 1000);
  const claimed = await db.prepare(
    `UPDATE approved_command_jobs
     SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'queued'`,
  ).bind(runnerId, now, now, next.id).run();

  if (claimed.meta.changes !== 1) return null;
  return await getApprovedCommandJobById(db, next.id);
}

export async function markApprovedCommandJobRunning(
  db: D1Database,
  id: string,
  commandLine: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE approved_command_jobs
     SET status = 'running', command_line = ?, started_at = COALESCE(started_at, ?), updated_at = ?
     WHERE id = ?`,
  ).bind(commandLine, now, now, id).run();
}

export async function updateApprovedCommandJobProgress(
  db: D1Database,
  id: string,
  message: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE approved_command_jobs
     SET progress_message = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(message, now, id).run();
}

export async function completeApprovedCommandJob(
  db: D1Database,
  id: string,
  status: 'completed' | 'failed' | 'cancelled',
  result_json: string | null,
  error_log: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE approved_command_jobs
     SET status = ?, result_json = ?, error_log = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(status, result_json, error_log, now, now, id).run();
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

// ─────────────────────────────────────────────────────────────────────────────
// POST ASSETS (multi-image carousel support — migration 0027)
// ─────────────────────────────────────────────────────────────────────────────

export interface PostAssetRow {
  id:           string;
  post_id:      string | null;
  client_id:    string;
  r2_key:       string;
  r2_bucket:    string;
  filename:     string | null;
  content_type: string | null;
  size_bytes:   number | null;
  source:       string | null;
  sort_order:   number;
  created_at:   number;
}

/** List explicitly-attached assets for a post, ordered. Empty list if none. */
export async function listPostAssetsRows(
  db: D1Database,
  postId: string,
): Promise<PostAssetRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, post_id, client_id, r2_key, r2_bucket, filename, content_type, size_bytes, source, sort_order, created_at
       FROM assets
       WHERE post_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(postId)
    .all<PostAssetRow>();
  return rows.results;
}

/**
 * Unified media read for a post: returns explicitly-attached assets when any
 * exist, otherwise synthesizes a single-item list from the legacy
 * posts.asset_r2_key column. Callers should use this everywhere they need
 * the ordered image set for a post.
 */
export async function listPostMedia(
  db: D1Database,
  post: Pick<PostRow, 'id' | 'asset_r2_key' | 'asset_r2_bucket' | 'asset_type'>,
): Promise<Array<{
  id:           string | null;
  r2_key:       string;
  r2_bucket:    string;
  filename:     string | null;
  content_type: string | null;
  sort_order:   number;
}>> {
  const rows = await listPostAssetsRows(db, post.id);
  if (rows.length > 0) {
    return rows.map(r => ({
      id:           r.id,
      r2_key:       r.r2_key,
      r2_bucket:    r.r2_bucket,
      filename:     r.filename,
      content_type: r.content_type,
      sort_order:   r.sort_order,
    }));
  }
  if (post.asset_r2_key) {
    const filename = post.asset_r2_key.split('/').pop() ?? null;
    const isVideo  = post.asset_type === 'video' || post.asset_type === 'reel' ||
                     (filename ? /\.(mp4|mov|webm|avi)$/i.test(filename) : false);
    return [{
      id:           null,
      r2_key:       post.asset_r2_key,
      r2_bucket:    post.asset_r2_bucket ?? 'MEDIA',
      filename,
      content_type: isVideo ? 'video/mp4' : 'image/jpeg',
      sort_order:   0,
    }];
  }
  return [];
}

/** Insert a new asset row — used by upload + agent image generation paths. */
export async function insertPostAsset(
  db: D1Database,
  a: {
    id?:          string;
    post_id:      string | null;
    client_id:    string;
    r2_key:       string;
    r2_bucket:    string;
    filename?:    string | null;
    content_type?: string | null;
    size_bytes?:  number | null;
    source?:      string | null;
    sort_order?:  number;
  },
): Promise<PostAssetRow> {
  const id  = a.id ?? crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const sortOrder = a.sort_order ?? 0;
  await db
    .prepare(
      `INSERT INTO assets (id, post_id, client_id, r2_key, r2_bucket, filename,
                           content_type, size_bytes, source, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, a.post_id, a.client_id, a.r2_key, a.r2_bucket,
      a.filename ?? null, a.content_type ?? null, a.size_bytes ?? null,
      a.source ?? 'upload', sortOrder, now,
    )
    .run();
  return {
    id, post_id: a.post_id, client_id: a.client_id,
    r2_key: a.r2_key, r2_bucket: a.r2_bucket,
    filename: a.filename ?? null, content_type: a.content_type ?? null,
    size_bytes: a.size_bytes ?? null, source: a.source ?? 'upload',
    sort_order: sortOrder, created_at: now,
  };
}

/** Attach previously-uploaded unattached assets (post_id=NULL) to a new post. */
export async function attachAssetsToPost(
  db: D1Database,
  postId: string,
  assetIds: string[],
): Promise<number> {
  if (assetIds.length === 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  let attached = 0;
  for (let i = 0; i < assetIds.length; i++) {
    const res = await db
      .prepare(`UPDATE assets SET post_id = ?, sort_order = ? WHERE id = ?`)
      .bind(postId, i, assetIds[i])
      .run();
    if (res.meta?.changes) attached++;
  }
  await db.prepare('UPDATE posts SET updated_at = ? WHERE id = ?').bind(now, postId).run();
  return attached;
}

/** Rewrite the sort_order for all of a post's attached assets. */
export async function reorderPostAssets(
  db: D1Database,
  postId: string,
  orderedAssetIds: string[],
): Promise<void> {
  for (let i = 0; i < orderedAssetIds.length; i++) {
    await db
      .prepare('UPDATE assets SET sort_order = ? WHERE id = ? AND post_id = ?')
      .bind(i, orderedAssetIds[i], postId)
      .run();
  }
}

/** Delete every asset row + R2 object attached to a post. */
export async function deleteAllPostAssets(
  db: D1Database,
  deleteR2: (r2_key: string, bucket: string) => Promise<void>,
  postId: string,
): Promise<number> {
  const rows = await listPostAssetsRows(db, postId);
  let deleted = 0;
  for (const r of rows) {
    try { await deleteR2(r.r2_key, r.r2_bucket); } catch { /* non-fatal */ }
    await db.prepare('DELETE FROM assets WHERE id = ?').bind(r.id).run();
    deleted++;
  }
  return deleted;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT REQUESTS (recurring schedules) — migration 0026
// ─────────────────────────────────────────────────────────────────────────────

export async function listContentRequests(
  db: D1Database,
  filters: { clientId?: string; activeOnly?: boolean } = {},
): Promise<ContentRequestRow[]> {
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (filters.clientId)  { conds.push('client_id = ?'); binds.push(filters.clientId); }
  if (filters.activeOnly) { conds.push('active = 1 AND paused = 0'); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await db
    .prepare(`SELECT * FROM content_requests ${where} ORDER BY COALESCE(next_run_date, '9999-12-31') ASC LIMIT 200`)
    .bind(...binds)
    .all<ContentRequestRow>();
  return rows.results;
}

export async function getContentRequestById(
  db: D1Database,
  id: string,
): Promise<ContentRequestRow | null> {
  const row = await db
    .prepare('SELECT * FROM content_requests WHERE id = ?')
    .bind(id)
    .first<ContentRequestRow>();
  return row ?? null;
}

export async function createContentRequest(
  db: D1Database,
  data: Partial<ContentRequestRow> & { client_id: string },
): Promise<ContentRequestRow> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const record: Record<string, unknown> = { id, created_at: now, updated_at: now, ...data };
  const cols = Object.keys(record);
  const vals = Object.values(record);
  const placeholders = cols.map(() => '?').join(', ');
  await db
    .prepare(`INSERT INTO content_requests (${cols.join(', ')}) VALUES (${placeholders})`)
    .bind(...vals)
    .run();
  const row = await getContentRequestById(db, id);
  if (!row) throw new Error('Failed to create content request');
  return row;
}

export async function updateContentRequest(
  db: D1Database,
  id: string,
  fields: Partial<ContentRequestRow>,
): Promise<void> {
  const entries = Object.entries(fields).filter(([k]) => k !== 'id' && k !== 'client_id' && k !== 'created_at');
  if (entries.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  const sets = [...entries.map(([k]) => `${k} = ?`), 'updated_at = ?'];
  const vals = [...entries.map(([, v]) => v), now, id];
  await db.prepare(`UPDATE content_requests SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT TOPIC QUEUE — migration 0026
// ─────────────────────────────────────────────────────────────────────────────

export async function listClientTopics(
  db: D1Database,
  clientId: string,
  status: 'pending' | 'used' | 'skipped' | 'all' = 'pending',
  limit = 50,
): Promise<ClientTopicRow[]> {
  const conds = ['client_id = ?'];
  const binds: unknown[] = [clientId];
  if (status !== 'all') { conds.push('status = ?'); binds.push(status); }
  const rows = await db
    .prepare(
      `SELECT * FROM client_topics
       WHERE ${conds.join(' AND ')}
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<ClientTopicRow>();
  return rows.results;
}

export async function addClientTopics(
  db: D1Database,
  clientId: string,
  topics: Array<{
    topic:        string;
    content_type?: string | null;
    platforms?:    string | null;
    target_date?:  string | null;
    priority?:     number;
    notes?:        string | null;
  }>,
  createdBy: string | null = null,
): Promise<{ inserted: number }> {
  let inserted = 0;
  const now = Math.floor(Date.now() / 1000);
  for (const t of topics) {
    const topic = (t.topic ?? '').trim();
    if (!topic) continue;
    const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
    try {
      await db
        .prepare(
          `INSERT INTO client_topics
             (id, client_id, topic, content_type, platforms, target_date, priority, status, notes, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(
          id, clientId, topic,
          t.content_type ?? null, t.platforms ?? null,
          t.target_date ?? null, t.priority ?? 0,
          t.notes ?? null, createdBy, now,
        )
        .run();
      inserted++;
    } catch { /* skip duplicate / bad row */ }
  }
  return { inserted };
}

/** Fetch-and-return the next pending topic for a client (caller must mark used). */
export async function peekNextClientTopic(
  db: D1Database,
  clientId: string,
  contentType: string | null = null,
): Promise<ClientTopicRow | null> {
  const conds = ['client_id = ?', "status = 'pending'"];
  const binds: unknown[] = [clientId];
  if (contentType) {
    conds.push('(content_type IS NULL OR content_type = ?)');
    binds.push(contentType);
  }
  const row = await db
    .prepare(
      `SELECT * FROM client_topics
       WHERE ${conds.join(' AND ')}
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`,
    )
    .bind(...binds)
    .first<ClientTopicRow>();
  return row ?? null;
}

export async function markClientTopicUsed(
  db: D1Database,
  topicId: string,
  postId: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE client_topics SET status = 'used', used_post_id = ?, used_at = ? WHERE id = ?")
    .bind(postId, now, topicId)
    .run();
}

export async function deleteClientTopic(db: D1Database, topicId: string): Promise<void> {
  await db.prepare('DELETE FROM client_topics WHERE id = ?').bind(topicId).run();
}
