/**
 * Pre-flight validation — port of post_content.py preflight()
 * All 8 safety checks in order.
 * BLOCKED = hard rule violation (never retry without fixing content)
 * SKIP    = configuration gap (fixable by updating platform config)
 */
import type { ClientPlatformRow, ClientRow } from '../types';
import { normalizePlatform } from './captions';

export interface PreflightResult {
  ok: boolean;
  tag: 'OK' | 'SKIP' | 'BLOCKED';
  reason: string;
}

export async function preflight(
  client: ClientRow & { platforms: ClientPlatformRow[]; restrictions: string[] },
  platform: string,
  caption: string | null,
): Promise<PreflightResult> {
  // 1. Upload-Post profile must be configured
  if (!client.upload_post_profile || client.upload_post_profile === 'PENDING_SETUP') {
    return {
      ok: false,
      tag: 'SKIP',
      reason: `upload_post_profile not set for '${client.slug}' — connect accounts in Upload-Post dashboard`,
    };
  }

  // 2. Hard block: manual-only clients (Modern Vision)
  if (client.manual_only === 1) {
    const who = client.requires_approval_from
      ? ` Requires approval from: ${client.requires_approval_from}`
      : '';
    return {
      ok: false,
      tag: 'BLOCKED',
      reason: `${client.canonical_name} is manual-only.${who}`,
    };
  }

  // 3. Platform must be configured for this client
  const normalizedPlatform = normalizePlatform(platform);
  const platCfg = client.platforms.find(
    (p) => normalizePlatform(p.platform) === normalizedPlatform,
  );
  if (!platCfg) {
    return {
      ok: false,
      tag: 'SKIP',
      reason: `Platform '${normalizedPlatform}' not configured for '${client.slug}'`,
    };
  }

  // 4. Platform not paused
  if (platCfg.paused === 1) {
    const since = platCfg.paused_since ? ` since ${platCfg.paused_since}` : '';
    const reason = platCfg.paused_reason ?? 'paused';
    return {
      ok: false,
      tag: 'SKIP',
      reason: `${normalizedPlatform} paused for ${client.canonical_name}${since}: ${reason}`,
    };
  }

  // 5. Caption required
  if (!caption || !caption.trim()) {
    return {
      ok: false,
      tag: 'SKIP',
      reason: `No caption for '${normalizedPlatform}'`,
    };
  }

  // 6. Pinterest requires upload_post_board_id
  if (
    normalizedPlatform === 'pinterest' &&
    (!platCfg.upload_post_board_id || platCfg.upload_post_board_id === 'PENDING_SETUP')
  ) {
    return {
      ok: false,
      tag: 'SKIP',
      reason: `Pinterest board ID not configured for '${client.slug}' — get from GET /api/uploadposts/pinterest/boards`,
    };
  }

  // 7. Google Business requires upload_post_location_id
  if (
    normalizedPlatform === 'google_business' &&
    (!platCfg.upload_post_location_id ||
      platCfg.upload_post_location_id === 'PENDING_SETUP' ||
      platCfg.upload_post_location_id === 'NOT_LINKED')
  ) {
    return {
      ok: false,
      tag: 'SKIP',
      reason: `GBP location ID not configured for '${client.slug}' — get from GET /api/uploadposts/google-business/locations`,
    };
  }

  // 8. Content restriction scan (locksmith forbidden terms)
  const lowerCaption = caption.toLowerCase();
  const hit = client.restrictions.find(
    (term) => term.trim() !== '' && lowerCaption.includes(term.toLowerCase()),
  );
  if (hit) {
    return {
      ok: false,
      tag: 'BLOCKED',
      reason: `Caption contains forbidden term: "${hit}"`,
    };
  }

  return { ok: true, tag: 'OK', reason: 'preflight passed' };
}
