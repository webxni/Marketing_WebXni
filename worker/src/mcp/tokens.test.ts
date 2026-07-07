import { describe, it, expect } from 'vitest';
import { generateMcpToken, hashMcpToken, timingSafeEqualHex } from './tokens';

describe('mcp tokens', () => {
  it('generates a prefixed token and matching prefix', () => {
    const { token, prefix } = generateMcpToken();
    expect(token.startsWith('wxmcp_')).toBe(true);
    expect(token.length).toBeGreaterThan(30);
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBe(8);
  });

  it('hashes deterministically to 64 hex chars', async () => {
    const h1 = await hashMcpToken('wxmcp_abc');
    const h2 = await hashMcpToken('wxmcp_abc');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashMcpToken('wxmcp_xyz')).not.toBe(h1);
  });

  it('timing-safe compare matches equal, rejects unequal and length-mismatch', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false);
  });
});
