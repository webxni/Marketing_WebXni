/**
 * Run routes — trigger posting runs, generation, fetch URLs, view jobs
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import {
  createPostingJob, listPostingJobs, getPostingJobById,
  createGenerationRun, listGenerationRuns, getGenerationRunById,
  healStuckGenerationRuns,
} from '../db/queries';
import { runPosting } from '../loader/posting-run';
import { planGeneration } from '../loader/generation-run';
import { UploadPostClient } from '../services/uploadpost';

/**
 * Fetch published URLs from Upload-Post history.
 *
 * Pass 1 — URL matching:
 *   Queries all post_platforms with status='sent', looks up their tracking IDs
 *   in Upload-Post history, writes real_url back and promotes platform status to 'posted'.
 *
 * Pass 2 — Fallback promotion:
 *   Any post whose publish_date has already passed and whose platforms are all in a
 *   terminal state (sent/posted/idempotent/skipped/blocked/failed) gets promoted to
 *   'posted'. Handles the case where URL matching fails (history ID mismatch, aged out).
 */
export async function runFetchUrls(env: Env, jobId: string): Promise<void> {
  console.log('[fetch-urls] starting job', jobId);
  const up = new UploadPostClient((env as unknown as { UPLOAD_POST_API_KEY: string }).UPLOAD_POST_API_KEY);
  const db = (env as unknown as { DB: D1Database }).DB;

  try {
    // ── Pass 1: URL matching ──────────────────────────────────────────────────
    const { history } = await up.getHistory(200);

    // Build lookup: job_id or request_id → real post URL
    const urlMap = new Map<string, string>();
    for (const entry of history) {
      // Try all known field name variants for the job identifier
      const jid = (
        entry['job_id'] ??
        entry['request_id'] ??
        entry['id']
      ) as string | undefined;
      // Try all known field name variants for the published URL
      const url = (
        entry['post_url'] ??
        entry['url'] ??
        entry['link'] ??
        entry['post_link']
      ) as string | undefined;
      if (jid && url) urlMap.set(String(jid), url);
    }

    // Find all sent post_platforms that have a tracking_id
    const sentRows = await db
      .prepare(`SELECT pp.id, pp.post_id, pp.platform, pp.tracking_id
                FROM post_platforms pp
                WHERE pp.status = 'sent' AND pp.tracking_id IS NOT NULL`)
      .all<{ id: string; post_id: string; platform: string; tracking_id: string }>();

    let urlsMatched = 0;
    const promotionCandidates = new Set<string>(); // post_ids to check for full promotion

    for (const row of sentRows.results) {
      const rawId = row.tracking_id.replace(/^UP:(IDEM:)?/, '');
      const realUrl = urlMap.get(rawId);
      if (realUrl) {
        await db
          .prepare("UPDATE post_platforms SET real_url = ?, status = 'posted' WHERE id = ?")
          .bind(realUrl, row.id)
          .run();
        urlsMatched++;
      }
      promotionCandidates.add(row.post_id);
    }

    // Also include idempotent rows' posts as candidates
    const idemRows = await db
      .prepare(`SELECT DISTINCT post_id FROM post_platforms WHERE status = 'idempotent'`)
      .all<{ post_id: string }>();
    for (const r of idemRows.results) promotionCandidates.add(r.post_id);

    // Promote any post where no pending-state platforms remain
    // Terminal states for this check: posted, sent (URL may not have been found yet),
    // idempotent, skipped, blocked, failed — none of these need further action.
    let promoted = 0;
    for (const postId of promotionCandidates) {
      const remaining = await db
        .prepare(`SELECT COUNT(*) as n FROM post_platforms
                  WHERE post_id = ? AND status NOT IN ('posted','sent','idempotent','skipped','blocked','failed')`)
        .bind(postId)
        .first<{ n: number }>();
      const hasSuccess = await db
        .prepare(`SELECT COUNT(*) as n FROM post_platforms
                  WHERE post_id = ? AND status IN ('posted','sent','idempotent')`)
        .bind(postId)
        .first<{ n: number }>();

      if ((remaining?.n ?? 1) === 0 && (hasSuccess?.n ?? 0) > 0) {
        const now = Math.floor(Date.now() / 1000);
        await db
          .prepare(`UPDATE posts SET status = 'posted', automation_status = 'Posted',
                    posted_at = COALESCE(posted_at, ?), updated_at = ? WHERE id = ? AND status = 'scheduled'`)
          .bind(now, now, postId)
          .run();
        promoted++;
      }
    }

    // ── Pass 2: Fallback — stale scheduled posts ──────────────────────────────
    // Posts that have been 'scheduled' with publish_date in the past and have at least
    // one sent/idempotent platform but no active (non-terminal) rows. Catches cases
    // where tracking_id lookup failed or entry aged out of Upload-Post history.
    const nowExpr = `strftime('%Y-%m-%dT%H:%M','now','-6 hours')`; // NIC time
    const staleSent = await db
      .prepare(`SELECT DISTINCT pp.post_id
                FROM post_platforms pp
                JOIN posts p ON p.id = pp.post_id
                WHERE p.status = 'scheduled'
                  AND p.publish_date IS NOT NULL
                  AND substr(p.publish_date,1,16) < ${nowExpr}
                  AND pp.status IN ('sent','idempotent')`)
      .all<{ post_id: string }>();

    let fallbackPromoted = 0;
    for (const { post_id } of staleSent.results) {
      if (promotionCandidates.has(post_id)) continue; // already handled above
      const stillActive = await db
        .prepare(`SELECT COUNT(*) as n FROM post_platforms
                  WHERE post_id = ? AND status NOT IN ('posted','sent','idempotent','skipped','blocked','failed')`)
        .bind(post_id)
        .first<{ n: number }>();
      if ((stillActive?.n ?? 1) === 0) {
        const now = Math.floor(Date.now() / 1000);
        await db
          .prepare(`UPDATE posts SET status = 'posted', automation_status = 'Posted',
                    posted_at = COALESCE(posted_at, ?), updated_at = ? WHERE id = ?`)
          .bind(now, now, post_id)
          .run();
        fallbackPromoted++;
      }
    }

    console.log(
      `[fetch-urls] done — URLs matched: ${urlsMatched}, ` +
      `posts promoted: ${promoted}, fallback promoted: ${fallbackPromoted}`,
    );
  } catch (err) {
    console.error('[fetch-urls] error:', err);
  }
}

