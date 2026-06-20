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
  AgentDefinitionRow,
  AgentRunRow,
  AgentTaskRow,
  AgentFindingRow,
  AgencyLogRow,
  ContentRequestRow,
  ClientTopicRow,
  ClientMonthlyTopicRow,
  ClientMonthlyContentPlanRow,
} from '../types';
import { redactSecrets } from '../modules/redaction';

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

export interface ContentHistoryRow extends PostRow {
  monthly_topic_title: string | null;
  monthly_topic_status: string | null;
  monthly_topic_skip_reason: string | null;
  linked_service_category: string | null;
}

export interface ClientGenerationTopicHistoryRow {
  title: string;
  target_keyword: string | null;
  content_type: string | null;
  publish_date: string | null;
  platforms: string[];
}

export interface ListClientContentHistoryParams {
  clientId: string;
  dateFrom?: string;
  dateTo?: string;
  contentType?: string;
  platform?: string;
  serviceCategory?: string;
  search?: string;
  limit?: number;
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

export async function getClientGenerationTopicHistory(
  db: D1Database,
  clientId: string,
  limit = 24,
): Promise<ClientGenerationTopicHistoryRow[]> {
  const rows = await db
    .prepare(
      `SELECT title, target_keyword, content_type, publish_date, platforms
       FROM posts
       WHERE client_id = ?
         AND status NOT IN ('cancelled')
         AND title IS NOT NULL
         AND trim(title) != ''
       ORDER BY COALESCE(publish_date, '') DESC, created_at DESC
       LIMIT ?`,
    )
    .bind(clientId, Math.max(1, Math.min(limit, 60)))
    .all<{
      title: string | null;
      target_keyword: string | null;
      content_type: string | null;
      publish_date: string | null;
      platforms: string | null;
    }>();

  return rows.results
    .filter((row): row is {
      title: string;
      target_keyword: string | null;
      content_type: string | null;
      publish_date: string | null;
      platforms: string | null;
    } => typeof row.title === 'string' && row.title.trim().length > 0)
    .map((row) => {
      let platforms: string[] = [];
      try {
        const parsed = JSON.parse(row.platforms ?? '[]') as unknown;
        if (Array.isArray(parsed)) {
          platforms = parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {
        platforms = [];
      }
      return {
        title: row.title.trim(),
        target_keyword: row.target_keyword,
        content_type: row.content_type,
        publish_date: row.publish_date,
        platforms,
      };
    });
}

export async function listClientContentHistory(
  db: D1Database,
  params: ListClientContentHistoryParams,
): Promise<ContentHistoryRow[]> {
  const conditions = ['p.client_id = ?'];
  const binds: unknown[] = [params.clientId];

  if (params.dateFrom) {
    conditions.push("substr(p.publish_date, 1, 10) >= ?");
    binds.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push("substr(p.publish_date, 1, 10) <= ?");
    binds.push(params.dateTo);
  }
  if (params.contentType) {
    conditions.push('p.content_type = ?');
    binds.push(params.contentType);
  }
  if (params.platform) {
    conditions.push('p.platforms LIKE ?');
    binds.push(`%"${params.platform}"%`);
  }
  if (params.serviceCategory) {
    conditions.push('LOWER(COALESCE(p.topic_service_category, mt.service_category, "")) LIKE ?');
    binds.push(`%${params.serviceCategory.toLowerCase()}%`);
  }
  if (params.search) {
    conditions.push(`(
      p.title LIKE ?
      OR p.target_keyword LIKE ?
      OR p.master_caption LIKE ?
      OR COALESCE(mt.topic_title, '') LIKE ?
      OR COALESCE(p.topic_service_category, mt.service_category, '') LIKE ?
    )`);
    const term = `%${params.search}%`;
    binds.push(term, term, term, term, term);
  }

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 300);
  const rows = await db
    .prepare(
      `SELECT
         p.*,
         mt.topic_title AS monthly_topic_title,
         mt.status AS monthly_topic_status,
         mt.skip_reason AS monthly_topic_skip_reason,
         COALESCE(p.topic_service_category, mt.service_category) AS linked_service_category
       FROM posts p
       LEFT JOIN client_monthly_topics mt
         ON mt.id = p.monthly_topic_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(p.publish_date, '') DESC, p.updated_at DESC
       LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<ContentHistoryRow>();
  return rows.results;
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
        meta_description, slug, target_keyword, target_locality, secondary_keywords, ai_image_prompt, ai_video_prompt,
        video_script, asset_r2_key, asset_r2_bucket, asset_type, canva_link,
        ready_for_automation, asset_delivered, skarleth_notes, error_log,
        scheduled_by_automation, platform_manual_override, automation_slot_key, generation_run_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?)`,
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
      data.target_keyword ?? null, data.target_locality ?? null, data.secondary_keywords ?? null, data.ai_image_prompt ?? null,
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

export async function getPostByAutomationSlotKey(
  db: D1Database,
  clientId: string,
  automationSlotKey: string,
): Promise<PostRow | null> {
  const row = await db
    .prepare('SELECT * FROM posts WHERE client_id = ? AND automation_slot_key = ? LIMIT 1')
    .bind(clientId, automationSlotKey)
    .first<PostRow>();
  return row ?? null;
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

export interface GenerationErrorRecord {
  kind: 'generation_error';
  run_id: string;
  command_job_id: string | null;
  client: string | null;
  client_slug: string | null;
  slot_idx: number | null;
  provider: string | null;
  failing_step: string | null;
  message: string;
  details: string | null;
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

function stringifyGenerationError(record: GenerationErrorRecord): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    ...record,
  });
}

export async function appendStructuredGenerationError(
  db: D1Database,
  id: string,
  record: GenerationErrorRecord,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const line = stringifyGenerationError(record);
  await db
    .prepare(`UPDATE generation_runs
              SET error_log = substr(COALESCE(error_log || char(10), '') || ?, -40000),
                  last_activity_at = ?
              WHERE id = ?`)
    .bind(line, now, id)
    .run();
}

export async function appendApprovedCommandJobError(
  db: D1Database,
  id: string,
  record: GenerationErrorRecord,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const line = stringifyGenerationError(record);
  await db
    .prepare(`UPDATE approved_command_jobs
              SET error_log = substr(COALESCE(error_log || char(10), '') || ?, -40000),
                  updated_at = ?
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

// Lease window: how long a claimed/running job may go without a progress
// update before the reaper considers it dead and reclaims it.
const APPROVED_JOB_LEASE_SECONDS = 1800; // 30 minutes — covers slow single-client
// agency work between per-client lease pings; crashed runners still recover, just
// after 30m instead of 15m. Long multi-client sweeps ping the lease per client.

export async function claimNextApprovedCommandJob(
  db: D1Database,
  runnerId: string,
): Promise<ApprovedCommandJobRow | null> {
  const now = Math.floor(Date.now() / 1000);
  // Eligible: queued AND past any retry-backoff window.
  const next = await db
    .prepare(`SELECT id FROM approved_command_jobs
              WHERE status = 'queued'
                AND (next_retry_at IS NULL OR next_retry_at <= ?)
              ORDER BY created_at ASC
              LIMIT 1`)
    .bind(now)
    .first<{ id: string }>();
  if (!next?.id) return null;

  const lease = now + APPROVED_JOB_LEASE_SECONDS;
  // Atomic claim: increment attempts and set a lease. WHERE status='queued'
  // guarantees only one runner wins the row.
  const claimed = await db.prepare(
    `UPDATE approved_command_jobs
     SET status = 'claimed', claimed_by = ?, claimed_at = ?,
         attempts = attempts + 1, lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'queued'`,
  ).bind(runnerId, now, lease, now, next.id).run();

  if (claimed.meta.changes !== 1) return null;
  return await getApprovedCommandJobById(db, next.id);
}

export async function markApprovedCommandJobRunning(
  db: D1Database,
  id: string,
  commandLine: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const lease = now + APPROVED_JOB_LEASE_SECONDS;
  await db.prepare(
    `UPDATE approved_command_jobs
     SET status = 'running', command_line = ?, started_at = COALESCE(started_at, ?),
         lease_expires_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(commandLine, now, lease, now, id).run();
}

export async function updateApprovedCommandJobProgress(
  db: D1Database,
  id: string,
  message: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const lease = now + APPROVED_JOB_LEASE_SECONDS;
  // Every progress ping (incl. heartbeat) extends the lease so a healthy,
  // long-running job is never reaped out from under itself.
  await db.prepare(
    `UPDATE approved_command_jobs
     SET progress_message = ?, lease_expires_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(message, lease, now, id).run();
}

export async function completeApprovedCommandJob(
  db: D1Database,
  id: string,
  status: 'completed' | 'failed' | 'cancelled',
  result_json: string | null,
  error_log: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // On failure, retry with exponential backoff until max_attempts, then
  // dead-letter. Completed/cancelled are terminal.
  if (status === 'failed') {
    const row = await db
      .prepare('SELECT attempts, max_attempts FROM approved_command_jobs WHERE id = ?')
      .bind(id)
      .first<{ attempts: number; max_attempts: number }>();
    const attempts = row?.attempts ?? 1;
    const maxAttempts = row?.max_attempts ?? 3;
    if (attempts < maxAttempts) {
      // Backoff: 1m, 4m, 9m ... capped at 30m.
      const backoff = Math.min(attempts * attempts * 60, 1800);
      await db.prepare(
        `UPDATE approved_command_jobs
         SET status = 'queued', error_log = ?, next_retry_at = ?,
             lease_expires_at = NULL, claimed_by = NULL,
             last_error_at = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(error_log, now + backoff, now, now, id).run();
      return;
    }
    // Exhausted — dead-letter for human review.
    await db.prepare(
      `UPDATE approved_command_jobs
       SET status = 'dead_letter', error_log = ?, completed_at = ?,
           last_error_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(error_log, now, now, now, id).run();
    return;
  }

  await db.prepare(
    `UPDATE approved_command_jobs
     SET status = ?, result_json = ?, error_log = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(status, result_json, error_log, now, now, id).run();
}

/**
 * Reaper — reclaim approved-command jobs whose runner died.
 * A 'claimed'/'running' job whose lease_expires_at has passed is returned to
 * 'queued' (if attempts remain) or moved to 'dead_letter'. Safe to call every
 * minute from cron. Returns the rows it acted on for alerting.
 */
export async function reclaimStuckApprovedJobs(
  db: D1Database,
): Promise<{ requeued: string[]; dead_lettered: string[] }> {
  const now = Math.floor(Date.now() / 1000);
  const stuck = await db
    .prepare(`SELECT id, attempts, max_attempts, command_name FROM approved_command_jobs
              WHERE status IN ('claimed', 'running')
                AND lease_expires_at IS NOT NULL
                AND lease_expires_at < ?`)
    .bind(now)
    .all<{ id: string; attempts: number; max_attempts: number; command_name: string }>();

  const requeued: string[] = [];
  const dead_lettered: string[] = [];
  for (const job of stuck.results) {
    const msg = `Lease expired (runner presumed dead) at ${new Date(now * 1000).toISOString()}`;
    if ((job.attempts ?? 1) < (job.max_attempts ?? 3)) {
      const backoff = Math.min((job.attempts ?? 1) * (job.attempts ?? 1) * 60, 1800);
      await db.prepare(
        `UPDATE approved_command_jobs
         SET status = 'queued', claimed_by = NULL, lease_expires_at = NULL,
             next_retry_at = ?, last_error_at = ?,
             error_log = substr(COALESCE(error_log || char(10), '') || ?, -40000),
             updated_at = ?
         WHERE id = ? AND status IN ('claimed','running')`,
      ).bind(now + backoff, now, msg, now, job.id).run();
      requeued.push(job.id);
    } else {
      await db.prepare(
        `UPDATE approved_command_jobs
         SET status = 'dead_letter', completed_at = ?, last_error_at = ?,
             error_log = substr(COALESCE(error_log || char(10), '') || ?, -40000),
             updated_at = ?
         WHERE id = ? AND status IN ('claimed','running')`,
      ).bind(now, now, `${msg} — max attempts reached`, now, job.id).run();
      dead_lettered.push(job.id);
    }
  }
  return { requeued, dead_lettered };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENCY BACKEND COST TRACKING
// ─────────────────────────────────────────────────────────────────────────────

export async function recordAgencyCost(
  db: D1Database,
  data: { agent_slug: string; backend: string; mode?: string | null; cost_usd?: number | null; run_id?: string | null; task_id?: string | null; executor_reason?: string | null },
): Promise<void> {
  await db.prepare(
    `INSERT INTO agency_cost_log (id, agent_slug, backend, mode, cost_usd, run_id, task_id, executor_reason, created_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    data.agent_slug,
    data.backend,
    data.mode ?? null,
    data.cost_usd ?? null,
    data.run_id ?? null,
    data.task_id ?? null,
    data.executor_reason ?? null,
    Math.floor(Date.now() / 1000),
  ).run();
}

// ── Client keyword set (§3/§4) — shared, queryable, consumed by every agent ──

export interface ClientKeywordRow {
  id: string;
  client_id: string;
  keyword: string;
  kw_type: string;
  search_intent: string | null;
  difficulty: string | null;
  opportunity_notes: string | null;
  locality: string | null;
  source: string | null;
  confidence: string | null;
  status: string;
}

export async function getClientKeywords(db: D1Database, clientId: string): Promise<ClientKeywordRow[]> {
  const rows = await db.prepare(
    `SELECT id, client_id, keyword, kw_type, search_intent, difficulty, opportunity_notes, locality, source, confidence, status
     FROM client_keywords WHERE client_id = ? AND status = 'active'
     ORDER BY CASE kw_type WHEN 'primary' THEN 0 WHEN 'local' THEN 1 WHEN 'near_me' THEN 2 WHEN 'long_tail' THEN 3 ELSE 4 END, keyword`,
  ).bind(clientId).all<ClientKeywordRow>();
  return rows.results ?? [];
}

// Upsert keeps the unique (client_id, keyword) row fresh without ever deleting —
// curated/manual keywords survive. Dedup via the uq_client_keyword index.
export async function upsertClientKeywords(
  db: D1Database,
  clientId: string,
  keywords: Array<{ keyword: string; kw_type?: string; search_intent?: string | null; difficulty?: string | null; opportunity_notes?: string | null; locality?: string | null; source?: string | null; confidence?: string | null }>,
): Promise<number> {
  let n = 0;
  for (const k of keywords) {
    const keyword = (k.keyword || '').trim();
    if (!keyword) continue;
    await db.prepare(
      `INSERT INTO client_keywords (client_id, keyword, kw_type, search_intent, difficulty, opportunity_notes, locality, source, confidence, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(client_id, keyword) DO UPDATE SET
         kw_type=excluded.kw_type, search_intent=excluded.search_intent, difficulty=excluded.difficulty,
         opportunity_notes=excluded.opportunity_notes, locality=excluded.locality,
         source=excluded.source, confidence=excluded.confidence, status='active', updated_at=unixepoch()`,
    ).bind(
      clientId, keyword, k.kw_type ?? 'secondary', k.search_intent ?? null, k.difficulty ?? null,
      k.opportunity_notes ?? null, k.locality ?? null, k.source ?? 'research', k.confidence ?? 'medium',
    ).run();
    n++;
  }
  return n;
}

// ── Client profile gaps (§5 missing-information protocol) ──

export interface ClientProfileGapRow {
  id: string;
  client_id: string;
  field: string;
  question: string | null;
  status: string;
  assumption: string | null;
  resolution: string | null;
}

// Agent-proposed GBP Offer — saved INACTIVE (active=0, paused=1, no schedule).
// It shows in the Offers UI for Marvin to review, add a designer image, and
// activate. Activation (human) is what lets recurring-gbp-run post it, so this
// never bypasses the Marvin/designer gate.
export async function createClientOfferDraft(
  db: D1Database,
  d: { client_id: string; title: string; description?: string | null; cta_text?: string | null; gbp_cta_type?: string | null; gbp_cta_url?: string | null; gbp_coupon_code?: string | null; gbp_redeem_url?: string | null; gbp_terms?: string | null; valid_until?: string | null; gbp_location_id?: string | null; ai_image_prompt?: string | null },
): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  await db.prepare(
    `INSERT INTO client_offers
       (id, client_id, title, description, cta_text, valid_until, active, paused, recurrence, next_run_date,
        gbp_cta_type, gbp_cta_url, gbp_coupon_code, gbp_redeem_url, gbp_terms, gbp_location_id, ai_image_prompt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, 'none', NULL, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
  ).bind(
    id, d.client_id, d.title, d.description ?? null, d.cta_text ?? null, d.valid_until ?? null,
    d.gbp_cta_type ?? null, d.gbp_cta_url ?? null, d.gbp_coupon_code ?? null, d.gbp_redeem_url ?? null,
    d.gbp_terms ?? null, d.gbp_location_id ?? null, d.ai_image_prompt ?? null,
  ).run();
  return id;
}

// Agent-proposed GBP Event — saved INACTIVE for the same human-gated reason.
export async function createClientEventDraft(
  db: D1Database,
  d: { client_id: string; title: string; description?: string | null; gbp_event_title?: string | null; gbp_event_start_date?: string | null; gbp_event_end_date?: string | null; gbp_cta_type?: string | null; gbp_cta_url?: string | null; gbp_location_id?: string | null; ai_image_prompt?: string | null },
): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  await db.prepare(
    `INSERT INTO client_events
       (id, client_id, title, description, gbp_event_title, gbp_event_start_date, gbp_event_end_date,
        gbp_cta_type, gbp_cta_url, gbp_location_id, recurrence, next_run_date, active, paused, ai_image_prompt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', NULL, 0, 1, ?, unixepoch(), unixepoch())`,
  ).bind(
    id, d.client_id, d.title, d.description ?? null, d.gbp_event_title ?? null,
    d.gbp_event_start_date ?? null, d.gbp_event_end_date ?? null,
    d.gbp_cta_type ?? null, d.gbp_cta_url ?? null, d.gbp_location_id ?? null, d.ai_image_prompt ?? null,
  ).run();
  return id;
}

export async function getClientProfileGaps(db: D1Database, clientId: string): Promise<ClientProfileGapRow[]> {
  const rows = await db.prepare(
    `SELECT id, client_id, field, question, status, assumption, resolution
     FROM client_profile_gaps WHERE client_id = ? ORDER BY created_at DESC`,
  ).bind(clientId).all<ClientProfileGapRow>();
  return rows.results ?? [];
}

export async function upsertClientProfileGap(
  db: D1Database,
  data: { client_id: string; field: string; question?: string | null; status?: string; assumption?: string | null; resolution?: string | null; asked_in_discord_at?: number | null },
): Promise<void> {
  await db.prepare(
    `INSERT INTO client_profile_gaps (client_id, field, question, status, assumption, resolution, asked_in_discord_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(client_id, field) DO UPDATE SET
       question=excluded.question, status=excluded.status, assumption=excluded.assumption,
       resolution=excluded.resolution, asked_in_discord_at=excluded.asked_in_discord_at, updated_at=unixepoch()`,
  ).bind(
    data.client_id, data.field, data.question ?? null, data.status ?? 'needs_info',
    data.assumption ?? null, data.resolution ?? null, data.asked_in_discord_at ?? null,
  ).run();
}

/** Total known USD spend for an agent since UTC midnight (NULL costs ignored). */
export async function getAgentSpendToday(db: D1Database, agentSlug: string): Promise<number> {
  const midnight = Math.floor(new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() / 1000);
  const row = await db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM agency_cost_log
              WHERE agent_slug = ? AND created_at >= ?`)
    .bind(agentSlug, midnight)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI AGENCY
// ─────────────────────────────────────────────────────────────────────────────

export interface AgencyOverviewSnapshot {
  active_agents: number;
  running_tasks: number;
  waiting_marvin_approval: number;
  waiting_designer_assets: number;
  failed_agent_jobs: number;
  completed_this_week: number;
  research_completed_this_week: number;
  posts_generated_this_week: number;
  blogs_generated_this_week: number;
  approval_pipeline: {
    research_complete_clients: number;
    active_clients: number;
    strategy_complete_clients: number;
    generated_drafts: number;
    editorial_reviews_this_week: number;
    waiting_marvin_approval: number;
    waiting_designer_assets: number;
    ready_for_automation: number;
    scheduled_or_posted_this_week: number;
  };
}

export interface AgencyClientCoverageRow {
  client_id: string;
  client_slug: string;
  client_name: string;
  package: string | null;
  weekly_schedule: string | null;
  last_research_date: string | null;
  research_freshness: string;
  current_strategy_status: string;
  posts_planned: number;
  posts_generated: number;
  posts_waiting_approval: number;
  posts_waiting_designer: number;
  blogs_planned: number;
  blogs_drafted: number;
  next_agent_action: string;
  risk_issues: string | null;
}

function unixWeekStart(): number {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - diff);
  return Math.floor(start.getTime() / 1000);
}

export async function listAgencyOverview(db: D1Database): Promise<AgencyOverviewSnapshot> {
  const weekStart = unixWeekStart();
  const today = new Date().toISOString().slice(0, 10);
  const [
    activeAgents,
    runningTasks,
    waitingApproval,
    waitingDesigner,
    failedTasks,
    failedJobs,
    completedWeek,
    researchWeek,
    postsWeek,
    blogsWeek,
    activeClients,
    researchCompleteClients,
    strategyCompleteClients,
    generatedDrafts,
    editorialReviewsWeek,
    readyForAutomation,
    scheduledOrPostedWeek,
  ] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM agent_definitions WHERE enabled = 1').first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE status = 'running'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'pending_approval'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status IN ('approved', 'ready') AND COALESCE(asset_delivered, 0) = 0 AND content_type != 'blog'").first<{ n: number }>(),
    // Recent failures only (last 7 days) — a 3-week-old failure is not "attention
    // needed" and shouldn't sit on the dashboard banner forever.
    db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE status = 'failed' AND created_at >= unixepoch() - 604800").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM approved_command_jobs WHERE command_name LIKE 'agency_%' AND status = 'failed' AND created_at >= unixepoch() - 604800").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE status = 'completed' AND updated_at >= ?").bind(weekStart).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM client_research_notes WHERE freshness_date >= ?').bind(today.slice(0, 8) + '01').first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM posts WHERE scheduled_by_automation = 1 AND content_type != 'blog' AND created_at >= ?").bind(weekStart).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM posts WHERE content_type = 'blog' AND created_at >= ?").bind(weekStart).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM clients WHERE status = 'active'").first<{ n: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n
       FROM clients c
       WHERE c.status = 'active'
         AND EXISTS (SELECT 1 FROM client_research_notes r WHERE r.client_id = c.id)`,
    ).first<{ n: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n
       FROM clients c
       WHERE c.status = 'active'
         AND EXISTS (
           SELECT 1 FROM client_strategy_plans s
           WHERE s.client_id = c.id AND s.status IN ('draft', 'approved')
         )`,
    ).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM posts WHERE scheduled_by_automation = 1 AND status = 'draft'").first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM content_review_notes WHERE created_at >= ?').bind(weekStart).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status IN ('ready', 'approved') AND ready_for_automation = 1 AND asset_delivered = 1").first<{ n: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n
       FROM posts
       WHERE status = 'scheduled'
          OR (status = 'posted' AND COALESCE(posted_at, created_at) >= ?)`,
    ).bind(weekStart).first<{ n: number }>(),
  ]);

  return {
    active_agents: activeAgents?.n ?? 0,
    running_tasks: runningTasks?.n ?? 0,
    waiting_marvin_approval: waitingApproval?.n ?? 0,
    waiting_designer_assets: waitingDesigner?.n ?? 0,
    failed_agent_jobs: (failedTasks?.n ?? 0) + (failedJobs?.n ?? 0),
    completed_this_week: completedWeek?.n ?? 0,
    research_completed_this_week: researchWeek?.n ?? 0,
    posts_generated_this_week: postsWeek?.n ?? 0,
    blogs_generated_this_week: blogsWeek?.n ?? 0,
    approval_pipeline: {
      research_complete_clients: researchCompleteClients?.n ?? 0,
      active_clients: activeClients?.n ?? 0,
      strategy_complete_clients: strategyCompleteClients?.n ?? 0,
      generated_drafts: generatedDrafts?.n ?? 0,
      editorial_reviews_this_week: editorialReviewsWeek?.n ?? 0,
      waiting_marvin_approval: waitingApproval?.n ?? 0,
      waiting_designer_assets: waitingDesigner?.n ?? 0,
      ready_for_automation: readyForAutomation?.n ?? 0,
      scheduled_or_posted_this_week: scheduledOrPostedWeek?.n ?? 0,
    },
  };
}

export async function listAgentDefinitions(db: D1Database): Promise<AgentDefinitionRow[]> {
  const rows = await db
    .prepare('SELECT * FROM agent_definitions ORDER BY created_at ASC')
    .all<AgentDefinitionRow>();
  return rows.results;
}

export async function updateAgentHeartbeat(
  db: D1Database,
  slug: string,
  status: string,
  message: string | null,
  error: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const active = status === 'running';
  await db
    .prepare(
      `UPDATE agent_definitions
       SET heartbeat_status            = ?,
           heartbeat_message           = ?,
           last_error                  = CASE WHEN ? IS NOT NULL THEN ? ELSE last_error END,
           last_heartbeat_at           = ?,
           next_expected_heartbeat_at  = CASE WHEN ? THEN unixepoch() + (stale_after_minutes * 60) ELSE NULL END,
           updated_at                  = ?
       WHERE slug = ?`,
    )
    .bind(status, message, error, error, now, active ? 1 : 0, now, slug)
    .run();
}

export async function checkStaleAgents(db: D1Database): Promise<AgentDefinitionRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .prepare(
      `SELECT * FROM agent_definitions
       WHERE enabled = 1
         AND heartbeat_status NOT IN ('idle', 'paused', 'stale', 'healthy')
         AND next_expected_heartbeat_at IS NOT NULL
         AND next_expected_heartbeat_at < ?`,
    )
    .bind(now)
    .all<AgentDefinitionRow>();
  return rows.results;
}

export async function markAgentStale(db: D1Database, slug: string, message: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE agent_definitions
       SET heartbeat_status = 'stale', heartbeat_message = ?, updated_at = ?
       WHERE slug = ?`,
    )
    .bind(message, now, slug)
    .run();
}

export async function getAgentHealthSummary(db: D1Database): Promise<Record<string, number>> {
  const rows = await db
    .prepare(
      `SELECT heartbeat_status, COUNT(*) as cnt
       FROM agent_definitions
       WHERE enabled = 1
       GROUP BY heartbeat_status`,
    )
    .all<{ heartbeat_status: string; cnt: number }>();
  return Object.fromEntries(rows.results.map((r) => [r.heartbeat_status, r.cnt]));
}

export async function listAgentRuns(db: D1Database, limit = 30): Promise<AgentRunRow[]> {
  const rows = await db
    .prepare('SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<AgentRunRow>();
  return rows.results.map((run) => ({
    ...run,
    summary_json: run.summary_json ? redactSecrets(run.summary_json) : null,
    error: run.error ? redactSecrets(run.error) : null,
  }));
}

export async function listAgentTasks(db: D1Database, limit = 80): Promise<AgentTaskRow[]> {
  const rows = await db
    .prepare(
      `SELECT t.*, c.canonical_name AS client_name, d.name AS agent_name
       FROM agent_tasks t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN agent_definitions d ON d.slug = t.agent_slug
       ORDER BY t.updated_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<AgentTaskRow>();
  return rows.results.map((task) => ({
    ...task,
    input_json: task.input_json ? redactSecrets(task.input_json) : null,
    output_json: task.output_json ? redactSecrets(task.output_json) : null,
  }));
}

export async function getAgentTask(db: D1Database, id: string): Promise<AgentTaskRow | null> {
  const row = await db
    .prepare(
      `SELECT t.*, c.canonical_name AS client_name, d.name AS agent_name
       FROM agent_tasks t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN agent_definitions d ON d.slug = t.agent_slug
       WHERE t.id = ?`,
    )
    .bind(id)
    .first<AgentTaskRow>();
  if (!row) return null;
  return {
    ...row,
    input_json: row.input_json ? redactSecrets(row.input_json) : null,
    output_json: row.output_json ? redactSecrets(row.output_json) : null,
  };
}

export async function createAgentTask(
  db: D1Database,
  data: {
    agent_slug: string;
    client_id?: string | null;
    related_post_id?: string | null;
    related_blog_id?: string | null;
    approved_job_id?: string | null;
    title: string;
    status?: string;
    priority?: string;
    progress?: number;
    input_json?: string | null;
    due_at?: number | null;
  },
): Promise<AgentTaskRow> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO agent_tasks
     (id, agent_slug, client_id, related_post_id, related_blog_id, approved_job_id, title, status, priority, progress, input_json, due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    data.agent_slug,
    data.client_id ?? null,
    data.related_post_id ?? null,
    data.related_blog_id ?? null,
    data.approved_job_id ?? null,
    data.title,
    data.status ?? 'queued',
    data.priority ?? 'medium',
    data.progress ?? 0,
    data.input_json ?? null,
    data.due_at ?? null,
    now,
    now,
  ).run();
  return (await getAgentTask(db, id))!;
}

export async function updateAgentTask(
  db: D1Database,
  id: string,
  data: { status?: string; progress?: number; output_json?: string | null; approved_job_id?: string | null; error?: string | null },
): Promise<AgentTaskRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await getAgentTask(db, id);
  if (!existing) return null;
  const nextStatus = data.status ?? existing.status;
  await db.prepare(
    `UPDATE agent_tasks
     SET status = ?,
         progress = ?,
         output_json = COALESCE(?, output_json),
         approved_job_id = COALESCE(?, approved_job_id),
         started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
         finished_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN ? ELSE finished_at END,
         updated_at = ?
     WHERE id = ?`,
  ).bind(
    nextStatus,
    data.progress ?? existing.progress,
    data.output_json ?? null,
    data.approved_job_id ?? null,
    nextStatus,
    now,
    nextStatus,
    now,
    now,
    id,
  ).run();
  await db.prepare(
    `UPDATE agent_definitions
     SET status = ?,
         current_task = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN NULL ELSE ? END,
         progress = ?,
         updated_at = ?
     WHERE slug = ?`,
  ).bind(
    nextStatus,
    nextStatus,
    existing.title,
    data.progress ?? existing.progress,
    now,
    existing.agent_slug,
  ).run();
  if (data.error) await appendAgencyLog(db, { task_id: id, status: 'error', summary: data.error });
  return getAgentTask(db, id);
}

export async function createAgentRun(
  db: D1Database,
  data: { agent_slug: string; task_id?: string | null; status?: string; backend?: string; created_by?: string | null },
): Promise<AgentRunRow> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO agent_runs (id, agent_slug, task_id, status, backend, started_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, data.agent_slug, data.task_id ?? null, data.status ?? 'running', data.backend ?? 'internal', now, data.created_by ?? null, now).run();
  const row = await db.prepare('SELECT * FROM agent_runs WHERE id = ?').bind(id).first<AgentRunRow>();
  return row!;
}

