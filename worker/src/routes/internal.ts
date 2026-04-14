/**
 * Internal Worker-to-Worker routes — no auth middleware.
 * Only reachable via the SELF service binding (not the public internet).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { executeSlotWork } from '../loader/generation-run';
import { appendGenerationLog } from '../db/queries';

export const internalRoutes = new Hono<{ Bindings: Env; Variables: Record<string, unknown> }>();

/**
 * POST /internal/gen-step   body: { run_id, slot_idx }
 *
 * Trigger-first design:
 *   1. Handler triggers slot_idx+1 immediately (first + only connection in this
 *      handler context — always reliable, no event-loop-freeze risk).
 *   2. waitUntil runs the actual OpenAI work for slot_idx (one outbound fetch,
 *      then only D1 writes — nothing after the long connection, so freeze
 *      doesn't matter).
 *   3. Returns 200 immediately so the caller's await resolves fast.
 *
 * The trigger cascade (slot 0 handler → slot 1 handler → … → slot N handler)
 * resolves in ~N * 10 ms.  All waitUntil tasks then execute in parallel.
 */
internalRoutes.post('/gen-step', async (c) => {
  let body: { run_id?: string; slot_idx?: number } = {};
  try { body = await c.req.json<{ run_id?: string; slot_idx?: number }>(); } catch { /* ignore */ }

  const { run_id, slot_idx } = body;
  if (!run_id || typeof run_id !== 'string' || typeof slot_idx !== 'number') {
    console.error('[gen-step] invalid body:', JSON.stringify(body));
    return c.json({ error: 'run_id and slot_idx (number) required' }, 400);
  }
  const runId = run_id;
  const slotIdx = slot_idx;

  // Check run status and total_slots.
  const run = await (c.env.DB as D1Database)
    .prepare('SELECT status, total_slots FROM generation_runs WHERE id = ?')
    .bind(runId)
    .first<{ status: string; total_slots: number }>();

  if (!run || run.status !== 'running') {
    console.log(`[gen-step] slot${slotIdx} skipped — status: ${run?.status ?? 'not found'}`);
    return c.json({ ok: true, skipped: true });
  }

  const baseUrl = new URL(c.req.url).origin;

  async function log(level: 'INFO' | 'AI' | 'SAVED' | 'WARN' | 'ERROR' | 'START' | 'DONE', message: string) {
    try { await appendGenerationLog(c.env.DB, runId, level, message); } catch { /* ignore */ }
  }

  await log('INFO', `Route called: /internal/gen-step slot ${slotIdx + 1}/${run.total_slots}`);

  // Execute current slot in the background. The slot itself is responsible for
  // dispatching the next slot after it finishes.
  c.executionCtx.waitUntil(
    executeSlotWork(c.env, runId, slotIdx, baseUrl)
      .catch(err => console.error(`[gen-step] slot${slotIdx} waitUntil unhandled:`, err)),
  );

  return c.json({ ok: true });
});
