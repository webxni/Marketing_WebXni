import { describe, expect, it } from 'vitest';
import type { ClientPlatformRow, ClientRow, PostRow } from '../types';
import { buildPostContentHash } from './content-review';
import { validatePostApprovalReadiness } from './approval-readiness';

const now = new Date('2026-08-18T20:00:00Z');

function client(): ClientRow & { platforms: ClientPlatformRow[]; gbp_locations: never[] } {
  return {
    id: 'client-1', slug: 'client', canonical_name: 'Client', owner_group: null,
    status: 'active', upload_post_profile: 'profile', manual_only: 0,
    platforms: [{
      id: 'platform-1', client_id: 'client-1', platform: 'facebook', connection_status: 'connected',
      verification_status: 'verified', paused: 0,
    } as ClientPlatformRow],
    gbp_locations: [],
  } as ClientRow & { platforms: ClientPlatformRow[]; gbp_locations: never[] };
}

function post(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: 'post-1', client_id: 'client-1', title: 'A useful local post', status: 'pending_approval',
    content_type: 'video', platforms: JSON.stringify(['facebook']), publish_date: '2026-08-19T10:00:00Z',
    master_caption: 'A distinct and useful caption.', cap_facebook: 'A Facebook-specific caption.', ready_for_automation: 0, asset_delivered: 1,
    asset_r2_key: 'client/post/video.mp4', asset_type: 'video', asset_source: 'designer', asset_rights_confirmed: 1,
    scheduled_by_automation: 1, generation_run_id: 'run-1', created_by: 'social-copy',
    gbp_topic_type: null, gbp_cta_type: null, gbp_cta_url: null,
    gbp_event_title: null, gbp_event_start_date: null, gbp_event_end_date: null,
    gbp_coupon_code: null, gbp_redeem_url: null,
    ...overrides,
  } as PostRow;
}

function mockDb(review: Record<string, unknown> | null = null, blockedPlatform: Record<string, unknown> | null = null): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => sql.includes('FROM content_review_notes') ? review
          : sql.includes('FROM post_platforms') ? blockedPlatform
            : null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }),
    }),
  } as unknown as D1Database;
}

describe('validatePostApprovalReadiness', () => {
  it('blocks every automated draft without current editorial review and provenance', async () => {
    const result = await validatePostApprovalReadiness(mockDb(), post({ generation_run_id: null, created_by: null }), client(), { now });
    expect(result.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
      'GENERATION_PROVENANCE_REQUIRED',
      'EDITORIAL_REVIEW_REQUIRED',
    ]));
  });

  it('does not require manual rights confirmation under the agency AI-media policy', async () => {
    const candidate = post({ asset_source: null, asset_rights_confirmed: 0 });
    const hash = await buildPostContentHash(candidate);
    const result = await validatePostApprovalReadiness(mockDb({
      id: 'review-1', content_hash: hash, severity: 'info', disposition: 'reviewed',
      notes_json: '{"issues":[],"findings":[]}', review_status: 'pending',
    }, { platform: 'facebook', error_message: 'rights missing' }), candidate, client(), { now });
    expect(result.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
      'ASSET_SOURCE_REQUIRED',
      'PLATFORM_DELIVERY_BLOCKED',
    ]));
    expect(result.blockers.map((item) => item.code)).not.toContain('ASSET_RIGHTS_UNCONFIRMED');
  });

  it('accepts only a current clean review for post approval', async () => {
    const candidate = post();
    const hash = await buildPostContentHash(candidate);
    const result = await validatePostApprovalReadiness(mockDb({
      id: 'review-1', content_hash: hash, severity: 'info', disposition: 'reviewed',
      notes_json: '{"issues":[],"findings":[]}', review_status: 'pending',
    }), candidate, client(), { now });
    expect(result.blockers).toEqual([]);
    expect(result.cleanReviewId).toBe('review-1');
  });

  it('blocks a high-severity review even when its content hash is current', async () => {
    const candidate = post();
    const hash = await buildPostContentHash(candidate);
    const result = await validatePostApprovalReadiness(mockDb({
      id: 'review-1', content_hash: hash, severity: 'high', disposition: 'blocked',
      notes_json: '{"issues":["duplicate"],"findings":[]}', review_status: 'pending',
    }), candidate, client(), { now });
    expect(result.blockers.map((item) => item.code)).toContain('EDITORIAL_REVIEW_BLOCKED');
  });
});
