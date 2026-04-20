/**
 * Internal Worker-to-Worker routes — no auth middleware.
 * Only reachable via the SELF service binding (not the public internet).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { executeSlotWork, triggerStep } from '../loader/generation-run';
import { isRepairKeyValid, repairExistingBlogs } from '../loader/repair-blogs';
import { cleanupLegacyInvalidPlatformAttempts, repairOrphanScheduledPosts, syncPublishedUrls } from '../modules/published-urls';
import {
  appendGenerationError,
  appendGenerationLog,
  finalizeGenerationRun,
  getGenerationRunById,
} from '../db/queries';

export const internalRoutes = new Hono<{ Bindings: Env; Variables: Record<string, unknown> }>();

function detail(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n${err.stack}` : err.message;
  return String(err);
}

/**
 * POST /internal/gen-step   body: { run_id, slot_idx }
 *
 * Sequential slot runner:
 *   1. Execute exactly one slot in this request.
 *   2. If more work remains, queue the next self-dispatch in waitUntil.
 *   3. The queued task performs only the next-hop dispatch and logging.
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
  const baseUrl = new URL(c.req.url).origin;

  async function log(level: 'INFO' | 'AI' | 'SAVED' | 'WARN' | 'ERROR' | 'START' | 'DONE', message: string) {
    try { await appendGenerationLog(c.env.DB, runId, level, message); } catch { /* ignore */ }
  }

  async function logError(message: string) {
    try { await appendGenerationError(c.env.DB, runId, message); } catch { /* ignore */ }
  }

  try {
    const run = await c.env.DB
      .prepare('SELECT status, total_slots FROM generation_runs WHERE id = ?')
      .bind(runId)
      .first<{ status: string; total_slots: number }>();

    if (!run || run.status !== 'running') {
      console.log(`[gen-step] slot${slotIdx} skipped — status: ${run?.status ?? 'not found'}`);
      return c.json({ ok: true, skipped: true });
    }

    await log('INFO', `Route entered: /internal/gen-step slot ${slotIdx + 1}/${run.total_slots}`);

    const result = await executeSlotWork(c.env, runId, slotIdx);

    await log('INFO', `Route complete: /internal/gen-step slot ${slotIdx + 1}/${run.total_slots} outcome=${result.outcome}`);

    if (result.outcome === 'continue' && typeof result.nextSlot === 'number' && typeof result.totalSlots === 'number') {
      await log('INFO', `Next-step queued: slot ${result.nextSlot + 1}/${result.totalSlots}`);
      c.executionCtx.waitUntil((async () => {
        try {
          await log('INFO', `Next-step dispatch start: slot ${result.nextSlot! + 1}/${result.totalSlots!}`);
          await triggerStep(c.env, baseUrl, runId, result.nextSlot!);
          await log('INFO', `Next-step dispatch success: slot ${result.nextSlot! + 1}/${result.totalSlots!}`);
        } catch (err) {
          const msg = `Trigger failed for slot ${result.nextSlot! + 1}: ${err instanceof Error ? err.message : String(err)}`;
          await log('ERROR', msg);
          await logError(`Dispatch failure after slot ${slotIdx}\n${detail(err)}`);

          const latest = await getGenerationRunById(c.env.DB, runId);
          if (latest && latest.status === 'running') {
            const errorLog = latest.error_log
              ? `${latest.error_log}\n${msg}`
              : msg;
            const finalStatus = latest.posts_created > 0 ? 'completed_with_errors' : 'failed';
            await finalizeGenerationRun(c.env.DB, runId, finalStatus, latest.posts_created, errorLog);
          }
        }
      })());
    }

    return c.json({ ok: true, outcome: result.outcome, next_slot: result.nextSlot ?? null });
  } catch (err) {
    console.error(`[gen-step] slot${slotIdx} route crash:`, err);
    await log('ERROR', `Route crash: slot ${slotIdx} — ${err instanceof Error ? err.message : String(err)}`);
    await logError(`Route crash: slot ${slotIdx}\n${detail(err)}`);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

internalRoutes.post('/repair-blogs', async (c) => {
  if (!isRepairKeyValid(c.req.header('x-repair-key'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const stats = await repairExistingBlogs(c.env);
    return c.json({ ok: true, stats });
  } catch (err) {
    console.error('[repair-blogs] failed:', err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

internalRoutes.post('/repair-posting-state', async (c) => {
  if (!isRepairKeyValid(c.req.header('x-repair-key'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const [cleanup, sync, orphan] = await Promise.all([
      cleanupLegacyInvalidPlatformAttempts(c.env.DB),
      syncPublishedUrls(c.env),
      repairOrphanScheduledPosts(c.env.DB),
    ]);
    return c.json({ ok: true, cleanup, sync, orphan });
  } catch (err) {
    console.error('[repair-posting-state] failed:', err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
