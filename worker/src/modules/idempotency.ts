/**
 * Idempotency key generation
 * Port of post_content.py make_idempotency_key()
 * Algorithm: SHA-256(postId:platform:publishDate) → first 32 hex chars
 * Deterministic — same inputs always produce the same key.
 */
export async function makeIdempotencyKey(
  postId: string,
  platform: string,
  publishDate: string,
): Promise<string> {
  const input = `${postId}:${platform}:${publishDate}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
