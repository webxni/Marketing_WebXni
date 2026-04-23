/**
 * LOADER: Recurring content requests (migration 0026).
 *
 * Fires on the hourly cron alongside runRecurringGbp. For each eligible
 * `content_requests` row:
 *   1. Optionally consume one topic from `client_topics` (priority DESC, FIFO).
 *   2. Invoke createContentWithImage to produce a full post (content + image
 *      + pending_approval status + Discord notification).
 *   3. Advance next_run_date per the recurrence rule; deactivate 'once'
 *      schedules after their first successful firing.
 *
 * Gates:
 *   - active = 1 AND paused = 0
 *   - next_run_date IS NULL OR next_run_date <= today
 *   - time_of_day hour (UTC) has been reached if set
 *   - last_triggered_at != today (prevents double-firing per day)
 */

import type { Env, ContentRequestRow, ClientTopicRow } from '../types';
import { getClientBySlug, markClientTopicUsed, peekNextClientTopic } from '../db/queries';
import { createContentWithImage } from './autonomous-content';

export interface ContentRequestStats {
  requests_processed: number;
  posts_created:      number;
  skipped:            number;
  errors:             number;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonth(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(ymd: string): number {
  return new Date(ymd + 'T00:00:00Z').getUTCDay();
}

/** Compute the next run date given a recurrence and optional target day-of-week. */
export function computeNextRunDate(
  from: string,
  recurrence: string,
  targetDow: number | null,
): string | null {
  switch (recurrence) {
    case 'once':
      return null;
    case 'daily':
      return addDays(from, 1);
    case 'weekdays': {
      let d = addDays(from, 1);
      for (let i = 0; i < 7; i++) {
        const dow = dayOfWeek(d);
        if (dow !== 0 && dow !== 6) return d;
        d = addDays(d, 1);
      }
      return d;
    }
    case 'weekly': {
      if (targetDow == null) return addDays(from, 7);
      let d = addDays(from, 1);
      for (let i = 0; i < 14; i++) {
        if (dayOfWeek(d) === targetDow) return d;
        d = addDays(d, 1);
      }
      return addDays(from, 7);
    }
    case 'biweekly':
      return addDays(from, 14);
    case 'monthly':
      return addMonth(from);
    default:
      return null;
  }
}

/** Should this request fire right now? */
function shouldFire(r: ContentRequestRow, today: string, hourUtc: number): boolean {
  if (!r.active || r.paused) return false;
  if (r.last_triggered_at === today) return false;
  const due = !r.next_run_date || r.next_run_date <= today;
  if (!due) return false;
  if (r.time_of_day) {
    const parts = r.time_of_day.split(':');
    const targetH = parseInt(parts[0] ?? '', 10);
    if (!isNaN(targetH) && hourUtc < targetH) return false;
  }
  return true;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runContentRequests(
  env: Env,
  openAiKey: string,
): Promise<ContentRequestStats> {
  const stats: ContentRequestStats = {
    requests_processed: 0, posts_created: 0, skipped: 0, errors: 0,
  };
  const today = todayUtc();
  const hour  = new Date().getUTCHours();

  const rows = await env.DB
    .prepare(
      `SELECT r.*, c.slug AS client_slug
       FROM content_requests r
       JOIN clients c ON c.id = r.client_id
       WHERE r.active = 1 AND r.paused = 0
         AND (r.next_run_date IS NULL OR r.next_run_date <= ?)
       ORDER BY r.next_run_date ASC
       LIMIT 100`,
    )
    .bind(today)
    .all<ContentRequestRow & { client_slug: string }>();

  for (const request of rows.results) {
    stats.requests_processed++;
    try {
      if (!shouldFire(request, today, hour)) {
        stats.skipped++;
        continue;
      }
      const created = await processOneRequest(env, openAiKey, request, today);
      stats.posts_created += created;
    } catch (err) {
      console.error(`[content-request] ${request.id} error:`, err);
      stats.errors++;
    }
  }

  return stats;
}

// ─── Process a single request ─────────────────────────────────────────────────

async function processOneRequest(
  env:        Env,
  openAiKey:  string,
  request:    ContentRequestRow & { client_slug: string },
  today:      string,
): Promise<number> {
  const client = await getClientBySlug(env.DB, request.client_slug);
  if (!client) {
    console.warn(`[content-request] ${request.id} client not found: ${request.client_slug}`);
    return 0;
  }

  const platforms: string[] | undefined = request.platforms
    ? (() => {
        try { return JSON.parse(request.platforms!) as string[]; }
        catch { return undefined; }
      })()
    : undefined;

  const contentType: 'image' | 'reel' | 'video' | 'blog' =
    (request.content_type as 'image' | 'reel' | 'video' | 'blog' | null)
    ?? (request.request_type === 'blog' ? 'blog' : 'image');

  const perRun = Math.max(1, Math.min(10, request.per_run ?? 1));
  let created = 0;

  for (let i = 0; i < perRun; i++) {
    const { topic, topicRow } = await resolveTopic(env, client.id, contentType, request);

    try {
      const result = await createContentWithImage(
        env,
        {
          clientSlug:    request.client_slug,
          platforms,
          contentType,
          topicOverride: topic,
          publishDate:   undefined,
          status:        'pending_approval',
          notifyDiscord: true,
          triggeredBy:   `content_request:${request.id}`,
        },
        openAiKey,
      );

      if (topicRow) {
        await markClientTopicUsed(env.DB, topicRow.id, result.postId);
      }
      created++;
    } catch (err) {
      console.error(`[content-request] ${request.id} createContentWithImage failed:`, err);
    }
  }

  // Advance next_run_date (even if zero posts created — don't infinitely retry today)
  const next = computeNextRunDate(today, request.recurrence, request.day_of_week);
  const now  = Math.floor(Date.now() / 1000);

  if (request.recurrence === 'once') {
    await env.DB
      .prepare(
        `UPDATE content_requests
         SET last_triggered_at = ?, next_run_date = NULL, active = 0, updated_at = ?
         WHERE id = ?`,
      )
      .bind(today, now, request.id)
      .run();
  } else {
    await env.DB
      .prepare(
        `UPDATE content_requests
         SET last_triggered_at = ?, next_run_date = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(today, next, now, request.id)
      .run();
  }

  console.log(
    `[content-request] ${request.id} (${request.client_slug}) fired: ${created}/${perRun} posts, next: ${next ?? 'n/a'}`,
  );
  return created;
}

async function resolveTopic(
  env: Env,
  clientId: string,
  contentType: string,
  request: ContentRequestRow,
): Promise<{ topic: string | undefined; topicRow: ClientTopicRow | null }> {
  if (request.topic_strategy === 'fixed') {
    return { topic: request.fixed_topic ?? undefined, topicRow: null };
  }
  if (request.topic_strategy === 'queue') {
    const row = await peekNextClientTopic(env.DB, clientId, contentType);
    if (row) return { topic: row.topic, topicRow: row };
    // Fall through to auto research if queue empty
  }
  // 'auto' or empty queue
  return { topic: undefined, topicRow: null };
}
