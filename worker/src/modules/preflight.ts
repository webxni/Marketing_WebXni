/**
 * Pre-flight validation
 *
 * Runs before any post is submitted to Upload-Post.
 * Returns one of three outcomes:
 *   OK      — proceed with posting
 *   SKIP    — configuration gap; skip this platform this run (fixable)
 *   BLOCKED — hard content violation; do not retry without human review
 */
import type { ClientPlatformRow, ClientRow, PostRow } from '../types';
import { normalizePlatform } from './captions';

export interface PreflightResult {
  ok:     boolean;
  tag:    'OK' | 'SKIP' | 'BLOCKED';
  reason: string;
}

export interface PreflightWarning {
  code:    string;
  message: string;
}

export async function preflight(
  client: ClientRow & { platforms: ClientPlatformRow[]; restrictions: string[] },
  platform: string,
  caption: string | null,
  post?: PostRow,
): Promise<PreflightResult> {

  // 1. Upload-Post profile must be configured
  if (!client.upload_post_profile || client.upload_post_profile === 'PENDING_SETUP') {
    return {
      ok: false, tag: 'SKIP',
      reason: `upload_post_profile not set for '${client.slug}' — connect accounts in Upload-Post dashboard`,
    };
  }

  // 2. Hard block: manual-only clients
  if (client.manual_only === 1) {
    const who = client.requires_approval_from
      ? ` Requires approval from: ${client.requires_approval_from}`
      : '';
    return {
      ok: false, tag: 'BLOCKED',
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
      ok: false, tag: 'SKIP',
      reason: `Platform '${normalizedPlatform}' not configured for '${client.slug}'`,
    };
  }

  // 4. Platform not paused
  if (platCfg.paused === 1) {
    const since = platCfg.paused_since ? ` since ${platCfg.paused_since}` : '';
    const reason = platCfg.paused_reason ?? 'paused';
    return {
      ok: false, tag: 'SKIP',
      reason: `${normalizedPlatform} paused for ${client.canonical_name}${since}: ${reason}`,
    };
  }

  // 5. Caption required
  if (!caption || !caption.trim()) {
    return {
      ok: false, tag: 'SKIP',
      reason: `No caption for '${normalizedPlatform}'`,
    };
  }

  // 6. Pinterest requires upload_post_board_id
  if (
    normalizedPlatform === 'pinterest' &&
    (!platCfg.upload_post_board_id || platCfg.upload_post_board_id === 'PENDING_SETUP')
  ) {
    return {
      ok: false, tag: 'SKIP',
      reason: `Pinterest board ID not configured for '${client.slug}'`,
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
      ok: false, tag: 'SKIP',
      reason: `GBP location ID not configured for '${client.slug}'`,
    };
  }

  // 8. GBP: CTA URL required when a CTA type is set
  if (normalizedPlatform === 'google_business' && post) {
    if (post.gbp_cta_type && post.gbp_cta_type !== 'CALL' && !post.gbp_cta_url?.trim()) {
      return {
        ok: false, tag: 'BLOCKED',
        reason: `GBP CTA type '${post.gbp_cta_type}' requires a CTA URL`,
      };
    }

    // 9. GBP EVENT: required event fields
    if (post.gbp_topic_type === 'EVENT') {
      const missing: string[] = [];
      if (!post.gbp_event_title?.trim())      missing.push('gbp_event_title');
      if (!post.gbp_event_start_date?.trim()) missing.push('gbp_event_start_date');
      if (!post.gbp_event_end_date?.trim())   missing.push('gbp_event_end_date');
      if (missing.length > 0) {
        return {
          ok: false, tag: 'BLOCKED',
          reason: `GBP EVENT post missing required fields: ${missing.join(', ')}`,
        };
      }
    }

    // 10. GBP OFFER: coupon or redeem URL recommended (warn only → SKIP not BLOCKED)
    if (post.gbp_topic_type === 'OFFER' && !post.gbp_coupon_code?.trim() && !post.gbp_redeem_url?.trim()) {
      return {
        ok: false, tag: 'SKIP',
        reason: `GBP OFFER post should have gbp_coupon_code or gbp_redeem_url`,
      };
    }
  }

  // 11. Schedule validation — publish_date must not be in the past by more than 7 days
  if (post?.publish_date) {
    const scheduled = new Date(post.publish_date).getTime();
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    if (scheduled < sevenDaysAgo) {
      return {
        ok: false, tag: 'SKIP',
        reason: `publish_date is more than 7 days in the past (${post.publish_date}) — reschedule or cancel`,
      };
    }
  }

  // 12. Content restriction scan (forbidden terms)
  const lowerCaption = caption.toLowerCase();
  const hit = client.restrictions.find(
    (term) => term.trim() !== '' && lowerCaption.includes(term.toLowerCase()),
  );
  if (hit) {
    return {
      ok: false, tag: 'BLOCKED',
      reason: `Caption contains forbidden term: "${hit}"`,
    };
  }

  return { ok: true, tag: 'OK', reason: 'preflight passed' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-blocking warnings — run at post-save time to surface issues early
// ─────────────────────────────────────────────────────────────────────────────

export function preflightWarnings(
  post: PostRow,
  client: ClientRow & { platforms: ClientPlatformRow[] },
): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];
  const platforms: string[] = (() => {
    try { return JSON.parse(post.platforms ?? '[]') as string[]; }
    catch { return []; }
  })();

  if (!client.upload_post_profile) {
    warnings.push({ code: 'NO_UP_PROFILE', message: 'Upload-Post profile not configured for this client' });
  }

  for (const platform of platforms) {
    const norm = normalizePlatform(platform);
    const cfg = client.platforms.find(p => normalizePlatform(p.platform) === norm);

    if (!cfg) {
      warnings.push({ code: 'PLATFORM_NOT_CONFIGURED', message: `Platform ${norm} is not configured for this client` });
      continue;
    }

    if (cfg.paused) {
      warnings.push({ code: 'PLATFORM_PAUSED', message: `${norm} is paused: ${cfg.paused_reason ?? 'no reason given'}` });
    }

    if (norm === 'facebook' && !cfg.page_id) {
      warnings.push({ code: 'MISSING_PAGE_ID', message: 'Facebook page_id not set' });
    }

    if (norm === 'linkedin' && !cfg.page_id) {
      warnings.push({ code: 'MISSING_PAGE_ID', message: 'LinkedIn page_id not set' });
    }

    if (norm === 'pinterest' && !cfg.upload_post_board_id) {
      warnings.push({ code: 'MISSING_BOARD_ID', message: 'Pinterest board ID not set' });
    }

    if (norm === 'google_business' && !cfg.upload_post_location_id) {
      warnings.push({ code: 'MISSING_GBP_LOCATION', message: 'Google Business location ID not set' });
    }
  }

  if (platforms.includes('google_business')) {
    if (post.gbp_cta_type && post.gbp_cta_type !== 'CALL' && !post.gbp_cta_url) {
      warnings.push({ code: 'GBP_MISSING_CTA_URL', message: `GBP CTA type '${post.gbp_cta_type}' requires a CTA URL` });
    }
    if (post.gbp_topic_type === 'EVENT') {
      if (!post.gbp_event_title)      warnings.push({ code: 'GBP_EVENT_NO_TITLE', message: 'GBP EVENT missing event title' });
      if (!post.gbp_event_start_date) warnings.push({ code: 'GBP_EVENT_NO_START', message: 'GBP EVENT missing start date' });
      if (!post.gbp_event_end_date)   warnings.push({ code: 'GBP_EVENT_NO_END',   message: 'GBP EVENT missing end date' });
    }
  }

  if (platforms.includes('website_blog') && !client.wp_base_url && !client.wp_url) {
    warnings.push({ code: 'WP_NOT_CONFIGURED', message: 'WordPress not configured for this client (wp_base_url missing)' });
  }

  if (platforms.includes('website_blog') && client.wp_base_url && !client.wp_username && !client.wp_auth) {
    warnings.push({ code: 'WP_NO_CREDENTIALS', message: 'WordPress URL is set but no credentials (wp_username / wp_application_password)' });
  }

  return warnings;
}
