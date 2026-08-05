import { describe, expect, it } from 'vitest';
import { buildPackageSlots, existingPostTopicSelection, normalizeWeeklyServiceFamily, relevantGbpLocationsForTarget, resolveKeywordLocality, resolveKeywordService, weeklyUsedServiceCategories, weeklyUsedTargetKeywords } from './generation-run';

function pkg(overrides: Record<string, unknown>) {
  return {
    id: 'pkg',
    slug: 'pkg',
    posting_days: null,
    weekly_schedule: null,
    images_per_month: 0,
    videos_per_month: 0,
    reels_per_month: 0,
    blog_posts_per_month: 0,
    platforms_included: '["facebook","instagram"]',
    posting_frequency: 'weekly',
    ...overrides,
  } as never;
}

function counts(slots: Array<{ contentType: string }>) {
  return slots.reduce<Record<string, number>>((acc, slot) => {
    acc[slot.contentType] = (acc[slot.contentType] ?? 0) + 1;
    return acc;
  }, {});
}

function expectNotOver(countMap: Record<string, number>, caps: Record<string, number>) {
  for (const [type, n] of Object.entries(countMap)) {
    expect(n).toBeLessThanOrEqual(caps[type] ?? 0);
  }
}

describe('buildPackageSlots', () => {
  it('uses ModernVision schedule and monthly caps', () => {
    const slots = buildPackageSlots(pkg({
      slug: 'modernvision',
      weekly_schedule: '{"monday":["image","reel"],"wednesday":["image","reel"],"friday":["image","reel"]}',
      images_per_month: 13,
      reels_per_month: 13,
    }), '2026-08-01', '2026-08-31');

    expect(counts(slots)).toEqual({ image: 13, reel: 13 });
  });

  it('does not let Basic monthly frequency collapse scheduled weekly slots', () => {
    const slots = buildPackageSlots(pkg({
      slug: 'basic',
      posting_frequency: 'monthly',
      weekly_schedule: '{"monday":["image"],"wednesday":["video"],"friday":["image"]}',
      images_per_month: 9,
      videos_per_month: 4,
    }), '2026-08-01', '2026-08-31');

    expect(counts(slots)).toEqual({ image: 9, video: 4 });
  });

  it('uses Medium package schedule without exceeding monthly caps', () => {
    const slots = buildPackageSlots(pkg({
      slug: 'medium',
      weekly_schedule: '{"monday":["video"],"tuesday":["image"],"wednesday":["reel"],"thursday":["image","blog"],"friday":["reel"]}',
      images_per_month: 9,
      videos_per_month: 4,
      reels_per_month: 9,
      blog_posts_per_month: 4,
    }), '2026-08-01', '2026-08-31');

    const countMap = counts(slots);
    expect(countMap).toEqual({ video: 4, image: 8, reel: 8, blog: 4 });
    expectNotOver(countMap, { video: 4, image: 9, reel: 9, blog: 4 });
  });

  it('uses Premium package schedule without exceeding monthly caps', () => {
    const slots = buildPackageSlots(pkg({
      slug: 'premium',
      weekly_schedule: '{"monday":["video","reel","blog"],"tuesday":["image","reel","blog"],"wednesday":["video","blog","reel"],"thursday":["reel","image","blog"],"friday":["reel","blog","image"],"saturday":["image"]}',
      images_per_month: 17,
      videos_per_month: 9,
      reels_per_month: 22,
      blog_posts_per_month: 22,
    }), '2026-08-01', '2026-08-31');

    const countMap = counts(slots);
    expect(countMap).toEqual({ image: 17, video: 9, reel: 21, blog: 21 });
    expectNotOver(countMap, { video: 9, reel: 22, blog: 22, image: 17 });
  });
});

describe('resolveKeywordLocality', () => {
  it('uses the confirmed area embedded in the selected keyword', () => {
    expect(resolveKeywordLocality(
      'general contractor Los Angeles',
      ['Seattle', 'Los Angeles', 'Portland'],
      0,
    )).toBe('Los Angeles');
  });

  it('prefers the longest embedded area name', () => {
    expect(resolveKeywordLocality('building key copying West Hollywood', ['Hollywood', 'West Hollywood'], 0)).toBe('West Hollywood');
  });

  it('uses the deterministic fallback when the keyword has no area', () => {
    expect(resolveKeywordLocality('bathroom remodeling', ['Seattle', 'Portland'], 3)).toBe('Portland');
  });
});

