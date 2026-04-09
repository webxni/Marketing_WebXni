/** Central fetch wrapper — all API calls use this */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (res.status === 401) {
    // Session expired — redirect to login
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Unauthorized');
  }

  const ct = res.headers.get('Content-Type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: string }).error)
      : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  /** Multipart form upload (for assets) */
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, {
      method:  'POST',
      headers: {},  // Let browser set Content-Type with boundary
      body:    formData,
    }),
};
