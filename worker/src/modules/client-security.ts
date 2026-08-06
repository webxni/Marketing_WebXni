const CLIENT_SECRET_FIELDS = new Set([
  'wp_auth',
  'wp_application_password',
]);

export function sanitizeClientForResponse<T extends object>(client: T): T & {
  wp_auth: null;
  wp_application_password: null;
} {
  return {
    ...client,
    wp_auth: null,
    wp_application_password: null,
  };
}

export function redactClientSecrets(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      CLIENT_SECRET_FIELDS.has(key) ? '[REDACTED]' : item,
    ]),
  );
}
