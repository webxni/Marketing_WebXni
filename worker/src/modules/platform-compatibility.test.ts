import { describe, expect, it } from 'vitest';
import { getCompatiblePlatforms, isPostContentComplete, withImplicitBlogPlatform, withImplicitGbpPlatform } from './platform-compatibility';

describe('platform content compatibility', () => {
  it('does not route reels to Google Business', () => {
    expect(getCompatiblePlatforms('reel', [
      'facebook', 'instagram', 'tiktok', 'youtube', 'threads', 'google_business',
    ])).toEqual(['facebook', 'instagram', 'tiktok', 'youtube', 'threads']);
  });

  it('does not route horizontal video to Google Business', () => {
    expect(getCompatiblePlatforms('video', [
      'facebook', 'instagram', 'youtube', 'linkedin', 'x', 'google_business',
    ])).toEqual(['facebook', 'instagram', 'youtube', 'linkedin', 'x']);
  });
});

describe('implicit Google Business platform', () => {
  it('adds Google Business when a client has an active GBP location', () => {
    const platforms = withImplicitGbpPlatform([], [{
      id: 'loc-1',
      client_id: 'client-1',
      label: 'LA',
      location_id: 'locations/123',
      upload_post_profile: 'client-la',
      caption_field: 'cap_gbp_la',
      posted_field: null,
      verification_status: 'verified',
      verified_business_name: null,
      verified_phone: null,
      verified_address: null,
      verified_market: 'Pasadena',
      verified_at: null,
      verification_notes: null,
      paused: 0,
      paused_reason: null,
      sort_order: 0,
    }], 'client-1');

    expect(platforms.map((platform) => platform.platform)).toContain('google_business');
  });

  it('does not add Google Business when every GBP location is paused', () => {
    const platforms = withImplicitGbpPlatform([], [{
      id: 'loc-1',
      client_id: 'client-1',
      label: 'OR',
      location_id: 'locations/456',
      upload_post_profile: 'client-or',
      caption_field: 'cap_gbp_or',
      posted_field: null,
      verification_status: 'verified',
      verified_business_name: null,
      verified_phone: null,
      verified_address: null,
      verified_market: 'Portland',
      verified_at: null,
      verification_notes: null,
      paused: 1,
      paused_reason: 'Paused by owner',
      sort_order: 0,
    }], 'client-1');

    expect(platforms).toEqual([]);
  });

  it('adds active location-backed Google Business when the legacy platform row failed', () => {
    const failedPlatform = {
      id: 'platform-1',
      client_id: 'client-1',
      platform: 'google_business',
      account_id: null,
      username: null,
      page_id: null,
      upload_post_board_id: null,
      upload_post_location_id: null,
      privacy_level: null,
      privacy_status: null,
      profile_url: null,
      profile_username: null,
      connection_status: 'failed',
      yt_channel_id: null,
      linkedin_urn: null,
      verification_status: 'unverified',
      provider_destination_id: null,
      verified_business_name: null,
      verified_phone: null,
      verified_market: null,
      verified_at: null,
      verification_notes: null,
      paused: 0,
      paused_reason: null,
      paused_since: null,
      notes: null,
    };
    const platforms = withImplicitGbpPlatform([failedPlatform], [{
      id: 'loc-1',
      client_id: 'client-1',
      label: 'LA',
      location_id: 'locations/123',
      upload_post_profile: 'client-la',
      caption_field: 'cap_gbp_la',
      posted_field: null,
      verification_status: 'verified',
      verified_business_name: null,
      verified_phone: null,
      verified_address: null,
      verified_market: 'Pasadena',
      verified_at: null,
      verification_notes: null,
      paused: 0,
      paused_reason: null,
      sort_order: 0,
    }], 'client-1');

    expect(platforms.filter((platform) => platform.platform === 'google_business')).toHaveLength(2);
    expect(platforms.some((platform) => platform.platform === 'google_business' && platform.connection_status === 'connected')).toBe(true);
  });

  it('treats an existing image as incomplete when its expected GBP captions are missing', () => {
    const locations = ['LA', 'WA'].map((label, index) => ({
      id: `loc-${index}`,
      client_id: 'client-1',
      label,
      location_id: `locations/${index}`,
      upload_post_profile: `client-${label.toLowerCase()}`,
      caption_field: label === 'LA' ? 'cap_gbp_la' : 'cap_gbp_wa',
      posted_field: null,
      verification_status: 'verified',
      verified_business_name: null,
      verified_phone: null,
      verified_address: null,
      verified_market: label,
      verified_at: null,
      verification_notes: null,
      paused: 0,
      paused_reason: null,
      sort_order: index,
    }));
    const post = {
      content_type: 'image',
      platforms: '["facebook"]',
      master_caption: 'A specific local caption.',
      cap_facebook: 'A Facebook caption.',
      ai_image_prompt: 'Dimensiones: 1200x628.',
      cap_google_business: null,
      cap_gbp_la: null,
      cap_gbp_wa: null,
    };

    expect(isPostContentComplete(post as never, locations, ['facebook', 'google_business'])).toBe(false);
  });
});

describe('implicit website blog platform', () => {
  it('adds website_blog for package draft generation without WordPress credentials', () => {
    const platforms = withImplicitBlogPlatform([], {
      id: 'client-1',
      wp_base_url: null,
      wp_url: null,
    }, true);

    expect(platforms.map((platform) => platform.platform)).toContain('website_blog');
    expect(platforms[0]?.notes).toContain('package draft generation');
  });

  it('does not imply publishing connectivity without WordPress or package draft context', () => {
    expect(withImplicitBlogPlatform([], {
      id: 'client-1',
      wp_base_url: null,
      wp_url: null,
    })).toEqual([]);
  });
});
