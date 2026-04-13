/**
 * WordPress REST API client — per-client application password authentication
 * Each client stores their own WP credentials in the clients table.
 */

export interface WpClientConfig {
  baseUrl:             string;   // 'https://example.com'
  restBase:            string;   // '/wp-json/wp/v2'
  username:            string;
  applicationPassword: string;
}

export interface WpPost {
  id:       number;
  link:     string;
  status:   string;
  slug:     string;
  title:    { rendered: string };
  content:  { rendered: string };
  excerpt:  { rendered: string };
}

export interface WpCategory {
  id:   number;
  name: string;
  slug: string;
  count: number;
}

export interface WpAuthor {
  id:         number;
  name:       string;
  slug:       string;
  avatar_urls?: Record<string, string>;
}

export interface WpMediaItem {
  id:         number;
  source_url: string;
  alt_text:   string;
}

export class WpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'WpError';
  }
}

export class WordPressClient {
  private readonly authHeader: string;
  private readonly apiBase: string;

  constructor(config: WpClientConfig) {
    const creds = `${config.username}:${config.applicationPassword}`;
    this.authHeader = `Basic ${btoa(creds)}`;
    this.apiBase = `${config.baseUrl.replace(/\/$/, '')}${config.restBase}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> ?? {}),
    };

    const res = await fetch(url, { ...init, headers });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string; error?: string };
        msg = body.message ?? body.error ?? msg;
      } catch { /* ignore */ }
      throw new WpError(res.status, msg);
    }

    return res.json() as Promise<T>;
  }

  /** Verify credentials and return the authenticated user */
  async testConnection(): Promise<{ id: number; name: string; email: string }> {
    return this.request('/users/me?context=edit');
  }

  /** List all categories (up to 100) */
  async getCategories(): Promise<WpCategory[]> {
    return this.request<WpCategory[]>('/categories?per_page=100&orderby=name&order=asc');
  }

  /** List users with author capability */
  async getAuthors(): Promise<WpAuthor[]> {
    return this.request<WpAuthor[]>('/users?per_page=100&who=authors');
  }

  /** Create a blog post */
  async createPost(data: {
    title:            string;
    content:          string;
    excerpt?:         string;
    status?:          'draft' | 'publish' | 'private' | 'pending';
    author?:          number;
    categories?:      number[];
    featured_media?:  number;
    slug?:            string;
    meta?:            Record<string, unknown>;
  }): Promise<WpPost> {
    return this.request<WpPost>('/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** Update an existing blog post */
  async updatePost(postId: number, data: Partial<{
    title:    string;
    content:  string;
    excerpt:  string;
    status:   string;
  }>): Promise<WpPost> {
    return this.request<WpPost>(`/posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  /**
   * Upload a Blob directly to the WP media library.
   * Primary upload method — use this when you already have bytes (e.g. from R2).
   */
  async uploadMediaBlob(
    blob: Blob,
    filename: string,
    altText = '',
    title = '',
  ): Promise<WpMediaItem> {
    const form = new FormData();
    form.append('file', blob, filename);
    if (altText) form.append('alt_text', altText);
    if (title)   form.append('title', title);

    const res = await fetch(`${this.apiBase}/media`, {
      method:  'POST',
      headers: { Authorization: this.authHeader },
      body:    form,
    });
    if (!res.ok) {
      let msg = `Media upload failed: HTTP ${res.status}`;
      try { const b = (await res.json()) as { message?: string }; msg = b.message ?? msg; } catch { /* */ }
      throw new WpError(res.status, msg);
    }
    return res.json() as Promise<WpMediaItem>;
  }

  /**
   * Upload a media file from a remote URL (fetch then re-upload to WP media library).
   * Prefer uploadMediaBlob() when you have bytes from R2.
   */
  async uploadMediaFromUrl(
    imageUrl: string,
    filename: string,
    altText = '',
  ): Promise<WpMediaItem> {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new WpError(imgRes.status, `Failed to fetch image: ${imageUrl}`);
    return this.uploadMediaBlob(await imgRes.blob(), filename, altText);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory — build a client from a ClientRow (supports both old and new fields)
// ─────────────────────────────────────────────────────────────────────────────

export function buildWordPressClient(client: {
  wp_base_url?:              string | null;
  wp_url?:                   string | null;
  wp_rest_base?:             string | null;
  wp_username?:              string | null;
  wp_application_password?:  string | null;
  wp_auth?:                  string | null;
}): WordPressClient | null {
  // Derive base URL — prefer new wp_base_url, fall back to stripping wp_url
  const baseUrl =
    client.wp_base_url?.trim() ||
    (client.wp_url ? stripRestPath(client.wp_url) : null);

  if (!baseUrl) return null;

  let username: string;
  let password: string;

  if (client.wp_username?.trim() && client.wp_application_password?.trim()) {
    username = client.wp_username.trim();
    password = client.wp_application_password.trim();
  } else if (client.wp_auth?.trim()) {
    // Legacy: base64-encoded "username:app_password"
    try {
      const decoded = atob(client.wp_auth.trim());
      const colon = decoded.indexOf(':');
      if (colon < 1) return null;
      username = decoded.slice(0, colon);
      password = decoded.slice(colon + 1);
    } catch {
      return null;
    }
  } else {
    return null;
  }

  return new WordPressClient({
    baseUrl,
    restBase: client.wp_rest_base?.trim() || '/wp-json/wp/v2',
    username,
    applicationPassword: password,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Template token replacement system
// Supported tokens: {{title}}, {{content}}, {{excerpt}}, {{keyword}},
//   {{meta_description}}, {{client_name}}, {{cta}}, {{phone}}, {{primary_color}}
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateTokens {
  title?:            string;
  content?:          string;
  excerpt?:          string;
  keyword?:          string;
  meta_description?: string;
  client_name?:      string;
  cta?:              string;
  phone?:            string;
  primary_color?:    string;
  [key: string]:     string | undefined;
}

export function renderTemplate(html: string, tokens: TemplateTokens): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => tokens[key] ?? '');
}

function stripRestPath(wpUrl: string): string {
  // 'https://example.com/wp-json/wp/v2' → 'https://example.com'
  return wpUrl.replace(/\/wp-json.*$/, '').replace(/\/$/, '');
}
