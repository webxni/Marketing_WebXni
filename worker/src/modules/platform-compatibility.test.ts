import { describe, expect, it } from 'vitest';
import { getCompatiblePlatforms } from './platform-compatibility';

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
