/**
 * Run routes — trigger posting runs, generation, fetch URLs, view jobs
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { createPostingJob, listPostingJobs, getPostingJobById } from '../db/queries';
import { runPosting } from '../loader/posting-run';
import { UploadPostClient } from '../services/uploadpost';

/**
 * Fetch published URLs from Upload-Post history.
 * Queries all post_platforms with status='sent', fetches their real URLs,
 * writes real_url back to post_platforms, and marks posts as 'posted'
 * when all their platforms are confirmed.
 */
export async function runFetchUrls(env: Env, jobId: string): Promise<void> {
  console.log('[fetch-urls] starting job', jobId);
  const up = new UploadPostClient((env as unknown as { UPLOAD_POST_API_KEY: string }).UPLOAD_POST_API_KEY);
  const db = (env as unknown as { DB: D1Database }).DB;

  try {
    // Fetch recent Upload-Post history (last 200 entries)
    const { history } = await up.getHistory(200);
    // Build a lookup: job_id/request_id → post URL
    const urlMap = new Map<string, string>();
    for (const entry of history) {
      const jid = (entry['job_id'] ?? entry['request_id']) as string | undefined;
      const url = (entry['post_url'] ?? entry['url'] ?? entry['link']) as string | undefined;
      if (jid && url) urlMap.set(jid, url);
    }

    // Find all sent post_platforms that have a tracking_id
    const rows = await db
      .prepare(`SELECT pp.id, pp.post_id, pp.platform, pp.tracking_id
                FROM post_platforms pp
                WHERE pp.status = 'sent' AND pp.tracking_id IS NOT NULL`)
      .all<{ id: string; post_id: string; platform: string; tracking_id: string }>();

    let updated = 0;
    for (const row of rows.results) {
      const rawId = row.tracking_id.replace(/^UP:(IDEM:)?/, '');
      const realUrl = urlMap.get(rawId);
      if (!realUrl) continue;

      await db
        .prepare("UPDATE post_platforms SET real_url = ?, status = 'posted' WHERE id = ?")
        .bind(realUrl, row.id)
        .run();
      updated++;

      // Check if ALL platforms for this post are now confirmed (posted or skipped/idempotent)
      const remaining = await db
        .prepare(`SELECT COUNT(*) as n FROM post_platforms
                  WHERE post_id = ? AND status NOT IN ('posted','skipped','blocked','idempotent')`)
        .bind(row.post_id)
        .first<{ n: number }>();
      if ((remaining?.n ?? 1) === 0) {
        const now = Math.floor(Date.now() / 1000);
        await db
          .prepare("UPDATE posts SET status = 'posted', automation_status = 'Posted', updated_at = ? WHERE id = ?")
          .bind(now, row.post_id)
          .run();
      }
    }

    console.log(`[fetch-urls] done — updated ${updated} platform rows`);
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

/** POST /api/run/generate — trigger content generation (Phase 1 or 2) */
runRoutes.post('/generate', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { /* use empty */ }

  const jobId = crypto.randomUUID().replace(/-/g, '').toLowerCase();

  // Generation not yet implemented — log and return
  console.log('Generation run requested', { jobId, body });

  return c.json({ ok: true, job_id: jobId }, 202);
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