export const runRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

const postingRunSchema = z.object({
  dry_run: z.boolean().optional().default(false),
  client: z.string().optional(),
  platform: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

/** POST /api/run/posting — trigger a posting run (dry_run or real) */
runRoutes.post('/posting', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const parsed = postingRunSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  }

  const { dry_run, client, platform, limit } = parsed.data;
  const mode = dry_run ? 'dry_run' : 'real';

  // Create job record first
  const job = await createPostingJob(c.env.DB, {
    triggered_by: 'api',
    mode,
    client_filter: client,
    platform_filter: platform,
    limit_count: limit,
  });

  // Run posting in background
  c.executionCtx.waitUntil(
    runPosting(c.env, {
      mode,
      job_id:          job.id,
      client_filter:   client,
      platform_filter: platform,
      limit,
      triggered_by:    'api',
    }),
  );

  return c.json({ ok: true, job_id: job.id, mode }, 202);
});

/** POST /api/run/generate — trigger AI content generation */
runRoutes.post('/generate', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { /* use empty */ }

  // Resolve client slugs
  const clientSlugs: string[] = Array.isArray(body.client_slugs)
    ? (body.client_slugs as string[])
    : typeof body.client_filter === 'string' && body.client_filter !== 'all'
      ? [body.client_filter]
      : [];

  // Build dates array from date_from/date_to or explicit dates array
  let dates: string[] = [];
  if (Array.isArray(body.dates) && (body.dates as string[]).length > 0) {
    dates = body.dates as string[];
  } else {
    const from = typeof body.date_from === 'string' ? body.date_from : null;
    const to   = typeof body.date_to   === 'string' ? body.date_to   : from;
    if (!from) return c.json({ error: 'date_from is required' }, 400);
    const d   = new Date(from);
    const end = new Date(to!);
    while (d <= end) {
      dates.push(d.toISOString().split('T')[0]);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }

  if (dates.length === 0) return c.json({ error: 'No dates specified' }, 400);
  if (dates.length > 60)  return c.json({ error: 'Max 60 dates per run' }, 400);

  const periodStart = dates[0];
  const periodEnd   = dates[dates.length - 1];

  const run = await createGenerationRun(c.env.DB, {
    triggered_by:  c.get('user').userId,
    date_range:    `${periodStart}:${periodEnd}`,
    client_filter: clientSlugs.length > 0 ? JSON.stringify(clientSlugs) : null,
  });

  // Optional publish time override (HH:MM) — applied to all generated posts
  const publishTime = typeof body.publish_time === 'string' && /^\d{2}:\d{2}$/.test(body.publish_time)
    ? body.publish_time
    : null;

  const baseUrl = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    planGeneration(c.env, {
      run_id:       run.id,
      client_slugs: clientSlugs,
      period_start: periodStart,
      period_end:   periodEnd,
      triggered_by: c.get('user').userId,
      publish_time: publishTime,
    }, baseUrl),
  );

  return c.json({ ok: true, job_id: run.id }, 202);
});

