/**
 * Internal Worker-to-Worker routes — no auth middleware.
 * Only reachable via self-calls from within the same Worker.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { executeGenerationStep } from '../loader/generation-run';

export const internalRoutes = new Hono<{ Bindings: Env; Variables: Record<string, unknown> }>();

/**
 * POST /internal/gen-step
 * Triggered by planGeneration() and executeGenerationStep() to chain
 * generation steps.  Each call handles exactly one post (one OpenAI request).
 */
internalRoutes.post('/gen-step', async (c) => {
  let body: { run_id?: string } = {};
  try { body = await c.req.json<{ run_id?: string }>(); } catch { /* ignore */ }
  const run_id = body?.run_id;
  if (!run_id || typeof run_id !== 'string') {
    console.error('[gen-step] missing run_id in body:', JSON.stringify(body));
    return c.json({ error: 'run_id required' }, 400);
  }

  // Derive base URL from incoming request so self-calls always hit the right origin
  const baseUrl = new URL(c.req.url).origin;
  console.log(`[gen-step] received run_id=${run_id.slice(0, 8)} baseUrl=${baseUrl}`);

  // Run in background so this request returns immediately
  c.executionCtx.waitUntil(
    executeGenerationStep(c.env, run_id, baseUrl)
      .catch(err => console.error('[gen-step] waitUntil unhandled:', err)),
  );

  return c.json({ ok: true });
});
