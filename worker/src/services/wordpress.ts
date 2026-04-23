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
  conclusion?: string;
  ctaHeading: string;
  ctaBody: string;
  ctaButtonLabel: string;
  imagePrompt?: string;
}

export const BLOG_BODY_IMAGE_PLACEHOLDER   = '<!-- BLOG_BODY_IMAGE -->';
export const BLOG_BODY_IMAGE_1_PLACEHOLDER = '<!-- BLOG_BODY_IMAGE_1 -->';
export const BLOG_BODY_IMAGE_2_PLACEHOLDER = '<!-- BLOG_BODY_IMAGE_2 -->';
export const BLOG_BODY_IMAGE_3_PLACEHOLDER = '<!-- BLOG_BODY_IMAGE_3 -->';

export interface BlogBodyImageSlot {
  html?: string;  // <figure>...</figure> or '' when no image available
}

const WORDPRESS_BLOG_CHROME = `<style>
.page-header,
.page-header .entry-title {
  display: none !important;
}
.wx-blog {
  box-sizing: border-box;
}
.wx-blog *,
.wx-blog *::before,
.wx-blog *::after {
  box-sizing: border-box;
}
.wx-blog img {
  display: block;
  width: 100%;
  height: auto;
}
.wx-blog .wx-blog-body-image figcaption {
  margin: 0;
  padding: 12px 16px;
  color: #5b6678;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 0.88rem;
  line-height: 1.5;
}
.wx-blog .wx-blog-section-body p,
.wx-blog .wx-blog-section-body ul,
.wx-blog .wx-blog-section-body ol {
  margin: 0 0 1.05em;
}
.wx-blog .wx-blog-section-body ul,
.wx-blog .wx-blog-section-body ol {
  padding-left: 1.25rem;
}
.wx-blog .wx-blog-section-body li + li {
  margin-top: 0.45rem;
}
@media (max-width: 900px) {
  .wx-blog {
    padding: 0 16px 40px !important;
  }
  .wx-blog .wx-blog-hero {
    padding: 34px 24px 28px !important;
    margin-bottom: 24px !important;
  }
  .wx-blog .wx-blog-hero h1 {
    font-size: 2.45rem !important;
    max-width: none !important;
  }
  .wx-blog .wx-blog-layout {
    gap: 24px !important;
  }
  .wx-blog .wx-blog-main,
  .wx-blog .wx-blog-rail {
    flex: 1 1 100% !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;
  }
}
@media (max-width: 640px) {
  .wx-blog .wx-blog-hero {
    border-radius: 18px !important;
    padding: 28px 18px 24px !important;
  }
  .wx-blog .wx-blog-hero h1 {
    font-size: 2rem !important;
    line-height: 1.06 !important;
  }
  .wx-blog .wx-blog-intro,
  .wx-blog .wx-blog-support,
  .wx-blog .wx-blog-cta {
    padding: 20px 18px !important;
  }
  .wx-blog .wx-blog-section h2,
  .wx-blog .wx-blog-cta h2 {
    font-size: 1.5rem !important;
  }
}
</style>`;

export function withWordPressBlogChrome(html: string): string {
  if (!html.trim()) return WORDPRESS_BLOG_CHROME;
  if (html.includes('.page-header') || html.includes('class="wx-blog"')) {
    return `${WORDPRESS_BLOG_CHROME}\n${html}`;
  }
  return `${WORDPRESS_BLOG_CHROME}\n${html}`;
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

  async getPost(postId: number): Promise<WpPost> {
    return this.request<WpPost>(`/posts/${postId}?context=edit`);
  }

  async findPostsBySlug(slug: string): Promise<WpPost[]> {
    const safeSlug = encodeURIComponent(slug.trim());
    return this.request<WpPost[]>(`/posts?slug=${safeSlug}&context=edit&per_page=20&status=any`);
  }

  async getMedia(mediaId: number): Promise<WpMediaItem> {
    return this.request<WpMediaItem>(`/media/${mediaId}?context=edit`);
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
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '');
}

