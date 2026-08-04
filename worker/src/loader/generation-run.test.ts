import { describe, expect, it } from 'vitest';
import { buildPackageSlots } from './generation-run';

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