export async function updateAgentRun(
  db: D1Database,
  id: string,
  data: { status: string; summary_json?: string | null; error?: string | null },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const run = await db.prepare('SELECT started_at FROM agent_runs WHERE id = ?').bind(id).first<{ started_at: number | null }>();
  const duration = run?.started_at ? (now - run.started_at) * 1000 : null;
  await db.prepare(
    `UPDATE agent_runs
     SET status = ?, finished_at = ?, duration_ms = ?, summary_json = ?, error = ?
     WHERE id = ?`,
  ).bind(data.status, now, duration, data.summary_json ? redactSecrets(data.summary_json) : null, data.error ? redactSecrets(data.error) : null, id).run();
  const runRow = await db.prepare('SELECT agent_slug FROM agent_runs WHERE id = ?').bind(id).first<{ agent_slug: string }>();
  if (runRow?.agent_slug) {
    await db.prepare(
      `UPDATE agent_definitions
       SET last_run_at = ?,
           status = CASE WHEN ? = 'failed' THEN 'failed' ELSE 'idle' END,
           current_task = NULL,
           progress = CASE WHEN ? = 'failed' THEN progress ELSE 100 END,
           updated_at = ?
       WHERE slug = ?`,
    ).bind(now, data.status, data.status, now, runRow.agent_slug).run();
  }
}