function getTemplateChrome(templateKey: BusinessTemplateKey): {
  eyebrow: string;
  supportTitle: string;
  supportBody: string;
  footerTitle: string;
  ctaKicker: string;
} {
  switch (templateKey) {
    case 'builders-remodeling':
      return {
        eyebrow: 'Remodeling Insights',
        supportTitle: 'What Homeowners Should Know',
        supportBody: 'Clear guidance, practical planning tips, and design-forward ideas for your next renovation.',
        footerTitle: 'Plan Your Next Improvement With Confidence',
        ctaKicker: 'Talk With The Remodeling Team',
      };
    case 'roofing':
      return {
        eyebrow: 'Roofing Guide',
        supportTitle: 'Protecting Your Property',
        supportBody: 'Preventive advice, repair indicators, and decision-making support for roof performance and longevity.',
        footerTitle: 'Stay Ahead Of Roofing Problems',
        ctaKicker: 'Talk With The Roofing Team',
      };
    case 'locksmith':
      return {
        eyebrow: 'Security Tips',
        supportTitle: 'Fast, Reliable Access Support',
        supportBody: 'Practical lock, key, and access advice focused on safety, convenience, and local response.',
        footerTitle: 'Security Guidance You Can Use Today',
        ctaKicker: 'Need Immediate Help?',
      };
    case 'accounting':
      return {
        eyebrow: 'Accounting Insights',
        supportTitle: 'Clarity For Business Decisions',
        supportBody: 'Useful explanations and actionable financial guidance for owners who want better visibility and control.',
        footerTitle: 'Stay Organized And Informed',
        ctaKicker: 'Talk With The Accounting Team',
      };
    case 'agency-marketing':
      return {
        eyebrow: 'Marketing Perspective',
        supportTitle: 'Strategy That Supports Growth',
        supportBody: 'Clear, informative content focused on visibility, demand generation, and practical next steps.',
        footerTitle: 'Build A Stronger Marketing Foundation',
        ctaKicker: 'Talk With The Marketing Team',
      };
    default:
      return {
        eyebrow: 'Professional Insights',
        supportTitle: 'Helpful Guidance From A Trusted Team',
        supportBody: 'Educational, practical information designed to help readers make better service decisions.',
        footerTitle: 'Helpful Information For Your Next Step',
        ctaKicker: 'Talk With Our Team',
      };
  }
}

function decodeHtmlEntities(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    const next = current
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    if (next === current) break;
    current = next;
  }
  return current;
}

function normalizePrimaryColor(primaryColor: string): string {
  const match = primaryColor.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return '#1a73e8';
  const hex = match[1];
  if (hex.length === 3) {
    return `#${hex.split('').map((char) => `${char}${char}`).join('')}`;
  }
  return `#${hex.toLowerCase()}`;
}

function withAlpha(hex: string, alphaHex: string): string {
  return `${normalizePrimaryColor(hex)}${alphaHex}`;
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function inlineStyle(style: Record<string, string | null | undefined>): string {
  return Object.entries(style)
    .filter(([, value]) => value)
    .map(([key, value]) => `${toKebabCase(key)}:${value}`)
    .join(';');
}

function stripTemplateArtifacts(html: string): string {
  return html
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/^\s*\.(wx-blog|wx-blog-[\w-]+)[\s\S]*?(?=<article\b|$)/i, '')
    .trim();
}

