import { describe, expect, it } from 'vitest';
import { getCompatiblePlatforms, isPostContentComplete, withImplicitGbpPlatform } from './platform-compatibility';

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
      paused: 1,
      paused_reason: 'Paused by owner',
      sort_order: 0,
    }], 'client-1');

    expect(platforms).toEqual([]);
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
