import { describe, it, expect } from 'vitest';
import { MCP_RESOURCE_DEFS } from './resources';

describe('mcp resources', () => {
  it('exposes the five client resources', () => {
    const uris = MCP_RESOURCE_DEFS.map((r) => r.uri);
    expect(uris).toEqual([
      'client://profile', 'client://offers', 'client://events',
      'client://approved-content', 'client://keywords',
    ]);
  });
});