export async function listAgentFindings(db: D1Database, limit = 60): Promise<AgentFindingRow[]> {
  const rows = await db
    .prepare(
      `SELECT f.*, c.canonical_name AS client_name, d.name AS agent_name
       FROM agent_findings f
       LEFT JOIN clients c ON c.id = f.client_id
       LEFT JOIN agent_definitions d ON d.slug = f.agent_slug
       ORDER BY
         CASE f.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
         CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
         f.created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<AgentFindingRow>();
  return rows.results.map((finding) => ({
    ...finding,
    finding_json: finding.finding_json ? redactSecrets(finding.finding_json) : null,
  }));
}

export async function createAgentFinding(
  db: D1Database,
  data: { agent_slug: string; client_id?: string | null; task_id?: string | null; severity: string; title: string; finding_json?: string | null },
): Promise<AgentFindingRow> {
  // De-dupe: the review agents run daily and would otherwise stack an identical
  // open finding every run. If the same agent already has this title open, return
  // it unchanged (no timestamp bump, so the age-out sweep can still close it, and
  // the /finding endpoint can tell it isn't new and skip re-alerting Discord).
  const dup = await db.prepare(
    "SELECT * FROM agent_findings WHERE agent_slug = ? AND title = ? AND status = 'open' LIMIT 1",
  ).bind(data.agent_slug, data.title).first<AgentFindingRow>();
  if (dup) return dup;
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO agent_findings (id, agent_slug, client_id, task_id, severity, title, finding_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).bind(id, data.agent_slug, data.client_id ?? null, data.task_id ?? null, data.severity, data.title, data.finding_json ? redactSecrets(data.finding_json) : null, now, now).run();
  const row = await db.prepare('SELECT * FROM agent_findings WHERE id = ?').bind(id).first<AgentFindingRow>();
  return row!;
}

export async function updateAgentFinding(db: D1Database, id: string, status: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare('UPDATE agent_findings SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, id).run();
}

// Auto-close open findings that haven't been re-detected in `days` days. A truly
// persistent issue gets re-raised by the next agent run (the dedup only matches
// while a finding is still open), so this only clears stale/already-fixed ones —
// stopping the dashboard from crying wolf over historical evidence.
export async function resolveStaleFindings(db: D1Database, days = 7): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const r = await db.prepare(
    "UPDATE agent_findings SET status = 'resolved', updated_at = unixepoch() WHERE status = 'open' AND updated_at < ?",
  ).bind(cutoff).run();
  return r.meta?.changes ?? 0;
}

export async function saveClientResearch(
  db: D1Database,
  clientId: string,
  source: string,
  researchJson: string,
  freshnessDate: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // Idempotent per client + day: a job that gets re-run (e.g. lease requeue mid
  // a long sweep) replaces that day's note instead of stacking duplicates.
  await db.prepare(
    'DELETE FROM client_research_notes WHERE client_id = ? AND freshness_date = ?',
  ).bind(clientId, freshnessDate).run();
  await db.prepare(
    `INSERT INTO client_research_notes (client_id, source, research_json, freshness_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(clientId, source, redactSecrets(researchJson), freshnessDate, now, now).run();
}

export async function saveClientStrategy(
  db: D1Database,
  clientId: string,
  periodStart: string,
  periodEnd: string,
  strategyJson: string,
  status = 'draft',
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO client_strategy_plans (client_id, period_start, period_end, strategy_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(clientId, periodStart, periodEnd, redactSecrets(strategyJson), status, now, now).run();
}

// Most recent autonomous research note (raw research_json) for a client, or null.
// Read by weekly generation so the client-research agent's output actually feeds
// content creation instead of sitting unused in the table.
export async function getLatestClientResearch(db: D1Database, clientId: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT research_json FROM client_research_notes WHERE client_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(clientId).first<{ research_json: string }>();
  return row?.research_json ?? null;
}

// Most recent autonomous strategy plan (raw strategy_json) for a client, or null.
export async function getLatestClientStrategy(db: D1Database, clientId: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT strategy_json FROM client_strategy_plans WHERE client_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(clientId).first<{ strategy_json: string }>();
  return row?.strategy_json ?? null;
}

export async function saveContentReview(
  db: D1Database,
  data: { post_id?: string | null; blog_id?: string | null; agent_task_id?: string | null; severity: string; notes_json: string },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO content_review_notes (post_id, blog_id, agent_task_id, severity, notes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(data.post_id ?? null, data.blog_id ?? null, data.agent_task_id ?? null, data.severity, redactSecrets(data.notes_json), now).run();
}

export async function getAgencyClientCoverage(db: D1Database): Promise<AgencyClientCoverageRow[]> {
  const rows = await db.prepare(
    `SELECT
       c.id AS client_id,
       c.slug AS client_slug,
       c.canonical_name AS client_name,
       c.package AS package,
       pkg.weekly_schedule AS weekly_schedule,
       (SELECT MAX(r.freshness_date) FROM client_research_notes r WHERE r.client_id = c.id) AS last_research_date,
       COALESCE((SELECT s.status FROM client_strategy_plans s WHERE s.client_id = c.id ORDER BY s.created_at DESC LIMIT 1), 'none') AS current_strategy_status,
       (SELECT COUNT(*) FROM client_monthly_topics mt WHERE mt.client_id = c.id AND COALESCE(mt.content_type_preference, '') != 'blog') AS posts_planned,
       (SELECT COUNT(*) FROM posts p WHERE p.client_id = c.id AND p.content_type != 'blog' AND p.scheduled_by_automation = 1) AS posts_generated,
       (SELECT COUNT(*) FROM posts p WHERE p.client_id = c.id AND p.status = 'pending_approval') AS posts_waiting_approval,
       (SELECT COUNT(*) FROM posts p WHERE p.client_id = c.id AND p.status IN ('approved', 'ready') AND COALESCE(p.asset_delivered, 0) = 0 AND p.content_type != 'blog') AS posts_waiting_designer,
       (SELECT COUNT(*) FROM client_monthly_topics mt WHERE mt.client_id = c.id AND mt.content_type_preference = 'blog') AS blogs_planned,
       (SELECT COUNT(*) FROM posts p WHERE p.client_id = c.id AND p.content_type = 'blog' AND p.status IN ('draft', 'pending_approval')) AS blogs_drafted
     FROM clients c
     LEFT JOIN packages pkg ON pkg.slug = c.package
     WHERE c.status = 'active'
     ORDER BY c.canonical_name ASC`,
  ).all<AgencyClientCoverageRow & { last_research_date: string | null }>();

  return rows.results.map((row) => {
    const researchFreshness = row.last_research_date
      ? 'recorded'
      : 'not started';
    const nextAction = !row.last_research_date
      ? 'Run client research'
      : row.current_strategy_status === 'none'
        ? 'Create strategy'
        : row.posts_waiting_approval > 0
          ? 'Marvin approval'
          : row.posts_waiting_designer > 0
            ? 'Designer asset'
            : 'Monitor';
    return {
      ...row,
      posts_planned: row.posts_planned ?? 0,
      posts_generated: row.posts_generated ?? 0,
      posts_waiting_approval: row.posts_waiting_approval ?? 0,
      posts_waiting_designer: row.posts_waiting_designer ?? 0,
      blogs_planned: row.blogs_planned ?? 0,
      blogs_drafted: row.blogs_drafted ?? 0,
      research_freshness: researchFreshness,
      weekly_schedule: row.weekly_schedule ?? null,
      next_agent_action: nextAction,
      risk_issues: null,
    };
  });
}

/**
 * Compact per-client content brief for agency agents (social-copy, blog-writer).
 * Reuses the same client_intelligence / services / areas / restrictions the
 * weekly generation path uses so agency drafts carry the client's brand voice
 * instead of generic copy. Returns a plain-text block plus a `hasBrief` flag so
 * callers can decide whether enough context exists to generate quality content.
 */
export async function getAgencyClientContentBrief(
  db: D1Database,
  clientId: string,
): Promise<{ brief: string; hasBrief: boolean; gbp_locations: Array<{ label: string; caption_field: string | null; upload_post_profile: string | null; location_id: string; paused: number }> }> {
  const [client, intel, areas, services, restrictions, keywords, gbpRows] = await Promise.all([
    db.prepare('SELECT canonical_name, industry, state, cta_text, notes FROM clients WHERE id = ?')
      .bind(clientId).first<{ canonical_name: string | null; industry: string | null; state: string | null; cta_text: string | null; notes: string | null }>(),
    db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?')
      .bind(clientId).first<Record<string, string | null>>(),
    db.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 8')
      .bind(clientId).all<{ city: string }>(),
    db.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 12')
      .bind(clientId).all<{ name: string }>(),
    getClientRestrictions(db, clientId),
    getClientKeywords(db, clientId),
    getClientGbpLocations(db, clientId),
  ]);
  const gbp_locations = gbpRows.map((g) => ({
    label: g.label,
    caption_field: g.caption_field,
    upload_post_profile: g.upload_post_profile,
    location_id: g.location_id,
    paused: g.paused,
  }));

  const serviceAreas = areas.results.map((r) => r.city).filter(Boolean);
  const serviceNames = services.results.map((r) => r.name).filter(Boolean);
  const i = intel ?? {};
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value && String(value).trim()) lines.push(`- ${label}: ${String(value).trim()}`);
  };
  add('Business', client?.canonical_name);
  add('Industry', client?.industry);
  add('Location', client?.state);
  if (serviceAreas.length) lines.push(`- Service areas: ${serviceAreas.join(', ')}`);
  if (serviceNames.length) lines.push(`- Specific services: ${serviceNames.join(', ')}`);
  add('Key services', i.service_priorities);
  add('Brand voice', i.brand_voice);
  add('Tone', i.tone_keywords);
  add('Audience', i.audience_notes);
  add('Content goals', i.content_goals);
  add('Preferred angles', i.content_angles);
  add('Preferred CTA', client?.cta_text);
  add('Approved CTAs', i.approved_ctas);
  add('Seasonal notes', i.seasonal_notes);
  add('Humanization style', i.humanization_style);
  add('Additional context', client?.notes);
  add('Primary keyword', i.primary_keyword);
  add('Secondary keywords', i.secondary_keywords);
  add('Local SEO themes', i.local_seo_themes);
  const forbidden = [i.prohibited_terms, restrictions.join(', ')].filter((v) => v && String(v).trim()).join(', ');
  if (forbidden) lines.push(`- NEVER USE: ${forbidden}`);

  // Shared target keyword set (§3) — feeds research/strategy/social/blog/GMB from
  // one source so messaging stays consistent and on-target for local ranking.
  if (keywords.length) {
    const byType = (t: string) => keywords.filter((k) => k.kw_type === t).map((k) => k.keyword);
    const kwLines: string[] = [];
    const primary = byType('primary');
    const local = [...byType('local'), ...byType('near_me')];
    const longTail = byType('long_tail');
    if (primary.length) kwLines.push(`  primary: ${primary.join(', ')}`);
    if (local.length) kwLines.push(`  local/near-me: ${local.join(', ')}`);
    if (longTail.length) kwLines.push(`  long-tail: ${longTail.slice(0, 12).join(', ')}`);
    if (kwLines.length) lines.push(`- TARGET KEYWORDS (use naturally, no stuffing; include correct local/service-area terms):\n${kwLines.join('\n')}`);
  }

  // A brief is "real" when it carries brand voice, services, or service areas —
  // not just the business name. Without that, drafts would be generic/empty.
  const hasBrief = Boolean(
    (i.brand_voice && i.brand_voice.trim()) ||
    (i.service_priorities && i.service_priorities.trim()) ||
    serviceNames.length ||
    serviceAreas.length,
  );
  return { brief: lines.join('\n'), hasBrief, gbp_locations };
}

export async function appendAgencyLog(
  db: D1Database,
  data: { agent_slug?: string | null; task_id?: string | null; run_id?: string | null; job_id?: string | null; status?: string; step?: string | null; summary: string; error?: string | null; backend?: string | null; duration_ms?: number | null },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO agency_logs (agent_slug, task_id, run_id, job_id, status, step, summary, error, backend, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    data.agent_slug ?? null,
    data.task_id ?? null,
    data.run_id ?? null,
    data.job_id ?? null,
    data.status ?? 'info',
    data.step ?? null,
    redactSecrets(data.summary).slice(0, 2000),
    data.error ? redactSecrets(data.error).slice(0, 4000) : null,
    data.backend ?? null,
    data.duration_ms ?? null,
    now,
  ).run();
}

export async function getAgencyLogs(db: D1Database, limit = 80): Promise<AgencyLogRow[]> {
  const rows = await db.prepare(
    `SELECT l.*, d.name AS agent_name
     FROM agency_logs l
     LEFT JOIN agent_definitions d ON d.slug = l.agent_slug
     ORDER BY l.created_at DESC
     LIMIT ?`,
  ).bind(limit).all<AgencyLogRow>();
  return rows.results.map((log) => ({
    ...log,
    summary: redactSecrets(log.summary),
    error: log.error ? redactSecrets(log.error) : null,
  }));
}

export interface AgentAuditMarkerRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  new_value: string | null;
  created_at: number;
}

export async function getLatestAuditMarker(
  db: D1Database,
  action: string,
  entityType: string,
  entityId: string,
): Promise<AgentAuditMarkerRow | null> {
  const row = await db.prepare(
    `SELECT id, action, entity_type, entity_id, new_value, created_at
     FROM audit_logs
     WHERE action = ? AND entity_type = ? AND entity_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).bind(action, entityType, entityId).first<AgentAuditMarkerRow>();
  return row ?? null;
}

export interface AgentSystemHealthSnapshot {
  active_clients: number;
  running_generation_runs: number;
  recent_generation_failures: Array<{
    id: string;
    status: string;
    triggered_by: string | null;
    last_activity_at: number | null;
    error_log: string | null;
  }>;
  approved_jobs: {
    queued: number;
    running: number;
    failed_recent: number;
  };
  auth_failures_recent: Array<{
    email: string;
    ip: string | null;
    fail_reason: string | null;
    attempts: number;
    last_seen: number;
  }>;
  stale_users: Array<{
    id: string;
    email: string;
    role: string;
    last_login: number | null;
  }>;
}

export async function getAgentSystemHealthSnapshot(
  db: D1Database,
  options: { lookbackHours?: number; staleUserDays?: number } = {},
): Promise<AgentSystemHealthSnapshot> {
  const lookbackHours = Math.max(1, options.lookbackHours ?? 168);
  const staleUserDays = Math.max(1, options.staleUserDays ?? 30);
  const now = Math.floor(Date.now() / 1000);
  const recentCutoff = now - (lookbackHours * 60 * 60);
  const staleUserCutoff = now - (staleUserDays * 24 * 60 * 60);

  const [
    activeClientsRow,
    runningRunsRow,
    recentFailures,
    queuedJobsRow,
    runningJobsRow,
    failedJobsRow,
    authFailures,
    staleUsers,
  ] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM clients WHERE status = 'active'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM generation_runs WHERE status = 'running'").first<{ n: number }>(),
    db.prepare(
      `SELECT id, status, triggered_by, last_activity_at, error_log
       FROM generation_runs
       WHERE created_at >= ?
         AND status IN ('failed', 'timed_out', 'completed_with_errors')
       ORDER BY COALESCE(last_activity_at, created_at) DESC
       LIMIT 12`,
    ).bind(recentCutoff).all<{
      id: string;
      status: string;
      triggered_by: string | null;
      last_activity_at: number | null;
      error_log: string | null;
    }>(),
    db.prepare("SELECT COUNT(*) AS n FROM approved_command_jobs WHERE status = 'queued'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM approved_command_jobs WHERE status IN ('claimed', 'running')").first<{ n: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n
       FROM approved_command_jobs
       WHERE status = 'failed' AND updated_at >= ?`,
    ).bind(recentCutoff).first<{ n: number }>(),
    db.prepare(
      `SELECT email, ip, fail_reason, COUNT(*) AS attempts, MAX(created_at) AS last_seen
       FROM login_audit
       WHERE success = 0 AND created_at >= ?
       GROUP BY email, ip, fail_reason
       ORDER BY attempts DESC, last_seen DESC
       LIMIT 12`,
    ).bind(recentCutoff).all<{
      email: string;
      ip: string | null;
      fail_reason: string | null;
      attempts: number;
      last_seen: number;
    }>(),
    db.prepare(
      `SELECT id, email, role, last_login
       FROM users
       WHERE is_active = 1
         AND (last_login IS NULL OR last_login < ?)
       ORDER BY COALESCE(last_login, 0) ASC
       LIMIT 12`,
    ).bind(staleUserCutoff).all<{
      id: string;
      email: string;
      role: string;
      last_login: number | null;
    }>(),
  ]);

  return {
    active_clients: activeClientsRow?.n ?? 0,
    running_generation_runs: runningRunsRow?.n ?? 0,
    recent_generation_failures: recentFailures.results,
    approved_jobs: {
      queued: queuedJobsRow?.n ?? 0,
      running: runningJobsRow?.n ?? 0,
      failed_recent: failedJobsRow?.n ?? 0,
    },
    auth_failures_recent: authFailures.results,
    stale_users: staleUsers.results,
  };
}

