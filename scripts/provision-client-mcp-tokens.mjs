#!/usr/bin/env node
// Provisions one MCP token per ACTIVE client and enables MCP for them.
// Usage: CLOUDFLARE_API_TOKEN=... node scripts/provision-client-mcp-tokens.mjs
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const DB = 'webxni_db';
const d1 = (sql) => JSON.parse(execFileSync('npx', [
  'wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));

const genToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  const b64 = Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `wxmcp_${b64}`;
};
const sha256hex = async (s) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
};

const clients = d1("SELECT id, slug FROM clients WHERE status='active' ORDER BY slug;")[0].results;
for (const cl of clients) {
  const has = d1(`SELECT COUNT(*) n FROM client_mcp_tokens WHERE client_id='${cl.id}' AND active=1;`)[0].results[0].n;
  d1(`UPDATE clients SET mcp_enabled=1 WHERE id='${cl.id}';`);
  if (has > 0) { console.log(`${cl.slug}: already has an active token (skipped)`); continue; }
  const token = genToken();
  const hash = await sha256hex(token);
  const prefix = token.slice(0, 8);
  d1(`INSERT INTO client_mcp_tokens (client_id, token_hash, token_prefix, label) VALUES ('${cl.id}','${hash}','${prefix}','initial');`);
  console.log(`${cl.slug}: ${token}`);
}
console.log('\nStore these tokens now — they are not recoverable.');
