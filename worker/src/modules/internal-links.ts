/**
 * Internal-link library + blog injection.
 *
 * Links are auto-pulled from each client's live WordPress site (pages + posts)
 * and stored in client_internal_links. At blog-render time we weave a few
 * keyword-anchored inline links into the article body and append a styled
 * "Related Resources" section. All the HTML helpers here are pure and
 * template-agnostic: they post-process the already-rendered blog HTML, so they
 * work for every per-client template variant (ETB + generic).
 */
import type { ClientRow, Env } from '../types';
import { buildWordPressClient } from '../services/wordpress';
import { listClientInternalLinks, upsertClientInternalLinks } from '../db/queries';

export interface InternalLink {
  url: string;
  anchor: string;
  title?: string | null;
  priority?: number;
}

export interface ClientInternalLinkRow {
  id: string;
  client_id: string;
  url: string;
  anchor_keyword: string;
  title: string | null;
  wp_type: string | null;
  wp_id: number | null;
  priority: number;
  source: string;
  active: number;
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Normalize a URL for equality checks (drop scheme, trailing slash, lowercase host+path). */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

const SITE_SUFFIX_RE = /\s*[|–—-]\s*[^|–—-]{1,40}$/;

/** Derive clean anchor text from a raw WordPress title (decode entities, drop " | Site" suffix). */
export function deriveAnchor(title: string): string {
  let text = title
    .replace(/&amp;/g, '&').replace(/&#0?38;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#0?34;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&#8217;/g, '’')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop a trailing " - Brand" / " | Brand" tagline when the head is substantial.
  const head = text.replace(SITE_SUFFIX_RE, '').trim();
  if (head.length >= 3 && head.split(/\s+/).length >= 1) text = head;
  return text;
}

/**
 * Choose which links to weave into a blog. Own-URL is excluded, links whose
 * anchor already appears in the body are preferred (more natural), then the
 * rest by priority. Deduped by normalized URL.
 */
export function selectInternalLinks(
  links: InternalLink[],
  opts: { excludeUrl?: string | null; excludeSlug?: string | null; bodyText?: string; max?: number } = {},
): InternalLink[] {
  const max = opts.max ?? 6;
  const excl = opts.excludeUrl ? normalizeUrl(opts.excludeUrl) : null;
  const slug = opts.excludeSlug?.trim().toLowerCase() || null;
  const body = (opts.bodyText ?? '').toLowerCase();

  const seen = new Set<string>();
  const cleaned: InternalLink[] = [];
  for (const link of links) {
    const url = (link.url ?? '').trim();
    const anchor = (link.anchor ?? '').trim();
    if (!url || !anchor) continue;
    const norm = normalizeUrl(url);
    if (!norm || seen.has(norm)) continue;
    if (excl && norm === excl) continue;
    if (slug && (norm.endsWith(`/${slug}`) || norm.endsWith(`/${slug}/`))) continue;
    seen.add(norm);
    cleaned.push({ ...link, url, anchor });
  }

  const rank = (link: InternalLink): number => {
    const inBody = body && body.includes(link.anchor.toLowerCase()) ? 0 : 1;
    return inBody * 10_000 + (link.priority ?? 100);
  };
  return cleaned.sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

/**
 * Weave inline anchors into the blog's section-body blocks. Replaces the first
 * safe (not already inside an <a>, not inside a tag) occurrence of each link's
 * anchor phrase, at most one link per phrase and at most `maxInline` total.
 * Returns the mutated HTML plus the set of URLs actually linked inline.
 */
export function injectInlineInternalLinks(
  html: string,
  links: InternalLink[],
  opts: { maxInline?: number } = {},
): { html: string; usedUrls: Set<string> } {
  const maxInline = opts.maxInline ?? 3;
  const usedUrls = new Set<string>();
  if (!links.length || maxInline <= 0) return { html, usedUrls };

  const pending = [...links];
  let injected = 0;

  const injectIntoBlock = (block: string): string => {
    if (injected >= maxInline) return block;
    // Tokenize into tags and text so we only touch depth-0 text (never inside <a> or any tag).
    const tokens = block.split(/(<[^>]+>)/);
    let depth = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.startsWith('<')) {
        if (/^<a\b/i.test(token)) depth += 1;
        else if (/^<\/a>/i.test(token)) depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth > 0 || !token) continue;
      for (let p = 0; p < pending.length; p += 1) {
        if (injected >= maxInline) break;
        const link = pending[p];
        const re = new RegExp(`\\b(${escapeRegExp(link.anchor)})\\b`, 'i');
        const m = token.match(re);
        if (!m || m.index === undefined) continue;
        const matched = m[0];
        tokens[i] =
          token.slice(0, m.index) +
          `<a href="${escapeHtmlAttr(link.url)}" class="wx-blog-inlink">${escapeHtmlText(matched)}</a>` +
          token.slice(m.index + matched.length);
        usedUrls.add(normalizeUrl(link.url));
        pending.splice(p, 1);
        injected += 1;
        break; // one injection per text token keeps replacements clean
      }
      if (injected >= maxInline) break;
    }
    return tokens.join('');
  };

  const nextHtml = html.replace(
    /(<div[^>]*class="[^"]*wx-blog-section-body[^"]*"[^>]*>)([\s\S]*?)(<\/div>)/gi,
    (_full, open: string, inner: string, close: string) => open + injectIntoBlock(inner) + close,
  );
  return { html: nextHtml, usedUrls };
}

/** Render the "Related Resources" internal-links section. */
export function renderInternalLinksSection(
  links: InternalLink[],
  opts: { accentColor?: string; heading?: string } = {},
): string {
  if (!links.length) return '';
  const accent = opts.accentColor && /^#[0-9a-f]{3,6}$/i.test(opts.accentColor) ? opts.accentColor : '#1a73e8';
  const heading = opts.heading ?? 'Related Resources';
  const items = links
    .map(
      (link) =>
        `<li style="margin:0 0 10px;padding-left:18px;position:relative;">` +
        `<span style="position:absolute;left:0;color:${accent};font-weight:700;">&rsaquo;</span>` +
        `<a href="${escapeHtmlAttr(link.url)}" style="color:${accent};text-decoration:none;font-weight:600;">${escapeHtmlText(link.anchor)}</a>` +
        `</li>`,
    )
    .join('');
  return (
    `<section class="wx-blog-internal-links" style="margin:32px 0 0;padding:24px 26px;background:#f7f9fc;border:1px solid #e3e9f2;border-left:4px solid ${accent};border-radius:14px;">` +
    `<h2 style="margin:0 0 14px;font-size:1.15rem;color:#132033;">${escapeHtmlText(heading)}</h2>` +
    `<ul style="list-style:none;margin:0;padding:0;">${items}</ul>` +
    `</section>`
  );
}

/**
 * Full post-process: inline anchors + a Related Resources section inserted just
 * before the CTA (or before </article>, or appended). No-op when there are no
 * usable links, so blogs still render/publish fine for clients without a synced
 * link library.
 */
export function applyInternalLinks(
  html: string,
  links: InternalLink[],
  opts: {
    excludeUrl?: string | null;
    excludeSlug?: string | null;
    accentColor?: string;
    maxInline?: number;
    maxSection?: number;
    heading?: string;
  } = {},
): string {
  if (!html || !links.length) return html;
  const selected = selectInternalLinks(links, {
    excludeUrl: opts.excludeUrl,
    excludeSlug: opts.excludeSlug,
    bodyText: stripHtmlToText(html),
    max: opts.maxSection ?? 6,
  });
  if (!selected.length) return html;

  const { html: withInline } = injectInlineInternalLinks(html, selected, { maxInline: opts.maxInline ?? 3 });
  const section = renderInternalLinksSection(selected, { accentColor: opts.accentColor, heading: opts.heading });
  if (!section) return withInline;

  const ctaMatch = withInline.match(/<(section|footer)\b[^>]*class="[^"]*wx-blog-cta[^"]*"[^>]*>/i);
  if (ctaMatch && ctaMatch.index !== undefined) {
    return withInline.slice(0, ctaMatch.index) + section + withInline.slice(ctaMatch.index);
  }
  const articleClose = withInline.lastIndexOf('</article>');
  if (articleClose !== -1) {
    return withInline.slice(0, articleClose) + section + withInline.slice(articleClose);
  }
  return withInline + section;
}

// ── Sync: pull live links from the client's WordPress site ──────────────────

/** Load the stored internal-link library for a client as InternalLink[]. */
export async function loadClientInternalLinks(env: Env, clientId: string): Promise<InternalLink[]> {
  const rows = await listClientInternalLinks(env.DB, clientId);
  return rows.map((row) => ({ url: row.url, anchor: row.anchor_keyword, title: row.title, priority: row.priority }));
}

/**
 * Pull the client's published pages + posts from WordPress and upsert them into
 * client_internal_links. Best-effort: returns 0 (never throws) when WP isn't
 * configured or the site is unreachable, so callers can sync opportunistically.
 */
export async function syncClientInternalLinks(env: Env, client: ClientRow): Promise<{ synced: number; error?: string }> {
  const wp = buildWordPressClient(client);
  if (!wp) return { synced: 0, error: 'WordPress not configured' };
  try {
    const items = await wp.listSiteLinks();
    const links = items
      .map((item, idx) => ({
        url: item.url,
        anchor_keyword: deriveAnchor(item.title || ''),
        title: item.title || null,
        wp_type: item.type,
        wp_id: item.id,
        // Pages before posts, preserve source ordering within each group.
        priority: (item.type === 'page' ? 0 : 1000) + idx,
      }))
      .filter((link) => link.url && link.anchor_keyword);
    if (!links.length) return { synced: 0 };
    const n = await upsertClientInternalLinks(env.DB, client.id, links);
    return { synced: n };
  } catch (err) {
    return { synced: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
