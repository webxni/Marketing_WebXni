import { describe, expect, it } from 'vitest';
import { validateAutomationReadiness } from './readiness-gate';
import type { ClientPlatformRow, ClientRow, PostRow } from '../types';

const now = new Date('2026-08-18T20:00:00Z');

function client(platform: Partial<ClientPlatformRow> = {}): ClientRow & { platforms: ClientPlatformRow[]; gbp_locations: never[] } {
  return {
    id: 'client-1', slug: 'client', canonical_name: 'Client', status: 'active', upload_post_profile: 'profile', manual_only: 0,
    platforms: [{ id: 'p1', client_id: 'client-1', platform: 'facebook', connection_status: 'connected', verification_status: 'verified', paused: 0, ...platform } as ClientPlatformRow],
    gbp_locations: [],
  } as ClientRow & { platforms: ClientPlatformRow[]; gbp_locations: never[] };
}

function post(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: 'post-1', client_id: 'client-1', title: 'Post', status: 'ready', content_type: 'text', platforms: JSON.stringify(['facebook']),
    publish_date: '2026-08-18T19:00:00Z', master_caption: 'Caption', ready_for_automation: 1, asset_delivered: 1,
    asset_r2_key: null, asset_type: null, gbp_topic_type: null, gbp_cta_type: null, gbp_cta_url: null,
    gbp_event_title: null, gbp_event_start_date: null, gbp_event_end_date: null, gbp_coupon_code: null, gbp_redeem_url: null,
    ...overrides,
  } as PostRow;
}

describe('validateAutomationReadiness', () => {
  it('blocks targeted publish for future-dated posts', () => {
    expect(validateAutomationReadiness(post({ publish_date: '2026-08-19T10:00:00Z' }), client(), { mode: 'publish', now })?.code)
      .toBe('PUBLISH_DATE_IN_FUTURE');
  });

  it('blocks approval/readiness for overdue posts', () => {
    expect(validateAutomationReadiness(post({ publish_date: '2026-08-01T10:00:00Z' }), client(), { mode: 'ready', now })?.code)
      .toBe('PUBLISH_DATE_OVERDUE');
  });

  it('blocks disconnected destinations', () => {
    expect(validateAutomationReadiness(post(), client({ connection_status: 'disconnected' }), { mode: 'publish', now })?.code)
      .toBe('DESTINATION_DISCONNECTED');
  });

  it('blocks suspended/unverified destinations', () => {
    expect(validateAutomationReadiness(post(), client({ verification_status: 'suspended' }), { mode: 'publish', now })?.code)
      .toBe('DESTINATION_NOT_VERIFIED');
  });

  it('applies GBP CTA/topic checks to regional GBP variants', () => {
    const c = client({ platform: 'google_business', upload_post_location_id: 'loc' });
    expect(validateAutomationReadiness(post({ platforms: JSON.stringify(['gbp_la']), gbp_cta_type: 'LEARN_MORE', gbp_cta_url: null }), c, { mode: 'publish', now })?.code)
      .toBe('GBP_CTA_URL_REQUIRED');
    expect(validateAutomationReadiness(post({ platforms: JSON.stringify(['gbp_la']), gbp_topic_type: 'EVENT' }), c, { mode: 'publish', now })?.code)
      .toBe('GBP_EVENT_FIELDS_REQUIRED');
  });

  it('passes a due post with connected verified destination', () => {
    expect(validateAutomationReadiness(post(), client(), { mode: 'publish', now })).toBeNull();
  });
});
