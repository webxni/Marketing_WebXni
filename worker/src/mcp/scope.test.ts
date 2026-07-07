import { describe, it, expect } from 'vitest';
import { isToolAllowed, isPublishTool, forceClientScope } from './scope';

describe('mcp scope', () => {
  it('allows read/draft/publish tools, blocks admin/destructive', () => {
    expect(isToolAllowed('get_posts')).toBe(true);
    expect(isToolAllowed('create_content_with_image')).toBe(true);
    expect(isToolAllowed('publish_post')).toBe(true);
    expect(isToolAllowed('delete_client_profile')).toBe(false);
    expect(isToolAllowed('update_client_platforms')).toBe(false);
    expect(isToolAllowed('sync_upload_post_platforms')).toBe(false);
    expect(isToolAllowed('delete_post')).toBe(false);
    expect(isToolAllowed('not_a_tool')).toBe(false);
  });

  it('flags publish tools', () => {
    expect(isPublishTool('publish_post')).toBe(true);
    expect(isPublishTool('get_posts')).toBe(false);
  });

  it('overrides any client argument with the token client', () => {
    const out = forceClientScope(
      { client: 'attacker-client', client_id: 'x', slug: 'y', title: 'ok' },
      'golden-touch-roofing',
    );
    expect(out.client).toBe('golden-touch-roofing');
    expect(out.client_id).toBe('golden-touch-roofing');
    expect(out.slug).toBe('golden-touch-roofing');
    expect(out.client_slugs).toEqual(['golden-touch-roofing']);
    expect(out.title).toBe('ok');
  });
});
