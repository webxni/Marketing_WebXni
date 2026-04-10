/**
 * Generates a PBKDF2 password hash (same algorithm as worker/src/routes/users.ts)
 * and outputs the SQL to insert an admin user into D1.
 *
 * Usage:
 *   node scripts/seed-admin.mjs
 *   # then pipe the output to wrangler:
 *   node scripts/seed-admin.mjs | npx wrangler d1 execute webxni_db --remote --command -
 *
 * Or run manually:
 *   node scripts/seed-admin.mjs > /tmp/seed-admin.sql
 *   npx wrangler d1 execute webxni_db --remote --file=/tmp/seed-admin.sql
 */

import { webcrypto } from 'node:crypto';

const EMAIL    = process.env.ADMIN_EMAIL    ?? 'admin@webxni.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const NAME     = process.env.ADMIN_NAME     ?? 'Admin';

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = webcrypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await webcrypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 256
  );

  const hashHex = Buffer.from(bits).toString('hex');
  const saltHex = Buffer.from(salt).toString('hex');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

const hash = await hashPassword(PASSWORD);
const id   = Array.from(webcrypto.getRandomValues(new Uint8Array(16)))
               .map(b => b.toString(16).padStart(2, '0')).join('');

console.log(`-- Admin seed — generated ${new Date().toISOString()}`);
console.log(`INSERT OR IGNORE INTO users (id, email, name, role, password_hash, is_active)`);
console.log(`VALUES ('${id}', '${EMAIL}', '${NAME}', 'admin', '${hash}', 1);`);

console.error(`\n✓ Hash generated for ${EMAIL} / ${PASSWORD}`);
console.error(`  Run: npx wrangler d1 execute webxni_db --remote --file=/tmp/seed-admin.sql\n`);