describe('resolveKeywordService', () => {
  it('prefers the exact service phrase over a shared generic token', () => {
    expect(resolveKeywordService(
      ['Building lockouts', 'Car lockouts'],
      'Car lockouts Pasadena',
      0,
    )).toBe('Car lockouts');
  });

  it('keeps automotive locksmith intent inside automotive services', () => {
    expect(resolveKeywordService(
      ['Building lockouts', 'Car lockouts', 'Car key copying'],
      'Car locksmith Pasadena',
      0,
    )).toBe('Car lockouts');
  });
});

describe('weeklyUsedTargetKeywords', () => {
  it('excludes only keywords already used in the active package week', () => {
    const keywords = weeklyUsedTargetKeywords([
      { title: 'Current', target_keyword: 'Kitchen Remodeling Los Angeles', topic_service_category: 'Kitchen Remodeling', content_type: 'image', publish_date: '2026-08-03T10:00', platforms: [] },
      { title: 'Previous', target_keyword: 'Bathroom Remodeling Los Angeles', topic_service_category: 'Bathroom Remodeling', content_type: 'image', publish_date: '2026-07-31T10:00', platforms: [] },
      { title: 'Current Friday', target_keyword: 'ADU Builder Pasadena', topic_service_category: 'ADU Construction', content_type: 'reel', publish_date: '2026-08-07T10:00', platforms: [] },
    ], '2026-08-06');

    expect([...keywords]).toEqual(['kitchen remodeling los angeles', 'adu builder pasadena']);
  });

  it('tracks service categories used in the active package week', () => {
    const services = weeklyUsedServiceCategories([
      { title: 'Current', target_keyword: 'Lock installation Pasadena', topic_service_category: 'General lock installation', content_type: 'image', publish_date: '2026-08-04T10:00', platforms: [] },
      { title: 'Previous', target_keyword: 'Lock rekeying Pasadena', topic_service_category: 'Lock rekeying', content_type: 'reel', publish_date: '2026-07-31T10:00', platforms: [] },
      { title: 'Current Friday', target_keyword: 'Building lockout Pasadena', topic_service_category: 'Building lockouts', content_type: 'reel', publish_date: '2026-08-07T10:00', platforms: [] },
    ], '2026-08-06');

    expect([...services]).toEqual(['lock installation', 'building lockouts']);
  });

  it('groups equivalent locksmith service labels into one weekly topic family', () => {
    expect(normalizeWeeklyServiceFamily('Door lock & bolt hardware installation')).toBe('lock installation');
    expect(normalizeWeeklyServiceFamily('General lock installation')).toBe('lock installation');
    expect(normalizeWeeklyServiceFamily('Car key copying')).toBe('key copying');
    expect(normalizeWeeklyServiceFamily('Building key duplication')).toBe('key copying');
    expect(normalizeWeeklyServiceFamily('Car lockouts')).toBe('automotive lockouts');
    expect(normalizeWeeklyServiceFamily('Building lockouts')).toBe('building lockouts');
  });
});

describe('existingPostTopicSelection', () => {
  it('keeps incomplete-field retries on the existing post topic', () => {
    const selection = existingPostTopicSelection({
      title: 'Kitchen Remodel Lighting Plan for Los Angeles',
      target_keyword: 'kitchen remodel lighting Los Angeles',
      target_locality: 'Los Angeles',
      monthly_topic_id: null,
      topic_fingerprint: 'existing-fingerprint',
      topic_service_category: 'Kitchen Remodeling',
    }, 'image');

    expect(selection).toMatchObject({
      topicTitle: 'Kitchen Remodel Lighting Plan for Los Angeles',
      targetKeyword: 'kitchen remodel lighting Los Angeles',
      targetLocality: 'Los Angeles',
      topicFingerprint: 'existing-fingerprint',
      serviceCategory: 'Kitchen Remodeling',
    });
  });
});

describe('relevantGbpLocationsForTarget', () => {
  const locations = [
    { id: 'la', label: 'LA', caption_field: 'cap_gbp_la', paused: 0 },
    { id: 'wa', label: 'WA', caption_field: 'cap_gbp_wa', paused: 0 },
    { id: 'or', label: 'OR', caption_field: 'cap_gbp_or', paused: 1 },
  ] as never;
  const areas = [
    { city: 'Los Angeles', state: 'CA' },
    { city: 'Seattle', state: 'WA' },
    { city: 'Portland', state: 'OR' },
  ];

  it('keeps only active GBP locations serving the selected topic locality', () => {
    expect(relevantGbpLocationsForTarget(locations, 'Los Angeles', areas).map((location) => location.id)).toEqual(['la']);
    expect(relevantGbpLocationsForTarget(locations, 'Seattle', areas).map((location) => location.id)).toEqual(['wa']);
  });

  it('does not route a paused-location topic to unrelated active GBP profiles', () => {
    expect(relevantGbpLocationsForTarget(locations, 'Portland', areas)).toEqual([]);
  });
});
