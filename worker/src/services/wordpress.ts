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
  featured_media?: number;
  meta?: Record<string, unknown>;
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

export type BusinessTemplateKey =
  | 'builders-remodeling'
  | 'roofing'
  | 'locksmith'
  | 'accounting'
  | 'agency-marketing'
  | 'generic-service';

export interface BlogSection {
  heading: string;
  html: string;
}

export interface BlogFaqItem {
  question: string;
  answer: string;
}

export interface StructuredBlogContent {
  title: string;
  excerpt: string;
  focusKeyword: string;
  secondaryKeywords?: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  intro: string;
  sections: BlogSection[];
  faq: BlogFaqItem[];
  ctaHeading: string;
  ctaBody: string;
  ctaButtonLabel: string;
  imagePrompt?: string;
}

export const BLOG_BODY_IMAGE_PLACEHOLDER = '<!-- BLOG_BODY_IMAGE -->';

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

  async getPost(postId: number): Promise<WpPost> {
    return this.request<WpPost>(`/posts/${postId}?context=edit`);
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
    slug:     string;
    featured_media: number;
    meta:     Record<string, unknown>;
  }>): Promise<WpPost> {
    return this.request<WpPost>(`/posts/${postId}`, {
      method: 'POST',
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeHtmlBlock(value: string): string {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '');
}

function renderFaqSection(faq: BlogFaqItem[]): string {
  if (!faq.length) return '';
  return `
    <section class="wx-blog-faq">
      <h2>Frequently Asked Questions</h2>
      ${faq.map((item) => `
        <div class="wx-blog-faq-item">
          <h3>${escapeHtml(item.question)}</h3>
          <p>${escapeHtml(item.answer)}</p>
        </div>
      `).join('')}
    </section>
  `;
}

function renderSections(sections: BlogSection[]): string {
  return sections.map((section) => `
    <section class="wx-blog-section">
      <h2>${escapeHtml(section.heading)}</h2>
      <div class="wx-blog-section-body">${sanitizeHtmlBlock(section.html)}</div>
    </section>
  `).join('');
}

function getTemplateChrome(templateKey: BusinessTemplateKey): {
  eyebrow: string;
  supportTitle: string;
  supportBody: string;
  footerTitle: string;
} {
  switch (templateKey) {
    case 'builders-remodeling':
      return {
        eyebrow: 'Remodeling Insights',
        supportTitle: 'What Homeowners Should Know',
        supportBody: 'Clear guidance, practical planning tips, and design-forward ideas for your next renovation.',
        footerTitle: 'Plan Your Next Improvement With Confidence',
      };
    case 'roofing':
      return {
        eyebrow: 'Roofing Guide',
        supportTitle: 'Protecting Your Property',
        supportBody: 'Preventive advice, repair indicators, and decision-making support for roof performance and longevity.',
        footerTitle: 'Stay Ahead Of Roofing Problems',
      };
    case 'locksmith':
      return {
        eyebrow: 'Security Tips',
        supportTitle: 'Fast, Reliable Access Support',
        supportBody: 'Practical lock, key, and access advice focused on safety, convenience, and local response.',
        footerTitle: 'Security Guidance You Can Use Today',
      };
    case 'accounting':
      return {
        eyebrow: 'Accounting Insights',
        supportTitle: 'Clarity For Business Decisions',
        supportBody: 'Useful explanations and actionable financial guidance for owners who want better visibility and control.',
        footerTitle: 'Stay Organized And Informed',
      };
    case 'agency-marketing':
      return {
        eyebrow: 'Marketing Perspective',
        supportTitle: 'Strategy That Supports Growth',
        supportBody: 'Clear, informative content focused on visibility, demand generation, and practical next steps.',
        footerTitle: 'Build A Stronger Marketing Foundation',
      };
    default:
      return {
        eyebrow: 'Professional Insights',
        supportTitle: 'Helpful Guidance From A Trusted Team',
        supportBody: 'Educational, practical information designed to help readers make better service decisions.',
        footerTitle: 'Helpful Information For Your Next Step',
      };
  }
}

function getTemplateCss(primaryColor: string): string {
  return `
    .wx-blog {
      --wx-primary: ${primaryColor};
      --wx-primary-soft: ${primaryColor}16;
      --wx-text: #132033;
      --wx-muted: #5b6678;
      --wx-border: #d9e1ea;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--wx-text);
      line-height: 1.7;
      max-width: 840px;
      margin: 0 auto;
    }
    .wx-blog * { box-sizing: border-box; }
    .wx-blog-hero {
      background: linear-gradient(140deg, ${primaryColor}12 0%, #ffffff 55%, ${primaryColor}08 100%);
      border: 1px solid var(--wx-border);
      border-radius: 18px;
      padding: 36px 34px 30px;
      margin: 0 0 28px;
    }
    .wx-blog-eyebrow {
      display: inline-block;
      font: 700 12px/1.2 Arial, sans-serif;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--wx-primary);
      margin: 0 0 12px;
    }
    .wx-blog h1, .wx-blog h2, .wx-blog h3 {
      color: #0f172a;
      line-height: 1.2;
      margin: 0 0 14px;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
    .wx-blog h1 { font-size: 2.2rem; }
    .wx-blog h2 { font-size: 1.45rem; margin-top: 32px; }
    .wx-blog h3 { font-size: 1.1rem; margin-top: 22px; }
    .wx-blog p, .wx-blog li { font-size: 1.04rem; color: var(--wx-text); }
    .wx-blog ul, .wx-blog ol { padding-left: 1.2rem; }
    .wx-blog-excerpt { color: var(--wx-muted); font-size: 1rem; margin: 10px 0 0; }
    .wx-blog-intro {
      background: #ffffff;
      border: 1px solid var(--wx-border);
      border-radius: 14px;
      padding: 24px 26px;
      margin: 0 0 24px;
    }
    .wx-blog-body-image {
      margin: 22px 0 28px;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid var(--wx-border);
      background: #fff;
    }
    .wx-blog-body-image img {
      display: block;
      width: 100%;
      height: auto;
    }
    .wx-blog-body-image figcaption {
      font: 400 0.88rem/1.5 Arial, sans-serif;
      color: var(--wx-muted);
      padding: 10px 14px 12px;
    }
    .wx-blog-support {
      margin: 0 0 28px;
      padding: 22px 24px;
      border-left: 4px solid var(--wx-primary);
      background: var(--wx-primary-soft);
      border-radius: 0 14px 14px 0;
    }
    .wx-blog-cta {
      margin: 34px 0;
      padding: 24px 26px;
      border-radius: 16px;
      background: linear-gradient(135deg, var(--wx-primary-soft), #ffffff);
      border: 1px solid var(--wx-border);
    }
    .wx-blog-cta a {
      display: inline-block;
      margin-top: 8px;
      padding: 12px 20px;
      border-radius: 999px;
      text-decoration: none;
      background: var(--wx-primary);
      color: #ffffff;
      font: 600 0.95rem/1 Arial, sans-serif;
    }
    .wx-blog-faq-item {
      border-top: 1px solid var(--wx-border);
      padding-top: 16px;
      margin-top: 16px;
    }
    .wx-blog-footer {
      margin-top: 36px;
      padding-top: 20px;
      border-top: 1px solid var(--wx-border);
      color: var(--wx-muted);
      font: 400 0.95rem/1.7 Arial, sans-serif;
    }
  `;
}

export function inferBusinessTemplateKey(client: {
  wp_template_key?: string | null;
  industry?: string | null;
}): BusinessTemplateKey {
  const raw = `${client.wp_template_key ?? ''} ${client.industry ?? ''}`.toLowerCase();
  if (/builder|remodel|renovat|construction|kitchen|bathroom/.test(raw)) return 'builders-remodeling';
  if (/roof/.test(raw)) return 'roofing';
  if (/locksmith|lock|key/.test(raw)) return 'locksmith';
  if (/account|tax|bookkeep|cpa|finance/.test(raw)) return 'accounting';
  if (/agency|marketing|seo|advertis|branding/.test(raw)) return 'agency-marketing';
  return 'generic-service';
}

export function renderStructuredBlogHtml(input: {
  templateKey: BusinessTemplateKey;
  primaryColor: string;
  clientName: string;
  phone?: string | null;
  ctaDefault?: string | null;
  bodyImageHtml?: string;
  blog: StructuredBlogContent;
}): string {
  const chrome = getTemplateChrome(input.templateKey);
  const ctaHref = input.phone ? `tel:${input.phone}` : '#contact';
  const bodyImageHtml = input.bodyImageHtml ?? BLOG_BODY_IMAGE_PLACEHOLDER;
  const faqHtml = renderFaqSection(input.blog.faq);
  return `
    <style>${getTemplateCss(input.primaryColor)}</style>
    <article class="wx-blog">
      <header class="wx-blog-hero">
        <div class="wx-blog-eyebrow">${chrome.eyebrow}</div>
        <h1>${escapeHtml(input.blog.title)}</h1>
        <p class="wx-blog-excerpt">${escapeHtml(input.blog.excerpt)}</p>
      </header>
      <section class="wx-blog-intro">
        <p>${escapeHtml(input.blog.intro)}</p>
      </section>
      <figure class="wx-blog-body-image">${bodyImageHtml}</figure>
      <aside class="wx-blog-support">
        <h3>${chrome.supportTitle}</h3>
        <p>${chrome.supportBody}</p>
      </aside>
      ${renderSections(input.blog.sections)}
      ${faqHtml}
      <section class="wx-blog-cta">
        <h2>${escapeHtml(input.blog.ctaHeading)}</h2>
        <p>${escapeHtml(input.blog.ctaBody)}</p>
        <a href="${ctaHref}">${escapeHtml(input.blog.ctaButtonLabel || input.ctaDefault || 'Contact Us Today')}</a>
      </section>
      <footer class="wx-blog-footer">
        <strong>${chrome.footerTitle}</strong>
        <p>${escapeHtml(input.clientName)} provides service-specific guidance focused on informed decisions, clear expectations, and practical next steps.</p>
      </footer>
    </article>
  `;
}

export function injectBodyImageIntoHtml(html: string, imageHtml: string): string {
  if (!imageHtml) return html;
  if (html.includes(BLOG_BODY_IMAGE_PLACEHOLDER)) {
    return html.replace(BLOG_BODY_IMAGE_PLACEHOLDER, imageHtml);
  }
  const introClose = html.indexOf('</section>');
  if (introClose >= 0) {
    return `${html.slice(0, introClose + 10)}\n${imageHtml}\n${html.slice(introClose + 10)}`;
  }
  return `${imageHtml}\n${html}`;
}

function stripRestPath(wpUrl: string): string {
  // 'https://example.com/wp-json/wp/v2' → 'https://example.com'
  return wpUrl.replace(/\/wp-json.*$/, '').replace(/\/$/, '');
}
