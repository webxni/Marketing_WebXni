/**
 * Run routes — trigger posting runs, generation, fetch URLs, view jobs
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { createPostingJob, listPostingJobs, getPostingJobById } from '../db/queries';
import { runPosting } from '../loader/posting-run';

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
  // Fetch URLs not yet implemented — log and return
  console.log('Fetch URLs run requested', { jobId });
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
