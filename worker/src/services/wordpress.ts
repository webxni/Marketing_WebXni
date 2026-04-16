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
  const primaryColor = normalizePrimaryColor(input.primaryColor);
  const bodyImageHtml = input.bodyImageHtml ?? BLOG_BODY_IMAGE_PLACEHOLDER;
  const bodyImageSection = bodyImageHtml
    ? `<figure class="wx-blog-body-image" style="${inlineStyle({
      margin: '0 0 24px',
      border: '1px solid #d9e1ea',
      borderRadius: '16px',
      overflow: 'hidden',
      background: '#ffffff',
    })}">${bodyImageHtml}</figure>`
    : '';
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

  const sectionHtml = input.blog.sections.map((section) => `
    <section class="wx-blog-section" style="${inlineStyle({ margin: '0 0 28px' })}">
      <h2 style="${inlineStyle({ color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1.8rem', lineHeight: '1.15', margin: '0 0 14px', letterSpacing: '-0.02em' })}">${escapeHtml(section.heading)}</h2>
      <div class="wx-blog-section-body" style="${inlineStyle({ color: '#132033', fontSize: '1rem', lineHeight: '1.75' })}">${sanitizeHtmlBlock(section.html)}</div>
    </section>
  `).join('');

  return `
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
          ${bodyImageSection}
          ${sectionHtml}
          ${faqHtml}
          <footer class="wx-blog-footer" style="${inlineStyle({
            marginTop: '36px',
            paddingTop: '20px',
            borderTop: '1px solid #d9e1ea',
          })}">
            <strong style="${inlineStyle({ display: 'block', color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '1rem', margin: '0 0 8px' })}">${chrome.footerTitle}</strong>
            <p style="${inlineStyle({ margin: '0', color: '#5b6678', fontSize: '.95rem', lineHeight: '1.7' })}">${escapeHtml(input.clientName)} provides service-specific guidance focused on informed decisions, clear expectations, and practical next steps.</p>
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
