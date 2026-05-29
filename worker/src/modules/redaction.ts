const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(cf[gu]t_[A-Za-z0-9_-]{16,})\b/gi,
  /\b(xox[baprs]-[A-Za-z0-9-]{16,})\b/gi,
  /\b([A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,})\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:authorization|cookie|password|token|api[_-]?key|secret)\s*[:=]\s*["']?[^"',\s}]{8,}/gi,
  /\b[A-Za-z0-9+/=_-]{48,}\b/g,
];

export function redactSecrets(value: unknown): string {
  let text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[REDACTED_SECRET]');
  }
  return text;
}
