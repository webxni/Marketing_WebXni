import { describe, it, expect } from 'vitest';
import { platformCategory, capFor, decidePublish } from './limits';

const limits = { client_id: 'c', social_per_day: 10, per_platform_per_day: 3, blog_per_day: 2, gbp_per_day: 5, updated_at: 0 };

describe('mcp limits', () => {
  it('categorizes platforms', () => {
    expect(platformCategory('website_blog')).toBe('blog');
    expect(platformCategory('google_business')).toBe('gbp');
    expect(platformCategory('facebook')).toBe('social');
  });

  it('caps per category', () => {
    expect(capFor(limits, 'blog')).toBe(2);
    expect(capFor(limits, 'gbp')).toBe(5);
    expect(capFor(limits, 'social')).toBe(10);
  });

  it('allows under caps with media delivered', () => {
    const d = decidePublish({ category: 'social', usedForCategory: 1, usedForPlatform: 0, limits, hasDeliveredMedia: true, isMedia: true });
    expect(d.allowed).toBe(true);
  });

  it('blocks over category cap', () => {
    const d = decidePublish({ category: 'blog', usedForCategory: 2, usedForPlatform: 0, limits, hasDeliveredMedia: true, isMedia: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/daily/i);
  });

  it('blocks over per-platform cap', () => {
    const d = decidePublish({ category: 'social', usedForCategory: 4, usedForPlatform: 3, limits, hasDeliveredMedia: false, isMedia: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/platform/i);
  });

  it('blocks media post without delivered asset', () => {
    const d = decidePublish({ category: 'social', usedForCategory: 0, usedForPlatform: 0, limits, hasDeliveredMedia: false, isMedia: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/designer|asset/i);
  });
});
