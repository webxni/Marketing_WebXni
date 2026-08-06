import { describe, expect, it } from 'vitest';
import { normalizeBlogDraftPayload } from './blog-publishing';

describe('normalizeBlogDraftPayload', () => {
  it('renders the post publish date instead of the edit date', () => {
    const result = normalizeBlogDraftPayload({
      slug: 'example',
      canonical_name: 'Example Company',
      industry: 'Marketing',
      state: 'CA',
      phone: null,
      cta_text: 'Contact Our Team',
      brand_json: null,
      wp_template_key: null,
    }, {
      content_type: 'blog',
      title: 'Example Guide',
      blog_excerpt: 'A complete example excerpt.',
      target_keyword: 'example guide',
      secondary_keywords: 'example planning',
      seo_title: 'Example Guide',
      meta_description: 'A complete example description.',
      slug: 'example-guide',
      publish_date: '2026-07-30T09:00',
      blog_content: '<section class="wx-blog-section"><h2>Plan the work</h2><div class="wx-blog-section-body"><p>Useful guidance.</p></div></section>',
    });

    expect(result.blog_content).toContain('July 30, 2026');
  });

  it('normalizes formatted US phone numbers in click-to-call links', () => {
    const result = normalizeBlogDraftPayload({
      slug: 'example',
      canonical_name: 'Example Company',
      industry: 'Landscaping',
      state: 'CA',
      phone: '(323) 306-6441',
      cta_text: 'Contact Our Team',
      brand_json: null,
      wp_template_key: null,
    }, {
      content_type: 'blog',
      title: 'Example Guide',
      blog_excerpt: 'A complete example excerpt.',
      target_keyword: 'example guide',
      secondary_keywords: 'example planning',
      seo_title: 'Example Guide',
      meta_description: 'A complete example description.',
      slug: 'example-guide',
      publish_date: '2026-07-30T09:00',
      blog_content: '<section class="wx-blog-section"><h2>Plan the work</h2><div class="wx-blog-section-body"><p>Useful guidance.</p></div></section>',
    });

    expect(result.blog_content).toContain('href="tel:+13233066441"');
  });
});
