import { describe, it, expect } from 'vitest';
import { handleMcpRpc } from './protocol';

const deps = (exec: any) => ({ clientSlug: 'acme', clientName: 'Acme', exec });

describe('mcp protocol', () => {
  it('initialize returns protocol + server info', async () => {
    const res: any = await handleMcpRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, deps(async () => ({ success: true })));
    expect(res.result.serverInfo.name).toContain('acme');
    expect(res.result.protocolVersion).toBeTruthy();
    expect(res.result.capabilities.prompts).toBeUndefined();
  });

  it('notifications/initialized returns no JSON-RPC response', async () => {
    const res = await handleMcpRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps(async () => ({ success: true })));
    expect(res).toBeNull();
  });

  it('handles startup compatibility methods', async () => {
    const ping: any = await handleMcpRpc({ jsonrpc: '2.0', id: 11, method: 'ping' }, deps(async () => ({ success: true })));
    const prompts: any = await handleMcpRpc({ jsonrpc: '2.0', id: 12, method: 'prompts/list' }, deps(async () => ({ success: true })));
    const templates: any = await handleMcpRpc({ jsonrpc: '2.0', id: 13, method: 'resources/templates/list' }, deps(async () => ({ success: true })));
    expect(ping.result).toEqual({});
    expect(prompts.result.prompts).toEqual([]);
    expect(templates.result.resourceTemplates).toEqual([]);
  });

  it('tools/list returns only allowlisted tools', async () => {
    const res: any = await handleMcpRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, deps(async () => ({ success: true })));
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain('publish_post');
    expect(names).not.toContain('delete_client_profile');
  });

  it('tools/call rejects a non-allowlisted tool without invoking exec', async () => {
    let called = false;
    const res: any = await handleMcpRpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete_client_profile', arguments: {} } },
      deps(async () => { called = true; return { success: true }; }),
    );
    expect(called).toBe(false);
    expect(res.result.isError).toBe(true);
  });

  it('tools/call forces client scope before exec', async () => {
    let seen: any = null;
    const res: any = await handleMcpRpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_posts', arguments: { client: 'evil' } } },
      deps(async (_n: string, a: any) => { seen = a; return { success: true, action_summary: 'ok' }; }),
    );
    expect(seen.client).toBe('acme');
    expect(res.result.isError).toBeFalsy();
  });

  it('tools/call preserves data in structured content', async () => {
    const data = { platforms: [{ platform: 'facebook', paused: 0, page_id: '123' }] };
    const res: any = await handleMcpRpc(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_client_details', arguments: {} } },
      deps(async () => ({ success: true, action_summary: 'ok', data })),
    );
    expect(res.result.structuredContent.data).toEqual(data);
  });

  it('tools/call redacts credential fields from structured content', async () => {
    const data = {
      profile: {
        canonical_name: 'Acme',
        wp_auth: 'secret',
        wp_application_password: 'secret',
        api_token: 'secret',
      },
      platforms: [{ platform: 'facebook', page_id: '123' }],
    };
    const res: any = await handleMcpRpc(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_client_details', arguments: {} } },
      deps(async () => ({ success: true, action_summary: 'ok', data })),
    );
    expect(res.result.structuredContent.data.profile).toEqual({ canonical_name: 'Acme' });
    expect(res.result.structuredContent.data.platforms[0].page_id).toBe('123');
  });

  it('publish tool blocked by guard does not call exec', async () => {
    let called = false;
    const res: any = await handleMcpRpc(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'publish_post', arguments: {} } },
      {
        clientSlug: 'acme', clientName: 'Acme',
        exec: async () => { called = true; return { success: true }; },
        publishGuard: async () => ({ allowed: false, reason: 'Daily limit reached.' }),
      } as any,
    );
    expect(called).toBe(false);
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/Daily limit/);
  });
});