/** GET /api/run/generate/runs — list recent generation runs */
runRoutes.get('/generate/runs', async (c) => {
  // Auto-heal any runs stuck > 10 minutes with no activity before returning
  try { await healStuckGenerationRuns(c.env.DB, 600); } catch { /* non-fatal */ }
  const runs = await listGenerationRuns(c.env.DB, 30);
  return c.json({ runs });
});

/** PATCH /api/run/generate/runs/:id/cancel — cancel or force-fail a stuck run */
runRoutes.patch('/generate/runs/:id/cancel', async (c) => {
  const run = await getGenerationRunById(c.env.DB, c.req.param('id'));
  if (!run) return c.json({ error: 'Not found' }, 404);
  if (run.status !== 'running' && run.status !== 'timed_out') {
    return c.json({ error: `Run is already ${run.status} — cannot cancel` }, 409);
  }
  const now = Math.floor(Date.now() / 1000);
  const user = c.get('user');
  await c.env.DB
    .prepare(`UPDATE generation_runs
              SET status = 'cancelled', completed_at = ?, last_activity_at = ?,
                  error_log = COALESCE(error_log || char(10), '') || ?,
                  execution_log = COALESCE(execution_log || char(10), '') || ?
              WHERE id = ?`)
    .bind(
      now, now,
      `Manually cancelled by ${user.email}`,
      `${new Date(now * 1000).toISOString().slice(0, 19)}Z [WARN] Manually cancelled by ${user.email}`,
      run.id,
    )
    .run();
  return c.json({ ok: true });
});

/** GET /api/run/generate/runs/:id — single generation run */
runRoutes.get('/generate/runs/:id', async (c) => {
  try { await healStuckGenerationRuns(c.env.DB, 600); } catch { /* non-fatal */ }
  const run = await getGenerationRunById(c.env.DB, c.req.param('id'));
  if (!run) return c.json({ error: 'Not found' }, 404);
  return c.json({ run });
});

/** POST /api/run/fetch-urls — poll Upload-Post history and write real URLs back */
runRoutes.post('/fetch-urls', async (c) => {
  const jobId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  c.executionCtx.waitUntil(runFetchUrls(c.env, jobId));
  return c.json({ ok: true, job_id: jobId }, 202);
});

/** GET /api/run/jobs — list recent posting jobs */
runRoutes.get('/jobs', async (c) => {
  const jobs = await listPostingJobs(c.env.DB, 20);
  return c.json({ jobs });
});

/** GET /api/run/jobs/:id — job status */
runRoutes.get('/jobs/:id', async (c) => {
  const job = await getPostingJobById(c.env.DB, c.req.param('id'));
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({ job });
});

/** GET /api/platform/status/:trackingId — poll Upload-Post job status */
runRoutes.get('/status/:trackingId', async (c) => {
  const trackingId = c.req.param('trackingId').replace(/^UP:/, '');
  const { UploadPostClient } = await import('../services/uploadpost');
  const up = new UploadPostClient(c.env.UPLOAD_POST_API_KEY);
  try {
    const status = await up.getStatus({ jobId: trackingId });
    return c.json({ status });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});