function removeCssArtifactText(value: string): string {
  return value
    .replace(/\.wx-blog\s*\{[\s\S]*?\.wx-blog-footer\s*\{[\s\S]*?\}\s*/gi, ' ')
    .replace(/\.wx-blog\s*\*\s*\{[\s\S]*?\}\s*/gi, ' ');
}

function stripWxBlogChrome(value: string): string {
  return value
    .replace(/<header[^>]*class="[^"]*wx-blog-hero[^"]*"[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<section[^>]*class="[^"]*wx-blog-intro[^"]*"[^>]*>[\s\S]*?<\/section>/gi, '')
    .replace(/<figure[^>]*class="[^"]*wx-blog-body-image[^"]*"[^>]*>[\s\S]*?<\/figure>/gi, '')
    .replace(/<aside[^>]*class="[^"]*wx-blog-support[^"]*"[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<section[^>]*class="[^"]*wx-blog-cta[^"]*"[^>]*>[\s\S]*?<\/section>/gi, '')
    .replace(/<footer[^>]*class="[^"]*wx-blog-footer[^"]*"[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<section[^>]*class="[^"]*wx-blog-faq[^"]*"[^>]*>[\s\S]*?<\/section>/gi, '')
    .replace(/<\/?(?:article|main)\b[^>]*>/gi, '')
    .replace(/<\/?(?:header|section|div|aside|footer|figure)\b[^>]*class="[^"]*wx-blog[^"]*"[^>]*>/gi, '')
    .replace(/<\/(?:section|article|aside|header|footer|figure)>/gi, '');
}

function inferEtbEyebrow(blog: StructuredBlogContent): string {
  const raw = `${blog.focusKeyword} ${blog.title}`.toLowerCase();
  if (/\bkitchen\b/.test(raw)) return 'KITCHEN DESIGN';
  if (/\bbath(room)?\b|tile|shower|vanity/.test(raw)) return 'BATHROOM DESIGN';
  if (/\badu\b|addition|extension/.test(raw)) return 'HOME ADDITIONS';
  if (/\boutdoor\b|deck|patio/.test(raw)) return 'OUTDOOR LIVING';
  return 'LUXURY REMODELS';
}

function renderEtbImageBlock(imageHtml: string, prompt: string): string {
  if (imageHtml) {
    return `<!-- Image Prompt: ${escapeHtml(prompt)} -->
      <figure class="wx-blog-body-image image-block image-block--filled">${imageHtml}</figure>`;
  }
  return `<!-- Image Prompt: ${escapeHtml(prompt)} -->
    <div class="image-block">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
      <p><strong>Image Prompt:</strong> ${escapeHtml(prompt)}</p>
    </div>`;
}

function extractImageSrc(imageHtml: string): string | null {
  const match = imageHtml.match(/<img\b[^>]*\ssrc="([^"]+)"/i);
  return match?.[1] ?? null;
}

function buildEtbImagePrompt(subject: string, locationHint: string): string {
  const location = locationHint || 'Seattle';
  return `Photorealistic high-end residential remodel scene focused on ${subject}, ${location} context, minimalist luxury interior, soft natural light, clean lines, premium porcelain and stone materials, editorial architectural photography, 8k detail`;
}

function buildEtbTestimonials(blog: StructuredBlogContent): Array<{ text: string; name: string; location: string }> {
  const subject = blog.focusKeyword || blog.title;
  return [
    {
      text: `“Elite Team Builders helped us make smart design decisions around ${subject.toLowerCase()}. The finished space feels brighter, larger, and much more refined than we thought possible.”`,
      name: 'Sarah & David M.',
      location: 'Seattle, WA',
    },
    {
      text: `“We wanted a remodel that looked elevated but still functioned for daily life. Their guidance on layout, materials, and long-term durability made all the difference.”`,
      name: 'Robert T.',
      location: 'Portland, OR',
    },
    {
      text: `“Their team balanced aesthetics, craftsmanship, and practicality from the start. Every finish feels intentional, and the room now looks custom instead of cramped.”`,
      name: 'Amanda G.',
      location: 'Los Angeles, CA',
    },
  ];
}

function renderEliteTeamBuildersHtml(input: {
  clientName: string;
  phone?: string | null;
  blog: StructuredBlogContent;
  bodyImages?: { slot1?: string; slot2?: string; slot3?: string };
  bodyImageHtml?: string;
}): string {
  const slot1Html = input.bodyImages?.slot1 ?? input.bodyImageHtml ?? BLOG_BODY_IMAGE_1_PLACEHOLDER;
  const slot2Html = input.bodyImages?.slot2 ?? BLOG_BODY_IMAGE_2_PLACEHOLDER;
  const slot3Html = input.bodyImages?.slot3 ?? BLOG_BODY_IMAGE_3_PLACEHOLDER;
  const heroBackgroundUrl = extractImageSrc(slot1Html);
  const imagePrompt1 = buildEtbImagePrompt(input.blog.title, 'Seattle');
  const imagePrompt2 = buildEtbImagePrompt(input.blog.sections[1]?.heading ?? input.blog.sections[0]?.heading ?? input.blog.title, 'Pacific Northwest');
  const imagePrompt3 = buildEtbImagePrompt('finished luxury bathroom remodel with premium tile and balanced lighting', 'West Coast');
  const testimonials = buildEtbTestimonials(input.blog);
  const ctaHref = 'https://eliteteambuildersinc.com/contact-us/';
  const sectionHtml = input.blog.sections.map((section, idx) => {
    const html = `
      <section class="wx-blog-section etb-topic-section">
        <h2>${escapeHtml(section.heading)}</h2>
        <div class="wx-blog-section-body">${sanitizeHtmlBlock(section.html)}</div>
      </section>`;
    if (idx === 1) return `${html}\n${renderEtbImageBlock(slot2Html, imagePrompt2)}`;
    return html;
  }).join('\n');

  return withWordPressBlogChrome(`
    <style>
      :root {
        --brand-teal: #007a7a;
        --brand-gold: #f2b824;
        --brand-dark: #132033;
        --text-main: #334155;
        --bg-light: #f8fafc;
        --border-color: #e2e8f0;
        --white: #ffffff;
      }
      .wx-blog.etb-blog, .wx-blog.etb-blog * { box-sizing: border-box; }
      .wx-blog.etb-blog {
        max-width: 1200px;
        margin: 40px auto;
        padding: 0 20px 40px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: var(--text-main);
        background: transparent;
      }
      .wx-blog.etb-blog .hero {
        background: linear-gradient(rgba(19, 32, 51, 0.85), rgba(19, 32, 51, 0.85)), url('${escapeHtml(heroBackgroundUrl ?? 'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&q=80&w=1600')}') center/cover;
        border-radius: 24px;
        padding: 80px 40px;
        color: var(--white);
        text-align: center;
        margin-bottom: 40px;
        box-shadow: 0 20px 25px -5px rgba(0,0,0,.1);
      }
      .wx-blog.etb-blog .eyebrow {
        text-transform: uppercase;
        letter-spacing: 2px;
        font-size: .75rem;
        font-weight: 700;
        color: var(--brand-gold);
        margin-bottom: 16px;
      }
      .wx-blog.etb-blog .hero h1 {
        font-size: clamp(2rem, 5vw, 3.5rem);
        line-height: 1.1;
        max-width: 900px;
        margin: 0 auto 24px;
        font-weight: 800;
        color: #fff;
      }
      .wx-blog.etb-blog .hero-excerpt {
        font-size: 1.25rem;
        max-width: 700px;
        margin: 0 auto;
        opacity: .92;
        color: #fff;
      }
      .wx-blog.etb-blog .article-content {
        background: var(--white);
        border-radius: 20px;
        padding: 40px;
        box-shadow: 0 4px 6px -1px rgba(0,0,0,.05);
        margin-bottom: 40px;
      }
      .wx-blog.etb-blog .intro-box {
        background: #f1f5f9;
        border-left: 4px solid var(--brand-teal);
        padding: 24px;
        border-radius: 0 12px 12px 0;
        margin-bottom: 32px;
        font-style: italic;
        font-size: 1.1rem;
      }
      .wx-blog.etb-blog h2 {
        color: var(--brand-dark);
        font-size: 1.85rem;
        margin: 40px 0 20px;
        font-weight: 700;
      }
      .wx-blog.etb-blog .wx-blog-section-body p,
      .wx-blog.etb-blog .wx-blog-section-body ul,
      .wx-blog.etb-blog .wx-blog-section-body ol {
        margin-bottom: 24px;
        font-size: 1.05rem;
        line-height: 1.8;
      }
      .wx-blog.etb-blog .wx-blog-section-body ul,
      .wx-blog.etb-blog .wx-blog-section-body ol { padding-left: 1.25rem; }
      .wx-blog.etb-blog .image-block {
        margin: 40px 0;
        border-radius: 16px;
        overflow: hidden;
        background: #eef2f6;
        aspect-ratio: 16/9;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        border: 2px dashed #cbd5e1;
        color: #64748b;
        padding: 20px;
        text-align: center;
      }
      .wx-blog.etb-blog .image-block svg { width: 48px; height: 48px; margin-bottom: 12px; opacity: .5; }
      .wx-blog.etb-blog .image-block--filled {
        aspect-ratio: auto;
        display: block;
        padding: 0;
        background: #eef2f6;
        border: 0;
      }
      .wx-blog.etb-blog .testimonial-slider {
        position: relative;
        background: #f1f5f9;
        border-radius: 20px;
        padding: 40px;
        margin: 40px 0;
        overflow: hidden;
      }
      .wx-blog.etb-blog .slider-title { text-align: center; margin-bottom: 30px !important; font-size: 1.5rem !important; }
      .wx-blog.etb-blog .slide { min-width: 100%; display: none; flex-direction: column; align-items: center; text-align: center; animation: etbFadeIn .5s ease; }
      .wx-blog.etb-blog .slide.active { display: flex; }
      @keyframes etbFadeIn { from { opacity:0; transform:translateY(10px);} to { opacity:1; transform:translateY(0);} }
      .wx-blog.etb-blog .testimonial-text { font-size: 1.2rem; color: var(--brand-dark); font-style: italic; margin-bottom: 20px; max-width: 600px; }
      .wx-blog.etb-blog .client-info { display:flex; flex-direction:column; align-items:center; gap:4px; }
      .wx-blog.etb-blog .client-name { font-weight:700; color:var(--brand-teal); }
      .wx-blog.etb-blog .client-location { font-size:.85rem; color:#64748b; text-transform:uppercase; letter-spacing:1px; }
      .wx-blog.etb-blog .slider-nav { display:flex; justify-content:center; gap:12px; margin-top:24px; }
      .wx-blog.etb-blog .dot { width:10px; height:10px; background:#cbd5e1; border-radius:50%; cursor:pointer; transition:background .3s; }
      .wx-blog.etb-blog .dot.active { background:var(--brand-teal); width:24px; border-radius:10px; }
      .wx-blog.etb-blog .faq-section { margin-top:60px; padding-top:40px; border-top:2px solid var(--bg-light); }
      .wx-blog.etb-blog .faq-item { margin-bottom:24px; padding:20px; background:#f8fafc; border-radius:12px; }
      .wx-blog.etb-blog .faq-item h3 { font-size:1.1rem; color:var(--brand-dark); margin-bottom:8px; }
      .wx-blog.etb-blog .etb-cta { margin-top:40px; padding-top:30px; border-top:1px solid var(--border-color); }
      .wx-blog.etb-blog .info-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; margin-top:40px; }
      .wx-blog.etb-blog .info-card { background:var(--white); border:1px solid var(--border-color); border-radius:20px; padding:24px; box-shadow:0 4px 6px -1px rgba(0,0,0,.05); display:flex; flex-direction:column; justify-content:space-between; }
      .wx-blog.etb-blog .office-name { font-size:1.25rem; font-weight:800; color:var(--brand-dark); margin-bottom:8px; }
      .wx-blog.etb-blog .license-tag { font-size:.75rem; font-weight:700; color:var(--brand-gold); text-transform:uppercase; margin-bottom:16px; display:block; }
      .wx-blog.etb-blog .office-detail { font-size:.9rem; color:var(--text-main); margin-bottom:12px; line-height:1.5; }
      .wx-blog.etb-blog .office-detail strong { color:var(--brand-dark); display:block; margin-bottom:2px; }
      .wx-blog.etb-blog .btn { display:block; width:100%; padding:12px 20px; background:var(--brand-teal); color:#fff; text-align:center; text-decoration:none; border-radius:12px; font-weight:700; font-size:.9rem; transition:all .3s ease; margin-top:20px; }
      .wx-blog.etb-blog .btn:hover { background:#009999; transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,122,122,.2); }
      @media (max-width:1024px) { .wx-blog.etb-blog .info-grid { grid-template-columns:1fr 1fr; } }
      @media (max-width:768px) {
        .wx-blog.etb-blog .info-grid { grid-template-columns:1fr; }
        .wx-blog.etb-blog .hero { padding:60px 24px; }
        .wx-blog.etb-blog .article-content { padding:24px; }
      }
    </style>
    <article class="wx-blog etb-blog" data-wx-blog-template="builders-remodeling">
      <!-- Hero Background Image Prompt: ${escapeHtml(buildEtbImagePrompt(input.blog.title, 'Seattle luxury residential remodel context'))} -->
      <header class="wx-blog-hero hero">
        <div class="wx-blog-eyebrow eyebrow">${inferEtbEyebrow(input.blog)}</div>
        <h1>${escapeHtml(input.blog.title)}</h1>
        <p class="wx-blog-excerpt hero-excerpt">${escapeHtml(input.blog.excerpt)}</p>
      </header>
      <main class="article-content">
        <section class="wx-blog-intro intro-box">
          <p>${escapeHtml(input.blog.intro)}</p>
        </section>
        ${renderEtbImageBlock(slot1Html, imagePrompt1)}
        ${sectionHtml}
        <section class="testimonial-slider">
          <h2 class="slider-title">Recent Success Stories</h2>
          <div class="slides-container">
            ${testimonials.map((item, idx) => `
              <div class="slide${idx === 0 ? ' active' : ''}">
                <div class="testimonial-text">${escapeHtml(item.text)}</div>
                <div class="client-info">
                  <span class="client-name">${escapeHtml(item.name)}</span>
                  <span class="client-location">${escapeHtml(item.location)}</span>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="slider-nav">
            ${testimonials.map((_, idx) => `<div class="dot${idx === 0 ? ' active' : ''}" onclick="setSlide(${idx})"></div>`).join('')}
          </div>
        </section>
        <section class="wx-blog-faq faq-section">
          <h2>Frequently Asked Questions</h2>
          ${input.blog.faq.map((item) => `
            <div class="wx-blog-faq-item faq-item">
              <h3>${escapeHtml(item.question)}</h3>
              <p>${escapeHtml(item.answer)}</p>
            </div>
          `).join('')}
        </section>
        ${renderEtbImageBlock(slot3Html, imagePrompt3)}
        <section class="wx-blog-cta etb-cta">
          <p><strong>${escapeHtml(input.blog.ctaHeading)}</strong> ${escapeHtml(input.blog.ctaBody)}</p>
        </section>
      </main>
      <div class="info-grid">
        <div class="info-card">
          <div>
            <div class="office-name">Seattle Office</div>
            <span class="license-tag">Lic# ELITETB750CC</span>
            <div class="office-detail"><strong>Address:</strong>701 5th Ave, Seattle, WA, US</div>
            <div class="office-detail"><strong>Phone:</strong>+1 888-521-3549</div>
          </div>
          <a href="${ctaHref}" class="btn">Get a Free Estimate</a>
        </div>
        <div class="info-card">
          <div>
            <div class="office-name">Portland Office</div>
            <span class="license-tag">Lic# 257266</span>
            <div class="office-detail"><strong>Address:</strong>555 SE MLK Blvd, Portland, OR, US</div>
            <div class="office-detail"><strong>Phone:</strong>+1 888-521-3548</div>
          </div>
          <a href="${ctaHref}" class="btn">Get a Free Estimate</a>
        </div>
        <div class="info-card">
          <div>
            <div class="office-name">Los Angeles Office</div>
            <span class="license-tag">Lic# 1126980</span>
            <div class="office-detail"><strong>Address:</strong>640 S San Vicente Blvd, Los Angeles, CA</div>
            <div class="office-detail"><strong>Phone:</strong>+1 888-521-0559</div>
          </div>
          <a href="${ctaHref}" class="btn">Get a Free Estimate</a>
        </div>
      </div>
      <script>
        (function() {
          let currentSlide = 0;
          const root = document.currentScript && document.currentScript.closest('.etb-blog');
          if (!root) return;
          const slides = root.querySelectorAll('.slide');
          const dots = root.querySelectorAll('.dot');
          function setSlide(index) {
            if (!slides.length || !dots.length) return;
            slides[currentSlide].classList.remove('active');
            dots[currentSlide].classList.remove('active');
            currentSlide = index;
            slides[currentSlide].classList.add('active');
            dots[currentSlide].classList.add('active');
          }
          root.querySelectorAll('.dot').forEach((dot, index) => {
            dot.addEventListener('click', () => setSlide(index));
          });
          setInterval(() => {
            if (!slides.length) return;
            setSlide((currentSlide + 1) % slides.length);
          }, 6000);
        })();
      </script>
    </article>
  `);
}

function cleanExtractedText(value: string, removals: string[] = []): string {
  let cleaned = stripHtml(removeCssArtifactText(value));
  for (const removal of removals.filter(Boolean)) {
    const escaped = removal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escaped, 'ig'), ' ');
  }
  const chromePhrases = [
    'Remodeling Insights',
    'Roofing Guide',
    'Security Tips',
    'Accounting Insights',
    'Marketing Perspective',
    'Professional Insights',
    'What Homeowners Should Know',
    'Protecting Your Property',
    'Fast, Reliable Access Support',
    'Clarity For Business Decisions',
    'Strategy That Supports Growth',
    'Helpful Guidance From A Trusted Team',
    'Clear guidance, practical planning tips, and design-forward ideas for your next renovation.',
    'Preventive advice, repair indicators, and decision-making support for roof performance and longevity.',
    'Practical lock, key, and access advice focused on safety, convenience, and local response.',
    'Useful explanations and actionable financial guidance for owners who want better visibility and control.',
    'Clear, informative content focused on visibility, demand generation, and practical next steps.',
    'Educational, practical information designed to help readers make better service decisions.',
  ];
  for (const phrase of chromePhrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escaped, 'ig'), ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

function cleanExtractedHtml(value: string, removals: string[] = []): string {
  let cleaned = stripWxBlogChrome(sanitizeHtmlBlock(removeCssArtifactText(value)));
  for (const removal of removals.filter(Boolean)) {
    const escaped = removal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escaped, 'ig'), ' ');
  }
  cleaned = cleaned
    .replace(/<div[^>]*class="[^"]*wx-blog-section-body[^"]*"[^>]*>/gi, '')
    .replace(/<\/div>\s*(?=<\/section|<section|<footer|$)/gi, '')
    .replace(/<(?:\/)?(?:html|body)[^>]*>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned;
}

export function extractStructuredBlogContent(
  html: string | null | undefined,
  fallback: Omit<StructuredBlogContent, 'intro' | 'sections' | 'faq' | 'ctaHeading' | 'ctaBody' | 'ctaButtonLabel'> & {
    intro?: string;
    sections?: BlogSection[];
    faq?: BlogFaqItem[];
    ctaHeading?: string;
    ctaBody?: string;
    ctaButtonLabel?: string;
  },
): StructuredBlogContent {
  const source = stripTemplateArtifacts(html ?? '');
  const cleaned = decodeHtmlEntities(source);
  const textRemovals = [
    fallback.title,
    fallback.excerpt,
  ];

  const introMatch = cleaned.match(/<section[^>]*class="wx-blog-intro"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/section>/i);
  const excerptMatch = cleaned.match(/<p[^>]*class="wx-blog-excerpt"[^>]*>([\s\S]*?)<\/p>/i);
  const ctaHeadingMatch = cleaned.match(/<section[^>]*class="wx-blog-cta"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const ctaBodyMatch = cleaned.match(/<section[^>]*class="wx-blog-cta"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
  const ctaButtonMatch = cleaned.match(/<section[^>]*class="wx-blog-cta"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);

  const sections = [...cleaned.matchAll(/<section[^>]*class="wx-blog-section"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<div[^>]*class="wx-blog-section-body"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<\/section>/gi)]
    .map((match) => ({
      heading: cleanExtractedText(match[1] ?? ''),
      html: cleanExtractedHtml(match[2] ?? '', textRemovals),
    }))
    .filter((section) => section.heading && stripHtml(section.html));

  const faq = [...cleaned.matchAll(/<div[^>]*class="wx-blog-faq-item"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/div>/gi)]
    .map((match) => ({
      question: stripHtml(match[1] ?? ''),
      answer: stripHtml(match[2] ?? ''),
    }))
    .filter((item) => item.question && item.answer);

  const fallbackSectionHtml = cleanExtractedHtml(stripTemplateArtifacts(cleaned), textRemovals);

  return {
    title: fallback.title,
    excerpt: cleanExtractedText(excerptMatch?.[1] ?? '') || fallback.excerpt,
    focusKeyword: fallback.focusKeyword,
    secondaryKeywords: fallback.secondaryKeywords,
    seoTitle: fallback.seoTitle,
    metaDescription: fallback.metaDescription,
    slug: fallback.slug,
    intro: cleanExtractedText(introMatch?.[1] ?? '', textRemovals) || fallback.intro || fallback.excerpt || fallback.title,
    sections: sections.length
      ? sections
      : (fallback.sections && fallback.sections.length
        ? fallback.sections
        : [{ heading: fallback.title, html: fallbackSectionHtml || `<p>${escapeHtml(fallback.excerpt || fallback.title)}</p>` }]),
    faq: faq.length ? faq : (fallback.faq ?? []),
    ctaHeading: stripHtml(ctaHeadingMatch?.[1] ?? '') || fallback.ctaHeading || 'Talk With Our Team',
    ctaBody: stripHtml(ctaBodyMatch?.[1] ?? '') || fallback.ctaBody || 'Get expert guidance tailored to your needs.',
    ctaButtonLabel: stripHtml(ctaButtonMatch?.[1] ?? '') || fallback.ctaButtonLabel || 'Contact Us Today',
    imagePrompt: fallback.imagePrompt,
  };
}

export function inferBusinessTemplateKey(client: {
  wp_template_key?: string | null;
  industry?: string | null;
}): BusinessTemplateKey {
  const raw = `${client.wp_template_key ?? ''} ${client.industry ?? ''}`.toLowerCase();
  if (/etb|elite team builders|builder|remodel|renovat|construction|kitchen|bathroom/.test(raw)) return 'builders-remodeling';
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
  /** Legacy single-slot body image (slot 1 equivalent). Prefer bodyImages. */
  bodyImageHtml?: string;
  /**
   * Multi-slot body images.
   *   slot 1 — after intro (hero)
   *   slot 2 — middle of content (after 2nd section)
   *   slot 3 — before CTA / footer
   */
  bodyImages?: { slot1?: string; slot2?: string; slot3?: string };
  blog: StructuredBlogContent;
}): string {
  if (input.templateKey === 'builders-remodeling' && /elite team builders/i.test(input.clientName)) {
    return renderEliteTeamBuildersHtml(input);
  }

  const chrome = getTemplateChrome(input.templateKey);
  const ctaHref = input.phone ? `tel:${input.phone}` : '#contact';
  const primaryColor = normalizePrimaryColor(input.primaryColor);

  const slot1Html = input.bodyImages?.slot1 ?? input.bodyImageHtml ?? BLOG_BODY_IMAGE_1_PLACEHOLDER;
  const slot2Html = input.bodyImages?.slot2 ?? BLOG_BODY_IMAGE_2_PLACEHOLDER;
  const slot3Html = input.bodyImages?.slot3 ?? BLOG_BODY_IMAGE_3_PLACEHOLDER;

  const wrapFigure = (imageHtml: string): string => {
    if (!imageHtml) return '';
    return `<figure class="wx-blog-body-image" style="${inlineStyle({
      margin: '0 0 24px',
      border: '1px solid #d9e1ea',
      borderRadius: '16px',
      overflow: 'hidden',
      background: '#ffffff',
    })}">${imageHtml}</figure>`;
  };
  const slot1Section = wrapFigure(slot1Html);
  const slot2Section = wrapFigure(slot2Html);
  const slot3Section = wrapFigure(slot3Html);
  const faqHtml = input.blog.faq.length
    ? `
      <section class="wx-blog-faq" style="${inlineStyle({ margin: '32px 0 0' })}">
        <h2 style="${inlineStyle({ color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1.45rem', lineHeight: '1.2', margin: '0 0 14px' })}">Frequently Asked Questions</h2>
        ${input.blog.faq.map((item) => `
          <div class="wx-blog-faq-item" style="${inlineStyle({ borderTop: '1px solid #d9e1ea', paddingTop: '16px', marginTop: '16px' })}">
            <h3 style="${inlineStyle({ color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1.08rem', lineHeight: '1.3', margin: '0 0 10px' })}">${escapeHtml(item.question)}</h3>
            <p style="${inlineStyle({ color: '#132033', fontSize: '1rem', lineHeight: '1.75', margin: '0' })}">${escapeHtml(item.answer)}</p>
          </div>
        `).join('')}
      </section>
    `
    : '';

  const renderSection = (section: BlogSection): string => `
    <section class="wx-blog-section" style="${inlineStyle({ margin: '0 0 28px' })}">
      <h2 style="${inlineStyle({ color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1.8rem', lineHeight: '1.15', margin: '0 0 14px', letterSpacing: '-0.02em' })}">${escapeHtml(section.heading)}</h2>
      <div class="wx-blog-section-body" style="${inlineStyle({ color: '#132033', fontSize: '1rem', lineHeight: '1.75' })}">${sanitizeHtmlBlock(section.html)}</div>
    </section>
  `;
  const midInsertIndex = Math.max(1, Math.min(input.blog.sections.length - 1, 2));
  const sectionHtml = input.blog.sections.map((section, idx) => {
    const html = renderSection(section);
    return idx === midInsertIndex ? `${html}${slot2Section}` : html;
  }).join('');

  return withWordPressBlogChrome(`
    <article class="wx-blog" data-wx-blog-template="${input.templateKey}" style="${inlineStyle({
      maxWidth: '1180px',
      margin: '0 auto',
      padding: '0 24px 56px',
      color: '#132033',
      fontFamily: 'Georgia, Times New Roman, serif',
      lineHeight: '1.7',
    })}">
      <header class="wx-blog-hero" style="${inlineStyle({
        background: `linear-gradient(140deg, ${withAlpha(primaryColor, '12')} 0%, #ffffff 62%, ${withAlpha(primaryColor, '08')} 100%)`,
        border: '1px solid #d9e1ea',
        borderRadius: '22px',
        padding: '48px 44px 40px',
        margin: '0 0 30px',
      })}">
        <div class="wx-blog-eyebrow" style="${inlineStyle({
          display: 'inline-block',
          color: primaryColor,
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '12px',
          fontWeight: '700',
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          margin: '0 0 16px',
        })}">${chrome.eyebrow}</div>
        <h1 style="${inlineStyle({
          color: '#0f172a',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '3.35rem',
          lineHeight: '1.02',
          letterSpacing: '-0.04em',
          maxWidth: '14ch',
          margin: '0 0 16px',
        })}">${escapeHtml(input.blog.title)}</h1>
        <p class="wx-blog-excerpt" style="${inlineStyle({
          color: '#5b6678',
          fontSize: '1.12rem',
          lineHeight: '1.8',
          maxWidth: '58ch',
          margin: '0',
        })}">${escapeHtml(input.blog.excerpt)}</p>
      </header>
      <div class="wx-blog-layout" style="${inlineStyle({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: '42px',
      })}">
        <div class="wx-blog-main" style="${inlineStyle({
          flex: '1 1 640px',
          minWidth: '0',
          maxWidth: '760px',
        })}">
          <section class="wx-blog-intro" style="${inlineStyle({
            background: '#ffffff',
            border: '1px solid #d9e1ea',
            borderRadius: '14px',
            padding: '28px 30px',
            margin: '0 0 24px',
          })}">
            <p style="${inlineStyle({ margin: '0', fontSize: '1.08rem', lineHeight: '1.9', color: '#132033' })}">${escapeHtml(input.blog.intro)}</p>
          </section>
          ${slot1Section}
          ${sectionHtml}
          ${faqHtml}
          ${slot3Section}
          <footer class="wx-blog-footer" style="${inlineStyle({
            marginTop: '36px',
            paddingTop: '20px',
            borderTop: '1px solid #d9e1ea',
          })}">
            <strong style="${inlineStyle({ display: 'block', color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1rem', margin: '0 0 8px' })}">${chrome.footerTitle}</strong>
            <p style="${inlineStyle({ margin: '0', color: '#5b6678', fontSize: '.95rem', lineHeight: '1.7' })}">${escapeHtml(input.blog.conclusion || `${input.clientName} provides expert guidance focused on informed decisions, clear expectations, and practical next steps.`)}</p>
          </footer>
        </div>
        <aside class="wx-blog-rail" style="${inlineStyle({
          flex: '0 1 300px',
          minWidth: '260px',
          width: '300px',
        })}">
          <div class="wx-blog-support" style="${inlineStyle({
            margin: '0 0 20px',
            padding: '22px 24px',
            borderLeft: `4px solid ${primaryColor}`,
            background: withAlpha(primaryColor, '10'),
            borderRadius: '0 14px 14px 0',
          })}">
            <h3 style="${inlineStyle({ color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1.08rem', lineHeight: '1.3', margin: '0 0 8px' })}">${chrome.supportTitle}</h3>
            <p style="${inlineStyle({ margin: '0', color: '#132033', fontSize: '1rem', lineHeight: '1.75' })}">${chrome.supportBody}</p>
          </div>
          <section class="wx-blog-cta" style="${inlineStyle({
            margin: '0',
            padding: '26px 24px',
            borderRadius: '16px',
            background: `linear-gradient(135deg, ${withAlpha(primaryColor, '12')}, #ffffff)`,
            border: '1px solid #d9e1ea',
          })}">
            <div style="${inlineStyle({ color: primaryColor, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', fontWeight: '700', letterSpacing: '.12em', textTransform: 'uppercase', margin: '0 0 10px' })}">${chrome.ctaKicker}</div>
            <h2 style="${inlineStyle({ color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1.7rem', lineHeight: '1.1', letterSpacing: '-0.02em', margin: '0 0 12px' })}">${escapeHtml(input.blog.ctaHeading)}</h2>
            <p style="${inlineStyle({ margin: '0 0 16px', color: '#132033', fontSize: '0.98rem', lineHeight: '1.8' })}">${escapeHtml(input.blog.ctaBody)}</p>
            <a href="${ctaHref}" style="${inlineStyle({
              display: 'inline-block',
              padding: '12px 18px',
              borderRadius: '999px',
              textDecoration: 'none',
              background: primaryColor,
              color: '#ffffff',
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '.95rem',
              fontWeight: '600',
              lineHeight: '1',
            })}">${escapeHtml(input.blog.ctaButtonLabel || input.ctaDefault || 'Contact Us Today')}</a>
          </section>
        </aside>
      </div>
    </article>
  `);
}

export function injectBodyImageIntoHtml(html: string, imageHtml: string): string {
  if (!imageHtml) return html;
  if (html.includes(BLOG_BODY_IMAGE_1_PLACEHOLDER)) {
    return html.replace(BLOG_BODY_IMAGE_1_PLACEHOLDER, imageHtml);
  }
  if (html.includes(BLOG_BODY_IMAGE_PLACEHOLDER)) {
    return html.replace(BLOG_BODY_IMAGE_PLACEHOLDER, imageHtml);
  }
  const introClose = html.indexOf('</section>');
  if (introClose >= 0) {
    return `${html.slice(0, introClose + 10)}\n${imageHtml}\n${html.slice(introClose + 10)}`;
  }
  return `${imageHtml}\n${html}`;
}

/**
 * Inject up to three body images at their numbered placeholders.
 * Missing images resolve to empty string so placeholders never leak to WP.
 */
export function injectBodyImagesIntoHtml(
  html: string,
  images: { slot1?: string; slot2?: string; slot3?: string },
): string {
  return html
    .replace(BLOG_BODY_IMAGE_1_PLACEHOLDER, images.slot1 ?? '')
    .replace(BLOG_BODY_IMAGE_2_PLACEHOLDER, images.slot2 ?? '')
    .replace(BLOG_BODY_IMAGE_3_PLACEHOLDER, images.slot3 ?? '')
    .replace(BLOG_BODY_IMAGE_PLACEHOLDER,   images.slot1 ?? '');
}

function stripRestPath(wpUrl: string): string {
  // 'https://example.com/wp-json/wp/v2' → 'https://example.com'
  return wpUrl.replace(/\/wp-json.*$/, '').replace(/\/$/, '');
}
