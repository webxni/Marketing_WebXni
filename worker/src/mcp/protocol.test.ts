import { describe, it, expect } from 'vitest';
import { handleMcpRpc } from './protocol';

const deps = (exec: any) => ({ clientSlug: 'acme', clientName: 'Acme', exec });

describe('mcp protocol', () => {
  it('initialize returns protocol + server info', async () => {
    const res: any = await handleMcpRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, deps(async () => ({ success: true })));
    expect(res.result.serverInfo.name).toContain('acme');
    expect(res.result.protocolVersion).toBeTruthy();
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
});
