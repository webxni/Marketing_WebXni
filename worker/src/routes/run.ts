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
import { planGeneration, resumeGenerationRun } from '../loader/generation-run';
import { cleanupLegacyInvalidPlatformAttempts, repairOrphanScheduledPosts, syncPublishedUrls } from '../modules/published-urls';
import { syncPostPlatformMetrics } from '../modules/reporting-metrics';

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

  try {
    const [syncResult, cleanupResult, orphanResult, metricsResult] = await Promise.all([
      syncPublishedUrls(env),
      cleanupLegacyInvalidPlatformAttempts(env.DB),
      repairOrphanScheduledPosts(env.DB),
      syncPostPlatformMetrics(env, { limit: 150 }),
    ]);
    console.log(`[fetch-urls] done — URLs matched: ${syncResult.matched}, posts promoted: ${syncResult.posts_promoted}, legacy invalid archived: ${cleanupResult.archived}, orphan scheduled reset: ${orphanResult.reset_to_ready}, metrics synced: ${metricsResult.synced}/${metricsResult.attempted}`);
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
    overwrite_existing: body.overwrite_existing === true,
  });

  // Optional publish time override (HH:MM) — applied to all generated posts
  const publishTime = typeof body.publish_time === 'string' && /^\d{2}:\d{2}$/.test(body.publish_time)
    ? body.publish_time
    : null;

  const baseUrl = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    planGeneration(c.env, {
      run_id:             run.id,
      client_slugs:       clientSlugs,
      period_start:       periodStart,
      period_end:         periodEnd,
      triggered_by:       c.get('user').userId,
      publish_time:       publishTime,
      overwrite_existing: body.overwrite_existing === true,
      high_quality:       body.high_quality === true,
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

/** POST /api/run/generate/runs/:id/resume — resume a partial/timed_out/failed run from current_slot_idx */
runRoutes.post('/generate/runs/:id/resume', async (c) => {
  const run = await getGenerationRunById(c.env.DB, c.req.param('id'));
  if (!run) return c.json({ error: 'Not found' }, 404);

  const totalSlots = run.total_slots ?? 0;
  const currentSlot = Math.max(0, run.current_slot_idx ?? 0);
  if (!run.post_slots || totalSlots === 0) {
    return c.json({ error: 'Run has no stored slot plan to resume' }, 409);
  }
  if (currentSlot >= totalSlots) {
    return c.json({ error: 'Run is already complete' }, 409);
  }

  const baseUrl = new URL(c.req.url).origin;
  try {
    const resumed = await resumeGenerationRun(c.env, baseUrl, run.id);
    return c.json({
      ok: true,
      resumed: true,
      next_slot: resumed.nextSlot,
      total_slots: resumed.totalSlots,
    }, 202);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** POST /api/run/fetch-urls — poll Upload-Post history and write real URLs back */
runRoutes.post('/fetch-urls', async (c) => {
  const jobId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  c.executionCtx.waitUntil(runFetchUrls(c.env, jobId));
  return c.json({ ok: true, job_id: jobId }, 202);
});

/** POST /api/run/fetch-report-metrics — refresh Upload-Post analytics cache */
runRoutes.post('/fetch-report-metrics', async (c) => {
  c.executionCtx.waitUntil(syncPostPlatformMetrics(c.env, { limit: 250 }));
  return c.json({ ok: true }, 202);
});

/** GET /api/run/queue — real actionable posting queue only */
runRoutes.get('/queue', async (c) => {
  await cleanupLegacyInvalidPlatformAttempts(c.env.DB);
  const nowExpr = `strftime('%Y-%m-%dT%H:%M','now','-6 hours')`;
  const rows = await c.env.DB
    .prepare(`
      SELECT p.*,
             c.canonical_name AS client_name,
             c.slug AS client_slug,
             CASE
               WHEN substr(p.publish_date,1,16) < ${nowExpr} THEN 'overdue'
               WHEN substr(p.publish_date,1,16) <= strftime('%Y-%m-%dT%H:%M', 'now', '-6 hours', '+2 minutes') THEN 'posting'
               WHEN substr(p.publish_date,1,16) <= strftime('%Y-%m-%dT%H:%M', 'now', '-6 hours', '+60 minutes') THEN 'due_soon'
               ELSE 'queued'
             END AS queue_state
      FROM posts p
      JOIN clients c ON c.id = p.client_id
      WHERE (
        (p.content_type = 'blog' AND p.status IN ('ready','approved','scheduled'))
        OR
        (p.content_type != 'blog' AND p.status IN ('ready','approved'))
      )
        AND p.ready_for_automation = 1
        AND p.asset_delivered = 1
        AND p.publish_date IS NOT NULL
        AND (
          (p.content_type = 'blog' AND (
            p.wp_post_id IS NULL
            OR COALESCE(p.wp_post_status, '') != 'publish'
          ))
          OR
          (p.content_type != 'blog' AND NOT EXISTS (
            SELECT 1
            FROM post_platforms pp
            WHERE pp.post_id = p.id
              AND pp.status IN ('sent','idempotent','posted')
          ))
        )
      ORDER BY p.publish_date IS NULL ASC, p.publish_date ASC, p.updated_at ASC
      LIMIT 200
    `)
    .all<Record<string, unknown>>();

  return c.json({ posts: rows.results });
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
