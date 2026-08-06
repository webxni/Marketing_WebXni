import { describe, expect, it } from 'vitest';
import type { ClientRow } from '../types';
import { redactClientSecrets, sanitizeClientForResponse } from './client-security';

function client(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: 'client-1',
    slug: 'client-1',
    canonical_name: 'Client One',
    package: null,
    status: 'active',
    manual_only: 0,
    mcp_enabled: 0,
    auto_publish_policy: 'manual',
    requires_approval_from: null,
    language: 'en',
    upload_post_profile: null,
    owner_group: null,
    never_mix_with: null,
    profile_approval_status: 'pending',
    profile_approved_by: null,
    profile_approved_at: null,
    wp_domain: null,
    wp_url: null,
    wp_auth: 'legacy-secret',
    wp_template: null,
    wp_admin_url: null,
    wp_base_url: 'https://example.com',
    wp_rest_base: '/wp-json/wp/v2',
    wp_username: 'editor',
    wp_application_password: 'application-secret',
    wp_default_post_status: 'draft',
    wp_default_author_id: null,
    wp_default_category_ids: null,
    wp_template_key: null,
    wp_featured_image_mode: null,
    wp_excerpt_mode: null,
    notion_page_id: null,
    brand_json: null,
    notes: null,
    phone: null,
    email: null,
    owner_name: null,
    cta_text: null,
    cta_label: null,
    industry: null,
    state: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe('client response security', () => {
  it('removes stored WordPress credentials from API client records', () => {
    const sanitized = sanitizeClientForResponse(client());

    expect(sanitized.wp_auth).toBeNull();
    expect(sanitized.wp_application_password).toBeNull();
    expect(sanitized.wp_username).toBe('editor');
  });

  it('redacts credentials before writing client update audit data', () => {
    expect(redactClientSecrets({
      canonical_name: 'Updated Client',
      wp_auth: 'legacy-secret',
      wp_application_password: 'application-secret',
    })).toEqual({
      canonical_name: 'Updated Client',
      wp_auth: '[REDACTED]',
      wp_application_password: '[REDACTED]',
    });
  });
});
