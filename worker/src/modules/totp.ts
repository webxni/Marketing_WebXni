/**
 * TOTP (RFC 6238) — Google Authenticator compatible
 * Uses WebCrypto HMAC-SHA-1 — native to Cloudflare Workers runtime.
 */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const encoded = input.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let buffer = 0, bitsLeft = 0;
  for (const char of encoded) {
    const val = B32_ALPHABET.indexOf(char);
    if (val < 0) continue;
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bytes.push((buffer >> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }
  return new Uint8Array(bytes);
}

export function generateTotpSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20)); // 160-bit secret
  let result = '';
  let buffer = 0, bitsLeft = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      result += B32_ALPHABET[(buffer >> (bitsLeft - 5)) & 31];
      bitsLeft -= 5;
    }
  }
  if (bitsLeft > 0) result += B32_ALPHABET[(buffer << (5 - bitsLeft)) & 31];
  return result;
}

/** Verify a 6-digit TOTP token. Accepts ±1 window for clock drift. */
export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  const keyBytes = base32Decode(secret);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
    );
  } catch { return false; }

  const counter = Math.floor(Date.now() / 30000);
  for (const drift of [-1, 0, 1]) {
    const count = counter + drift;
    const msg = new ArrayBuffer(8);
    new DataView(msg).setBigUint64(0, BigInt(count), false); // big-endian
    const sig  = await crypto.subtle.sign('HMAC', key, msg);
    const hash = new Uint8Array(sig);
    const off  = hash[19] & 0x0f;
    const code = (
      ((hash[off]     & 0x7f) << 24) |
      ((hash[off + 1] & 0xff) << 16) |
      ((hash[off + 2] & 0xff) <<  8) |
       (hash[off + 3] & 0xff)
    ) % 1_000_000;
    if (code.toString().padStart(6, '0') === token) return true;
  }
  return false;
}

/** Returns the otpauth:// URI for QR code generation. */
export function totpUri(email: string, secret: string, issuer = 'WebXni'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
