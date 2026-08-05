/**
 * WordPress REST API client — per-client application password authentication
 * Each client stores their own WP credentials in the clients table.
 */
import type { BlogTemplateConfig } from '../modules/blog-templates';

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
  media_details?: {
    sizes?: Record<string, { source_url?: string; width?: number; height?: number }>;
    width?: number;
    height?: number;
  };
}

export type BusinessTemplateKey =
  | 'builders-remodeling'
  | 'roofing'
  | 'locksmith'
  | 'accounting'
  | 'agency-marketing'
  | 'landscaping'
  | 'beauty'
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

export function withWordPressBlogChrome(html: string): string {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').trim();
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

  /**
   * List published pages + posts as internal-link candidates (URL + title).
   * Used to auto-build each client's internal-link library. Best-effort per
   * type: a failure on one collection doesn't drop the other.
   */
  async listSiteLinks(opts: { pageLimit?: number; postLimit?: number } = {}): Promise<Array<{ id: number; url: string; title: string; slug: string; type: 'page' | 'post' }>> {
    const pageLimit = Math.min(opts.pageLimit ?? 100, 100);
    const postLimit = Math.min(opts.postLimit ?? 50, 100);
    type WpLinkItem = { id: number; link: string; slug: string; title?: { rendered?: string } };
    const collect = async (path: string, type: 'page' | 'post') => {
      try {
        const rows = await this.request<WpLinkItem[]>(path);
        return rows
          .filter((row) => row?.link)
          .map((row) => ({ id: row.id, url: row.link, title: row.title?.rendered ?? '', slug: row.slug ?? '', type }));
      } catch {
        return [] as Array<{ id: number; url: string; title: string; slug: string; type: 'page' | 'post' }>;
      }
    };
    const [pages, posts] = await Promise.all([
      collect(`/pages?per_page=${pageLimit}&status=publish&orderby=menu_order&order=asc&_fields=id,link,slug,title`, 'page'),
      collect(`/posts?per_page=${postLimit}&status=publish&orderby=date&order=desc&_fields=id,link,slug,title`, 'post'),
    ]);
    return [...pages, ...posts];
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
  let baseUrl =
    client.wp_base_url?.trim() ||
    (client.wp_url ? stripRestPath(client.wp_url) : null);

  if (!baseUrl) return null;

  // Ensure a scheme — stored base URLs sometimes omit https:// (e.g.
  // "caliviewbuilders.com"), which makes WordPress REST URL construction throw
  // "Invalid URL". Default to https when no scheme is present.
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl.replace(/^\/+/, '')}`;

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
    case 'landscaping':
      return {
        eyebrow: 'Landscape Field Guide',
        supportTitle: 'Outdoor Decisions That Last',
        supportBody: 'Climate-aware design notes, material guidance, and practical planning for healthier outdoor spaces.',
        footerTitle: 'Plan A Better Outdoor Space',
        ctaKicker: 'Talk With The Landscape Team',
      };
    case 'beauty':
      return {
        eyebrow: 'Beauty Preparation',
        supportTitle: 'Look Ready, Feel Prepared',
        supportBody: 'Event-ready guidance on timing, skin preparation, inspiration, and the details that affect the final look.',
        footerTitle: 'Prepare With Confidence',
        ctaKicker: 'Talk With The Artist',
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

function enhanceImageHtml(imageHtml: string, variant: 'featured' | 'body' = 'body'): string {
  if (!imageHtml) return '';
  const imageStyle = inlineStyle({
    display: 'block',
    width: '100%',
    height: variant === 'featured' ? '100%' : 'auto',
    minHeight: variant === 'featured' ? '320px' : undefined,
    objectFit: variant === 'featured' ? 'cover' : 'contain',
    objectPosition: 'center',
  });
  return imageHtml.replace(/<img\b([^>]*)>/i, (_full, attrs: string) => {
    const cleanAttrs = attrs
      .replace(/\sloading="[^"]*"/i, '')
      .replace(/\sdecoding="[^"]*"/i, '')
      .replace(/\sstyle="[^"]*"/i, '')
      .replace(/\ssizes="[^"]*"/i, '');
    return `<img${cleanAttrs} loading="lazy" decoding="async" sizes="(max-width: 760px) 100vw, 760px" style="${imageStyle}">`;
  });
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
  if (/landscap|garden|outdoor|lawn/.test(raw)) return 'landscaping';
  if (/makeup|beauty|cosmetic|artist/.test(raw)) return 'beauty';
  if (/etb|elite team builders|builder|remodel|renovat|construction|kitchen|bathroom/.test(raw)) return 'builders-remodeling';
  if (/roof/.test(raw)) return 'roofing';
  if (/locksmith|lock|key/.test(raw)) return 'locksmith';
  if (/account|tax|bookkeep|cpa|finance/.test(raw)) return 'accounting';
  if (/agency|marketing|seo|advertis|branding/.test(raw)) return 'agency-marketing';
  return 'generic-service';
}

function resolveTemplateProfile(input: {
  templateKey: BusinessTemplateKey;
  template?: BlogTemplateConfig;
  clientName: string;
  industry?: string | null;
  primaryColor: string;
  accentColor?: string;
}): BlogTemplateConfig {
  const chrome = getTemplateChrome(input.templateKey);
  return {
    key: input.templateKey,
    label: input.template?.label ?? chrome.eyebrow,
    industryLabel: input.template?.industryLabel ?? input.industry ?? 'Professional Service',
    audience: input.template?.audience ?? 'local customers comparing service options and next steps',
    tone: input.template?.tone ?? 'professional, clear, practical',
    authorLabel: input.template?.authorLabel ?? input.clientName,
    categoryLabel: input.template?.categoryLabel ?? chrome.eyebrow,
    primaryColor: input.template?.primaryColor ?? input.primaryColor,
    accentColor: input.template?.accentColor ?? input.accentColor,
    quickFacts: input.template?.quickFacts?.length ? input.template.quickFacts : ['Service focus', 'Local context', 'Practical next steps'],
    relatedServices: input.template?.relatedServices?.length ? input.template.relatedServices : [input.industry ?? 'Professional services'],
    shareTitle: input.template?.shareTitle ?? `${input.clientName} article`,
  };
}

function formatBlogDate(value: string | null | undefined): string {
  if (!value) return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function renderStructuredBlogHtml(input: {
  templateKey: BusinessTemplateKey;
  primaryColor: string;
  accentColor?: string;
  clientName: string;
  clientSlug?: string;
  industry?: string | null;
  publishDate?: string | null;
  phone?: string | null;
  ctaDefault?: string | null;
  template?: BlogTemplateConfig;
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
  const chrome = getTemplateChrome(input.templateKey);
  const ctaHref = input.phone ? `tel:${input.phone}` : '#contact';
  const primaryColor = normalizePrimaryColor(input.primaryColor);
  const profile = resolveTemplateProfile({
    templateKey: input.templateKey,
    template: input.template,
    clientName: input.clientName,
    industry: input.industry,
    primaryColor,
    accentColor: input.accentColor,
  });
  const accentColor = normalizePrimaryColor(profile.accentColor ?? input.accentColor ?? primaryColor);
  const publishedDate = formatBlogDate(input.publishDate);

  const slot1Html = input.bodyImages?.slot1 ?? input.bodyImageHtml ?? BLOG_BODY_IMAGE_1_PLACEHOLDER;
  const slot2Html = input.bodyImages?.slot2 ?? BLOG_BODY_IMAGE_2_PLACEHOLDER;
  const slot3Html = input.bodyImages?.slot3 ?? BLOG_BODY_IMAGE_3_PLACEHOLDER;

  const wrapFigure = (imageHtml: string, variant: 'featured' | 'body' = 'body'): string => {
    if (!imageHtml) return '';
    return `<figure class="wx-blog-body-image" style="${inlineStyle({
      margin: variant === 'featured' ? '0 0 28px' : '0 0 24px',
      border: '1px solid #d9e1ea',
      borderRadius: variant === 'featured' ? '18px' : '16px',
      overflow: 'hidden',
      background: '#ffffff',
      aspectRatio: variant === 'featured' ? '16/9' : undefined,
    })}">${enhanceImageHtml(imageHtml, variant)}</figure>`;
  };
  const slot1Section = wrapFigure(slot1Html, 'featured');
  const slot2Section = wrapFigure(slot2Html);
  const slot3Section = wrapFigure(slot3Html);
  const quickFactsHtml = profile.quickFacts.map((fact) => `<li style="${inlineStyle({ margin: '0 0 10px', paddingLeft: '0' })}">${escapeHtml(fact)}</li>`).join('');
  const relatedServicesHtml = profile.relatedServices.map((service) => `<span style="${inlineStyle({
    display: 'inline-block',
    padding: '7px 10px',
    border: `1px solid ${withAlpha(primaryColor, '33')}`,
    borderRadius: '999px',
    color: '#132033',
    background: '#ffffff',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '.84rem',
    lineHeight: '1',
    margin: '0 6px 8px 0',
  })}">${escapeHtml(service)}</span>`).join('');
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
        <div class="wx-blog-meta" style="${inlineStyle({
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 18px',
          marginTop: '22px',
          color: '#5b6678',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '.92rem',
        })}">
          <span>${escapeHtml(profile.authorLabel)}</span>
          <span>${escapeHtml(publishedDate)}</span>
          <span>${escapeHtml(profile.categoryLabel)}</span>
        </div>
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
          <section class="wx-blog-keyword-box" style="${inlineStyle({
            margin: '0 0 20px',
            padding: '22px 24px',
            borderRadius: '16px',
            border: `1px solid ${withAlpha(accentColor, '55')}`,
            background: `linear-gradient(135deg, ${withAlpha(accentColor, '12')}, #ffffff)`,
          })}">
            <div style="${inlineStyle({ color: accentColor, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', fontWeight: '700', letterSpacing: '.12em', textTransform: 'uppercase', margin: '0 0 10px' })}">Keyword Focus</div>
            <strong style="${inlineStyle({ display: 'block', color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1.05rem', lineHeight: '1.35', margin: '0 0 8px' })}">${escapeHtml(input.blog.focusKeyword)}</strong>
            <p style="${inlineStyle({ margin: '0', color: '#5b6678', fontSize: '.92rem', lineHeight: '1.65' })}">${escapeHtml(profile.industryLabel)} article for ${escapeHtml(profile.audience)}.</p>
          </section>
          <section class="wx-blog-quick-info" style="${inlineStyle({
            margin: '0 0 20px',
            padding: '22px 24px',
            borderRadius: '16px',
            background: '#ffffff',
            border: '1px solid #d9e1ea',
          })}">
            <h3 style="${inlineStyle({ color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1rem', lineHeight: '1.3', margin: '0 0 12px' })}">Quick Information</h3>
            <ul style="${inlineStyle({ listStyle: 'none', padding: '0', margin: '0', color: '#132033', fontSize: '.94rem', lineHeight: '1.55' })}">${quickFactsHtml}</ul>
          </section>
          <section class="wx-blog-related-services" style="${inlineStyle({
            margin: '0 0 20px',
            padding: '22px 24px',
            borderRadius: '16px',
            background: withAlpha(primaryColor, '08'),
            border: '1px solid #d9e1ea',
          })}">
            <h3 style="${inlineStyle({ color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1rem', lineHeight: '1.3', margin: '0 0 12px' })}">Related Services</h3>
            <div>${relatedServicesHtml}</div>
          </section>
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
          <div class="wx-blog-share-meta" data-share-title="${escapeHtml(profile.shareTitle)}" data-share-keyword="${escapeHtml(input.blog.focusKeyword)}" data-share-client="${escapeHtml(input.clientName)}" style="${inlineStyle({ display: 'none' })}"></div>
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

