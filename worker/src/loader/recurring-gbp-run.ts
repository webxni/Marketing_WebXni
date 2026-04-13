/**
 * LOADER: Recurring GBP offers + events automation
 *
 * Runs on the same 6h cron as the main posting run.
 * Detects active recurring offers and events whose next_run_date <= today,
 * generates a post record for each, and updates the next_run_date.
 *
 * The generated post is set to status='ready', ready_for_automation=1,
 * asset_delivered=1 (text-only GBP post — no media required unless an
 * asset_r2_key is attached to the offer/event).
 *
 * Duplicate prevention: checks last_posted_at; skips if already posted today.
 * Expiry guard: skips events whose gbp_event_end_date is in the past.
 * One-time mode: offers with recurrence='none' are deactivated after posting.
 * Events with recurrence='once' are deactivated after posting.
 */

import type { LoaderEnv, ClientOfferRow, ClientEventRow } from '../types';
import { getClientBySlug, getClientGbpLocations } from '../db/queries';

export interface RecurringGbpStats {
  offers_processed: number;
  offers_posted:    number;
  offers_skipped:   number;
  events_processed: number;
  events_posted:    number;
  events_skipped:   number;
  errors:           number;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compute the next run date from a base date + recurrence rule */
function nextRunDate(from: string, recurrence: string): string | null {
  if (recurrence === 'none' || recurrence === 'once') return null;
  const d = new Date(from + 'T00:00:00Z');
  switch (recurrence) {
    case 'weekly':    d.setUTCDate(d.getUTCDate() + 7);  break;
    case 'biweekly':  d.setUTCDate(d.getUTCDate() + 14); break;
    case 'monthly':   d.setUTCMonth(d.getUTCMonth() + 1); break;
    default:          return null;
  }
  return d.toISOString().slice(0, 10);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runRecurringGbp(env: LoaderEnv): Promise<RecurringGbpStats> {
  const stats: RecurringGbpStats = {
    offers_processed: 0, offers_posted: 0, offers_skipped: 0,
    events_processed: 0, events_posted: 0, events_skipped: 0,
    errors: 0,
  };
  const today = todayUtc();

  await Promise.all([
    processOffers(env, today, stats),
    processEvents(env, today, stats),
  ]);

  return stats;
}

// ─── Offers ───────────────────────────────────────────────────────────────────

async function processOffers(env: LoaderEnv, today: string, stats: RecurringGbpStats) {
  // Fetch all active, non-paused offers whose next_run_date <= today (or has never run and next_run_date IS NULL)
  // Only include offers that have a gbp_cta_type OR recurrence != 'none' (i.e. GBP-intent offers)
  const rows = await env.DB
    .prepare(
      `SELECT o.*, c.slug AS client_slug FROM client_offers o
       JOIN clients c ON c.id = o.client_id
       WHERE o.active = 1
         AND o.paused = 0
         AND o.recurrence != 'none'
         AND (o.next_run_date IS NULL OR o.next_run_date <= ?)
       ORDER BY o.next_run_date ASC
       LIMIT 100`,
    )
    .bind(today)
    .all<ClientOfferRow & { client_slug: string }>();

  for (const offer of rows.results) {
    stats.offers_processed++;
    try {
      await processOneOffer(env, offer, today, stats);
    } catch (err) {
      console.error(`[recurring-gbp] Offer ${offer.id} error:`, err);
      stats.errors++;
    }
  }
}

async function processOneOffer(
  env: LoaderEnv,
  offer: ClientOfferRow & { client_slug: string },
  today: string,
  stats: RecurringGbpStats,
) {
  // Duplicate guard: already posted today
  if (offer.last_posted_at === today) {
    stats.offers_skipped++;
    return;
  }

  const client = await getClientBySlug(env.DB, offer.client_slug);
  if (!client?.upload_post_profile) {
    stats.offers_skipped++;
    return;
  }

  // Resolve GBP location
  const locationId = await resolveLocation(env, offer.client_id, offer.gbp_location_id);

  // Build caption — GBP OFFER format: title + description + CTA phrase
  const ctaPhrase = offer.gbp_cta_type ? GBP_CTA_PHRASE[offer.gbp_cta_type] ?? '' : '';
  const caption = [
    offer.title,
    offer.description ?? '',
    offer.cta_text ?? '',
    ctaPhrase,
  ].filter(Boolean).join(' — ').slice(0, 1500);

  // Create the post record
  const postId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  await env.DB
    .prepare(
      `INSERT INTO posts
        (id, client_id, title, status, content_type, platforms, publish_date,
         master_caption, cap_google_business,
         gbp_topic_type, gbp_cta_type, gbp_cta_url, gbp_location_id,
         gbp_coupon_code, gbp_redeem_url, gbp_terms,
         asset_r2_key, asset_r2_bucket,
         ready_for_automation, asset_delivered,
         scheduled_by_automation, generation_run_id,
         created_at, updated_at)
       VALUES (?, ?, ?, 'ready', 'image', '["google_business"]', ?,
               ?, ?,
               'OFFER', ?, ?, ?,
               ?, ?, ?,
               ?, ?,
               1, 1,
               1, ?,
               ?, ?)`,
    )
    .bind(
      postId, offer.client_id,
      `[Offer] ${offer.title}`,
      today,
      caption, caption,
      offer.gbp_cta_type ?? null, offer.gbp_cta_url ?? null, locationId,
      offer.gbp_coupon_code ?? null, offer.gbp_redeem_url ?? null, offer.gbp_terms ?? null,
      offer.asset_r2_key ?? null, offer.asset_r2_bucket ?? null,
      `offer:${offer.id}`,
      now, now,
    )
    .run();

  // Update offer: set last_posted_at and compute next_run_date
  const next = nextRunDate(today, offer.recurrence);
  await env.DB
    .prepare(
      `UPDATE client_offers
       SET last_posted_at = ?, next_run_date = ?,
           active = CASE WHEN ? IS NULL THEN 0 ELSE 1 END
       WHERE id = ?`,
    )
    .bind(today, next, next, offer.id)
    .run();

  stats.offers_posted++;
  console.log(`[recurring-gbp] Offer posted: ${offer.title} → post ${postId}, next: ${next ?? 'deactivated'}`);
}

// ─── Events ───────────────────────────────────────────────────────────────────

async function processEvents(env: LoaderEnv, today: string, stats: RecurringGbpStats) {
  const rows = await env.DB
    .prepare(
      `SELECT e.*, c.slug AS client_slug FROM client_events e
       JOIN clients c ON c.id = e.client_id
       WHERE e.active = 1
         AND e.paused = 0
         AND (e.next_run_date IS NULL OR e.next_run_date <= ?)
       ORDER BY e.next_run_date ASC
       LIMIT 100`,
    )
    .bind(today)
    .all<ClientEventRow & { client_slug: string }>();

  for (const event of rows.results) {
    stats.events_processed++;
    try {
      await processOneEvent(env, event, today, stats);
    } catch (err) {
      console.error(`[recurring-gbp] Event ${event.id} error:`, err);
      stats.errors++;
    }
  }
}

async function processOneEvent(
  env: LoaderEnv,
  event: ClientEventRow & { client_slug: string },
  today: string,
  stats: RecurringGbpStats,
) {
  // Expiry guard: skip events whose end date has already passed
  if (event.gbp_event_end_date && event.gbp_event_end_date < today) {
    // Auto-deactivate expired event
    await env.DB
      .prepare('UPDATE client_events SET active = 0, updated_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), event.id)
      .run();
    stats.events_skipped++;
    console.log(`[recurring-gbp] Event ${event.id} expired — deactivated`);
    return;
  }

  // Duplicate guard: already posted today
  if (event.last_posted_at === today) {
    stats.events_skipped++;
    return;
  }

  const client = await getClientBySlug(env.DB, event.client_slug);
  if (!client?.upload_post_profile) {
    stats.events_skipped++;
    return;
  }

  const locationId = await resolveLocation(env, event.client_id, event.gbp_location_id);

  // Build caption
  const ctaPhrase = event.gbp_cta_type ? GBP_CTA_PHRASE[event.gbp_cta_type] ?? '' : '';
  const dateRange = event.gbp_event_start_date
    ? event.gbp_event_end_date && event.gbp_event_end_date !== event.gbp_event_start_date
      ? `${event.gbp_event_start_date} to ${event.gbp_event_end_date}`
      : event.gbp_event_start_date
    : '';
  const caption = [
    event.gbp_event_title ?? event.title,
    dateRange ? `📅 ${dateRange}` : '',
    event.description ?? '',
    ctaPhrase,
  ].filter(Boolean).join(' — ').slice(0, 1500);

  const postId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  await env.DB
    .prepare(
      `INSERT INTO posts
        (id, client_id, title, status, content_type, platforms, publish_date,
         master_caption, cap_google_business,
         gbp_topic_type, gbp_cta_type, gbp_cta_url, gbp_location_id,
         gbp_event_title, gbp_event_start_date, gbp_event_start_time,
         gbp_event_end_date, gbp_event_end_time,
         asset_r2_key, asset_r2_bucket,
         ready_for_automation, asset_delivered,
         scheduled_by_automation, generation_run_id,
         created_at, updated_at)
       VALUES (?, ?, ?, 'ready', 'image', '["google_business"]', ?,
               ?, ?,
               'EVENT', ?, ?, ?,
               ?, ?, ?,
               ?, ?,
               ?, ?,
               1, 1,
               1, ?,
               ?, ?)`,
    )
    .bind(
      postId, event.client_id,
      `[Event] ${event.gbp_event_title ?? event.title}`,
      today,
      caption, caption,
      event.gbp_cta_type ?? null, event.gbp_cta_url ?? null, locationId,
      event.gbp_event_title ?? null,
      event.gbp_event_start_date ?? null, event.gbp_event_start_time ?? null,
      event.gbp_event_end_date ?? null, event.gbp_event_end_time ?? null,
      event.asset_r2_key ?? null, event.asset_r2_bucket ?? null,
      `event:${event.id}`,
      now, now,
    )
    .run();

  // Update event state
  const next = nextRunDate(today, event.recurrence);
  await env.DB
    .prepare(
      `UPDATE client_events
       SET last_posted_at = ?, next_run_date = ?, updated_at = ?,
           active = CASE WHEN ? IS NULL THEN 0 ELSE 1 END
       WHERE id = ?`,
    )
    .bind(today, next, now, next, event.id)
    .run();

  stats.events_posted++;
  console.log(`[recurring-gbp] Event posted: ${event.title} → post ${postId}, next: ${next ?? 'deactivated'}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve GBP location ID: prefer explicit override, then fall back to first
 * non-paused GBP location for the client, then null.
 */
async function resolveLocation(
  env: LoaderEnv,
  clientId: string,
  explicitLocationId: string | null,
): Promise<string | null> {
  if (explicitLocationId) return explicitLocationId;
  const locs = await getClientGbpLocations(env.DB, clientId);
  const active = locs.find(l => l.paused === 0);
  return active?.location_id ?? null;
}

/** Natural language CTA phrases appended to caption */
const GBP_CTA_PHRASE: Record<string, string> = {
  BOOK:       'Book your appointment today!',
  ORDER:      'Order now!',
  SHOP:       'Shop now!',
  LEARN_MORE: 'Learn more — click the link below.',
  SIGN_UP:    'Sign up today!',
  CALL:       'Call us today!',
};