export interface AgentClientReportSummary {
  total_posts: number;
  posted_posts: number;
  failed_posts: number;
  scheduled_posts: number;
}

export async function getAgentClientReportSummary(
  db: D1Database,
  clientId: string,
  from: string,
  to: string,
): Promise<AgentClientReportSummary> {
  const row = await db.prepare(
    `SELECT
       COUNT(*) AS total_posts,
       SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS posted_posts,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_posts,
       SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_posts
     FROM posts
     WHERE client_id = ?
       AND substr(publish_date, 1, 10) >= ?
       AND substr(publish_date, 1, 10) <= ?`,
  ).bind(clientId, from, to).first<AgentClientReportSummary>();

  return {
    total_posts: row?.total_posts ?? 0,
    posted_posts: row?.posted_posts ?? 0,
    failed_posts: row?.failed_posts ?? 0,
    scheduled_posts: row?.scheduled_posts ?? 0,
  };
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

export function normalizeTopicFingerprint(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !new Set(['a', 'an', 'and', 'for', 'how', 'in', 'is', 'of', 'or', 'the', 'to', 'with']).has(token))
    .join(' ')
    .trim();
}

export function buildTopicFingerprint(parts: {
  topic?: string | null;
  title?: string | null;
  serviceCategory?: string | null;
  contentType?: string | null;
  targetKeyword?: string | null;
}): string {
  return [
    normalizeTopicFingerprint(parts.topic ?? parts.title),
    normalizeTopicFingerprint(parts.serviceCategory),
    normalizeTopicFingerprint(parts.contentType),
    normalizeTopicFingerprint(parts.targetKeyword),
  ].filter(Boolean).join(' | ');
}