function replaceFirstPlaceholderOnly(html: string, placeholder: string, value: string): string {
  let used = false;
  return html.split(placeholder).reduce((acc, part, idx) => {
    if (idx === 0) return part;
    if (!used) {
      used = true;
      return `${acc}${value}${part}`;
    }
    return `${acc}${part}`;
  }, '');
}

/**
 * Inject up to three body images at their numbered placeholders.
 * Missing images resolve to empty string so placeholders never leak to WP.
 * Repeated placeholders are cleared after the first use to avoid duplicated
 * images in regenerated or repaired blog HTML.
 */
export function injectBodyImagesIntoHtml(
  html: string,
  images: { slot1?: string; slot2?: string; slot3?: string },
): string {
  return [
    [BLOG_BODY_IMAGE_1_PLACEHOLDER, images.slot1 ?? ''],
    [BLOG_BODY_IMAGE_2_PLACEHOLDER, images.slot2 ?? ''],
    [BLOG_BODY_IMAGE_3_PLACEHOLDER, images.slot3 ?? ''],
    [BLOG_BODY_IMAGE_PLACEHOLDER,   images.slot1 ?? ''],
  ].reduce((acc, [placeholder, value]) => replaceFirstPlaceholderOnly(acc, placeholder, value), html);
}

function stripRestPath(wpUrl: string): string {
  // 'https://example.com/wp-json/wp/v2' → 'https://example.com'
  return wpUrl.replace(/\/wp-json.*$/, '').replace(/\/$/, '');
}