function topicSimilarity(left: string | null | undefined, right: string | null | undefined): number {
  const a = normalizeTopicFingerprint(left).split(/\s+/).filter(Boolean);
  const b = normalizeTopicFingerprint(right).split(/\s+/).filter(Boolean);
  if (a.length === 0 || b.length === 0) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap++;
  }
  return overlap / Math.max(aSet.size, bSet.size, 1);
}

export interface TopicConflictMatch {
  post: PostRow;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT MONTHLY TOPICS — migration 0030
// ─────────────────────────────────────────────────────────────────────────────

export async function listClientMonthlyTopics(
  db: D1Database,
  clientId: string,
  planMonth: string,
  status: 'planned' | 'approved' | 'used' | 'skipped' | 'all' = 'all',
): Promise<ClientMonthlyTopicRow[]> {
  const conds = ['client_id = ?', 'plan_month = ?'];
  const binds: unknown[] = [clientId, planMonth];
  if (status !== 'all') {
    conds.push('status = ?');
    binds.push(status);
  }
  const rows = await db
    .prepare(
      `SELECT * FROM client_monthly_topics
       WHERE ${conds.join(' AND ')}
       ORDER BY priority DESC, created_at ASC`,
    )
    .bind(...binds)
    .all<ClientMonthlyTopicRow>();
  return rows.results;
}

export async function getClientMonthlyContentPlan(
  db: D1Database,
  clientId: string,
  planMonth: string,
): Promise<ClientMonthlyContentPlanRow | null> {
  return await db
    .prepare(`SELECT * FROM client_monthly_content_plans
              WHERE client_id = ? AND plan_month = ?
              LIMIT 1`)
    .bind(clientId, planMonth)
    .first<ClientMonthlyContentPlanRow>();
}

export async function upsertClientMonthlyContentPlan(
  db: D1Database,
  data: Omit<ClientMonthlyContentPlanRow, 'id' | 'created_at' | 'updated_at'>,
): Promise<ClientMonthlyContentPlanRow> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await getClientMonthlyContentPlan(db, data.client_id, data.plan_month);
  if (!existing) {
    const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
    await db
      .prepare(
        `INSERT INTO client_monthly_content_plans
          (id, client_id, plan_month, monthly_focus, promotion_notes, priority_services, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        data.client_id,
        data.plan_month,
        data.monthly_focus ?? null,
        data.promotion_notes ?? null,
        data.priority_services ?? null,
        data.notes ?? null,
        data.created_by ?? null,
        now,
        now,
      )
      .run();
    return (await db.prepare('SELECT * FROM client_monthly_content_plans WHERE id = ?').bind(id).first<ClientMonthlyContentPlanRow>())!;
  }

  await db
    .prepare(`UPDATE client_monthly_content_plans
              SET monthly_focus = ?, promotion_notes = ?, priority_services = ?, notes = ?, created_by = COALESCE(created_by, ?), updated_at = ?
              WHERE id = ?`)
    .bind(
      data.monthly_focus ?? null,
      data.promotion_notes ?? null,
      data.priority_services ?? null,
      data.notes ?? null,
      data.created_by ?? null,
      now,
      existing.id,
    )
    .run();
  return (await db.prepare('SELECT * FROM client_monthly_content_plans WHERE id = ?').bind(existing.id).first<ClientMonthlyContentPlanRow>())!;
}

export async function createClientMonthlyTopic(
  db: D1Database,
  data: Omit<ClientMonthlyTopicRow, 'created_at' | 'updated_at' | 'used_at'>,
): Promise<ClientMonthlyTopicRow> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO client_monthly_topics
        (id, client_id, plan_id, plan_month, topic_title, service_category, target_keyword,
         content_type_preference, preferred_platforms, priority, status, notes,
         generated_post_id, used_post_id, created_by, created_at, updated_at, used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      data.id,
      data.client_id,
      data.plan_id ?? null,
      data.plan_month,
      data.topic_title,
      data.service_category ?? null,
      data.target_keyword ?? null,
      data.content_type_preference ?? null,
      data.preferred_platforms ?? null,
      data.priority ?? 0,
      data.status ?? 'planned',
      data.notes ?? null,
      data.generated_post_id ?? null,
      data.used_post_id ?? null,
      data.created_by ?? null,
      now,
      now,
    )
    .run();
  return (await db.prepare('SELECT * FROM client_monthly_topics WHERE id = ?').bind(data.id).first<ClientMonthlyTopicRow>())!;
}

export async function updateClientMonthlyTopic(
  db: D1Database,
  id: string,
  data: Partial<ClientMonthlyTopicRow>,
): Promise<void> {
  const sets = Object.keys(data)
    .filter((key) => !['id', 'client_id', 'created_at'].includes(key))
    .map((key) => `${key} = ?`);
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  const now = Math.floor(Date.now() / 1000);
  const values = [
    ...Object.entries(data)
      .filter(([key]) => !['id', 'client_id', 'created_at'].includes(key))
      .map(([, value]) => value),
    now,
    id,
  ];
  await db.prepare(`UPDATE client_monthly_topics SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteClientMonthlyTopic(db: D1Database, id: string, clientId: string): Promise<void> {
  await db.prepare('DELETE FROM client_monthly_topics WHERE id = ? AND client_id = ?').bind(id, clientId).run();
}

export async function markClientMonthlyTopicUsed(
  db: D1Database,
  topicId: string,
  postId: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE client_monthly_topics SET status = 'used', generated_post_id = ?, used_post_id = ?, used_at = ?, skip_reason = NULL, updated_at = ? WHERE id = ?")
    .bind(postId, postId, now, now, topicId)
    .run();
}

export async function markClientMonthlyTopicSkipped(
  db: D1Database,
  topicId: string,
  reason: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE client_monthly_topics SET status = 'skipped', skip_reason = ?, updated_at = ? WHERE id = ?")
    .bind(reason.slice(0, 500), now, topicId)
    .run();
}

export async function getNextClientMonthlyTopic(
  db: D1Database,
  clientId: string,
  planMonth: string,
  contentType: string | null = null,
  platforms: string[] = [],
  statuses: Array<'approved' | 'planned'> = ['approved'],
): Promise<ClientMonthlyTopicRow | null> {
  const requestedPlatforms = new Set(platforms);
  for (const status of statuses) {
    const topics = await listClientMonthlyTopics(db, clientId, planMonth, status);
    const matching = topics.filter((topic) => {
      if (topic.content_type_preference && contentType && topic.content_type_preference !== contentType) {
        return false;
      }
      if (!topic.preferred_platforms || requestedPlatforms.size === 0) {
        return true;
      }
      try {
        const preferred = JSON.parse(topic.preferred_platforms) as string[];
        return preferred.some((platform) => requestedPlatforms.has(platform));
      } catch {
        return true;
      }
    });
    if (matching[0]) return matching[0];
  }
  return null;
}

export async function hasAnyApprovedMonthlyTopics(
  db: D1Database,
  clientId: string,
  planMonth: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n
              FROM client_monthly_topics
              WHERE client_id = ? AND plan_month = ? AND status = 'approved'`)
    .bind(clientId, planMonth)
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

export async function findRecentTopicConflict(
  db: D1Database,
  params: {
    clientId: string;
    candidateTitle?: string | null;
    candidateKeyword?: string | null;
    candidateCaption?: string | null;
    candidateServiceCategory?: string | null;
    contentType?: string | null;
    topicFingerprint?: string | null;
    publishDate?: string | null;
    excludePostId?: string | null;
  },
): Promise<TopicConflictMatch | null> {
  const baseDate = (params.publishDate ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const rows = await db
    .prepare(
      `SELECT * FROM posts
       WHERE client_id = ?
         AND status NOT IN ('cancelled')
         AND substr(COALESCE(publish_date, ''), 1, 10) >= date(?, '-90 day')
       ORDER BY updated_at DESC
       LIMIT 120`,
    )
    .bind(params.clientId, baseDate)
    .all<PostRow>();

  const candidateTitle = params.candidateTitle ?? '';
  const candidateKeyword = params.candidateKeyword ?? '';
  const candidateCaption = params.candidateCaption ?? '';
  const candidateServiceCategory = params.candidateServiceCategory ?? '';
  const candidateFingerprint = params.topicFingerprint
    ? normalizeTopicFingerprint(params.topicFingerprint)
    : buildTopicFingerprint({
      title: candidateTitle,
      serviceCategory: candidateServiceCategory,
      contentType: params.contentType,
      targetKeyword: candidateKeyword,
    });

  for (const row of rows.results) {
    if (params.excludePostId && row.id === params.excludePostId) continue;

    const rowFingerprint = normalizeTopicFingerprint(
      row.topic_fingerprint || buildTopicFingerprint({
        title: row.title,
        serviceCategory: row.topic_service_category,
        contentType: row.content_type,
        targetKeyword: row.target_keyword,
      }),
    );
    if (candidateFingerprint && rowFingerprint && candidateFingerprint === rowFingerprint) {
      return { post: row, reason: 'topic fingerprint matched recent post' };
    }

    if (candidateKeyword && row.target_keyword && normalizeTopicFingerprint(candidateKeyword) === normalizeTopicFingerprint(row.target_keyword)) {
      return { post: row, reason: 'target keyword matched recent post' };
    }

    if (candidateTitle && row.title && topicSimilarity(candidateTitle, row.title) >= 0.74) {
      return { post: row, reason: 'title/topic matched recent post' };
    }

    if (candidateCaption && row.master_caption && topicSimilarity(candidateCaption, row.master_caption) >= 0.82) {
      return { post: row, reason: 'caption pattern matched recent post' };
    }

    if (
      candidateServiceCategory &&
      row.topic_service_category &&
      normalizeTopicFingerprint(candidateServiceCategory) === normalizeTopicFingerprint(row.topic_service_category) &&
      candidateTitle &&
      row.title &&
      topicSimilarity(candidateTitle, row.title) >= 0.55
    ) {
      return { post: row, reason: 'service angle matched recent post' };
    }
  }
  return null;
}

export async function findSimilarRecentPost(
  db: D1Database,
  clientId: string,
  contentType: string,
  candidateTopic: string,
  publishDate: string | null,
  excludePostId: string | null = null,
): Promise<PostRow | null> {
  const conflict = await findRecentTopicConflict(db, {
    clientId,
    candidateTitle: candidateTopic,
    contentType,
    publishDate,
    excludePostId,
  });
  return conflict?.post ?? null;
}
