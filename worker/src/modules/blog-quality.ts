import type { PostRow } from '../types';
import { stripHtml, type BlogFaqItem, type BlogSection, type StructuredBlogContent } from '../services/wordpress';
import { getCompatiblePlatforms, type SupportedContentType } from './platform-compatibility';

export interface BlogQualityIssue {
  code: string;
  message: string;
}

export interface BlogQualityResult {
  blog: StructuredBlogContent;
  warnings: BlogQualityIssue[];
}

export interface BlogPublishingValidationContext {
  clientName: string;
  industry?: string | null;
  state?: string | null;
  phone?: string | null;
  serviceNames?: string[];
  serviceAreas?: string[];
  categoryNames?: string[];
}

export interface BlogPublishingValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between',
  'could', 'every', 'first', 'from', 'have', 'into', 'more', 'near', 'over',
  'that', 'their', 'there', 'these', 'this', 'those', 'through', 'with',
  'would', 'your',
]);

const BLOG_SOCIAL_LIMITS: Record<string, number> = {
  x: 280,
  bluesky: 280,
  threads: 500,
  google_business: 1500,
  pinterest: 500,
  instagram: 2200,
  facebook: 5000,
  linkedin: 3000,
};

const SERVICE_FAMILIES: Record<string, string[]> = {
  locksmith: ['locksmith', 'lockout', 'rekey', 'smart lock', 'keyless', 'deadbolt', 'door lock', 'security door'],
  remodeling: ['remodel', 'renovation', 'kitchen', 'bathroom', 'countertop', 'tile', 'adu', 'addition', 'plumbing', 'fireplace', 'bidet'],
  roofing: ['roof', 'roofing', 'shingle', 'flashing', 'gutter', 'leak'],
  landscaping: ['landscape', 'garden', 'irrigation', 'planting', 'drought', 'lawn', 'outdoor'],
  marketing: ['marketing', 'seo', 'advertising', 'lead generation', 'google business'],
  beauty: ['makeup', 'beauty', 'skin', 'wedding', 'event', 'artist'],
};

function normalizeComparableText(value: string | null | undefined): string {
  return stripHtml(value ?? '')
    .toLowerCase()
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantWords(value: string | null | undefined): string[] {
  return normalizeComparableText(value)
    .split(' ')
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
}

function phraseMatches(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeComparableText(phrase);
  return normalizedPhrase.length > 0 && text.includes(normalizedPhrase);
}

function termMatches(text: string, phrase: string): boolean {
  if (phraseMatches(text, phrase)) return true;
  const words = significantWords(phrase);
  if (words.length === 0) return false;
  const matches = words.filter((word) => text.includes(word) || text.includes(word.replace(/ing$/, ''))).length;
  return matches >= Math.min(2, words.length);
}

function sameOrNearDuplicate(a: string, b: string): boolean {
  const aWords = new Set(significantWords(a));
  const bWords = significantWords(b);
  if (aWords.size === 0 || bWords.length === 0) return false;
  const overlap = bWords.filter((word) => aWords.has(word)).length;
  return normalizeComparableText(a) === normalizeComparableText(b)
    || (aWords.size >= 8 && bWords.length >= 8 && overlap / Math.min(aWords.size, bWords.length) >= 0.82);
}

function matchingServiceFamilies(text: string): string[] {
  const termAppears = (term: string): boolean => {
    const pattern = term
      .trim()
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    return new RegExp(`(^|\\b)${pattern}(\\b|$)`, 'i').test(text);
  };
  return Object.entries(SERVICE_FAMILIES)
    .filter(([, terms]) => terms.some((term) => termAppears(term)))
    .map(([family]) => family);
}

function allowedServiceFamilies(context: BlogPublishingValidationContext): string[] {
  const source = normalizeComparableText([
    context.industry ?? '',
    ...(context.serviceNames ?? []),
    ...(context.categoryNames ?? []),
  ].join(' '));
  return Object.keys(SERVICE_FAMILIES).filter((family) => {
    if (family === 'remodeling' && /\bconstruction\b|builder|remodel|renovat|kitchen|bathroom/.test(source)) return true;
    return matchingServiceFamilies(source).includes(family);
  });
}

function extractImageSources(html: string | null | undefined): string[] {
  return [...(html ?? '').matchAll(/<img\b[^>]*\ssrc=["']([^"']+)["']/gi)]
    .map((match) => match[1]?.trim())
    .filter((src): src is string => Boolean(src));
}

function dedupeHtmlBlocks(html: string, seenBlocks: Set<string>, warnings: BlogQualityIssue[]): string {
  const dedupeTag = (source: string, tag: 'p' | 'li'): string => source.replace(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'),
    (full, inner: string) => {
      const key = normalizeComparableText(inner);
      if (!key || key.length < 32) return full;
      if (seenBlocks.has(key)) {
        warnings.push({ code: 'duplicate_content_block', message: `Removed duplicate ${tag} content block.` });
        return '';
      }
      seenBlocks.add(key);
      return full;
    },
  );

  const next = dedupeTag(dedupeTag(html, 'p'), 'li')
    .replace(/<ul>\s*<\/ul>/gi, '')
    .replace(/<ol>\s*<\/ol>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return next;
}

export function sanitizeStructuredBlogContent(
  blog: StructuredBlogContent,
): BlogQualityResult {
  const warnings: BlogQualityIssue[] = [];
  const seenHeadings = new Set<string>();
  const seenBlocks = new Set<string>();
  const titleKey = normalizeComparableText(blog.title);
  const introKey = normalizeComparableText(blog.intro);
  if (introKey) seenBlocks.add(introKey);

  const sections: BlogSection[] = [];
  for (const section of blog.sections) {
    const headingKey = normalizeComparableText(section.heading);
    if (!headingKey || headingKey === titleKey || seenHeadings.has(headingKey)) {
      warnings.push({ code: 'duplicate_heading', message: `Removed duplicate heading "${section.heading}".` });
      continue;
    }
    const duplicateHeading = sections.some((existing) => sameOrNearDuplicate(existing.heading, section.heading));
    if (duplicateHeading) {
      warnings.push({ code: 'near_duplicate_heading', message: `Removed near-duplicate heading "${section.heading}".` });
      continue;
    }

    seenHeadings.add(headingKey);
    const html = dedupeHtmlBlocks(section.html, seenBlocks, warnings);
    if (!stripHtml(html)) {
      warnings.push({ code: 'empty_section_after_dedupe', message: `Removed empty section "${section.heading}".` });
      continue;
    }
    sections.push({ heading: section.heading.trim(), html });
  }

  const seenFaqQuestions = new Set<string>();
  const seenFaqAnswers = new Set<string>();
  const faq: BlogFaqItem[] = [];
  for (const item of blog.faq) {
    const questionKey = normalizeComparableText(item.question);
    const answerKey = normalizeComparableText(item.answer);
    if (!questionKey || !answerKey || seenFaqQuestions.has(questionKey) || seenFaqAnswers.has(answerKey)) {
      warnings.push({ code: 'duplicate_faq', message: `Removed duplicate FAQ "${item.question}".` });
      continue;
    }
    if (faq.some((existing) => sameOrNearDuplicate(existing.question, item.question))) {
      warnings.push({ code: 'near_duplicate_faq', message: `Removed near-duplicate FAQ "${item.question}".` });
      continue;
    }
    seenFaqQuestions.add(questionKey);
    seenFaqAnswers.add(answerKey);
    faq.push({ question: item.question.trim(), answer: item.answer.trim() });
  }

  const conclusion = blog.conclusion && sameOrNearDuplicate(blog.intro, blog.conclusion)
    ? undefined
    : blog.conclusion;
  if (blog.conclusion && !conclusion) {
    warnings.push({ code: 'duplicate_conclusion', message: 'Removed conclusion because it repeated the intro.' });
  }

  return {
    blog: {
      ...blog,
      sections: sections.length > 0 ? sections : blog.sections.slice(0, 1),
      faq,
      conclusion,
    },
    warnings,
  };
}

export function validateBlogPublishingContent(
  post: Pick<PostRow,
  'content_type' | 'blog_content' | 'title' | 'seo_title' | 'meta_description' |
    'target_keyword' | 'slug' | 'blog_excerpt'
  > & { secondary_keywords?: string | null; ai_image_prompt?: string | null },
  context: BlogPublishingValidationContext,
): BlogPublishingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (post.content_type !== 'blog') errors.push('Post content_type is not "blog"');
  if (!post.blog_content || post.blog_content.length < 200) errors.push('Blog content is missing or too short');
  if (!post.title) errors.push('Post title is required');
  if (!post.target_keyword) errors.push('Target keyword is required for Rank Math integration');
  if (!post.seo_title) warnings.push('SEO title missing - WordPress will use the post title');
  if (!post.meta_description) warnings.push('Meta description missing - Rank Math will generate one');
  if (!post.slug) warnings.push('URL slug missing - WordPress will auto-generate one');
  if (!post.blog_excerpt) warnings.push('Blog excerpt missing - WordPress excerpt field will be empty');
  if (!post.ai_image_prompt) warnings.push('Image prompt missing - alt text and body image context may be weaker');

  const titleAndBody = normalizeComparableText(`${post.title ?? ''} ${post.blog_content ?? ''}`);
  const keywordWords = significantWords(post.target_keyword);
  const keywordMatches = keywordWords.filter((word) => titleAndBody.includes(word)).length;
  if (keywordWords.length >= 2 && keywordMatches < Math.min(2, keywordWords.length)) {
    errors.push('Blog target keyword does not match the generated title/content');
  }

  const serviceNames = context.serviceNames ?? [];
  const serviceMatches = serviceNames.filter((service) => termMatches(titleAndBody, service));
  if (serviceNames.length > 0 && serviceMatches.length === 0 && !termMatches(titleAndBody, context.industry ?? '')) {
    errors.push('Blog content does not match any active client service');
  }
  if (serviceMatches.length > 3) {
    warnings.push('Blog mentions several unrelated services; review topic focus before publishing');
  }
  const detectedFamilies = matchingServiceFamilies(titleAndBody);
  const allowedFamilies = allowedServiceFamilies(context);
  const unrelatedFamilies = detectedFamilies.filter((family) => allowedFamilies.length > 0 && !allowedFamilies.includes(family));
  if (unrelatedFamilies.length > 0) {
    errors.push(`Blog mixes unrelated service families: ${unrelatedFamilies.join(', ')}`);
  }

  const areaNames = [...(context.serviceAreas ?? []), context.state ?? ''].filter(Boolean) as string[];
  if (areaNames.length > 0 && !areaNames.some((area) => phraseMatches(titleAndBody, area))) {
    errors.push('Blog does not mention a configured service area or client state');
  }

  const rawBlogText = [post.title, post.blog_content, post.seo_title, post.meta_description, post.blog_excerpt].filter(Boolean).join(' ');
  const normalizeDigits = (value: string): string => value.replace(/\D/g, '');
  const clientPhoneDigits = normalizeDigits(context.phone ?? '');
  if (clientPhoneDigits) {
    const phoneMatches = [...rawBlogText.matchAll(/(?:\+?\d[\d().\-\s]{7,}\d)/g)].map((match) => normalizeDigits(match[0])).filter(Boolean);
    if (phoneMatches.some((digits) => digits !== clientPhoneDigits)) {
      errors.push(`Blog contains a phone number that does not match the client phone: ${context.phone}`);
    }
    // Compare against a digit-only version of the body: normalizeComparableText
    // turns "(323) 484-8458" into "323 484 8458", so a contiguous 7-digit needle
    // can never match a normally-formatted phone. Strip to digits on both sides.
    const rawBlogDigits = normalizeDigits(rawBlogText);
    const ctaMentions = /\b(call|text|phone|contact|reach|book|schedule|dial)\b/i.test(normalizeComparableText(rawBlogText));
    if (ctaMentions && !rawBlogDigits.includes(clientPhoneDigits.slice(-7))) {
      errors.push(`Blog CTA references contact details but does not include the client phone: ${context.phone}`);
    }
  }

  const categoryNames = context.categoryNames ?? [];
  if (categoryNames.length > 0 && !categoryNames.some((category) => phraseMatches(titleAndBody, category))) {
    warnings.push('Blog does not clearly match a configured service category');
  }

  const headingMatches = [...(post.blog_content ?? '').matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((match) => normalizeComparableText(match[1] ?? ''))
    .filter(Boolean);
  const duplicateHeadings = headingMatches.filter((heading, idx) => headingMatches.indexOf(heading) !== idx);
  if (duplicateHeadings.length > 0) errors.push('Blog contains duplicate headings');

  const paragraphs = [...(post.blog_content ?? '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => normalizeComparableText(match[1] ?? ''))
    .filter((value) => value.length > 60);
  const duplicateParagraphs = paragraphs.filter((paragraph, idx) => paragraphs.indexOf(paragraph) !== idx);
  if (duplicateParagraphs.length > 0) errors.push('Blog contains duplicate paragraphs');

  const faqQuestions = [...(post.blog_content ?? '').matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)]
    .map((match) => normalizeComparableText(match[1] ?? ''))
    .filter(Boolean);
  if (faqQuestions.some((question, idx) => faqQuestions.indexOf(question) !== idx)) {
    errors.push('Blog contains duplicate FAQ questions');
  }

  const ctaBlocks = [...(post.blog_content ?? '').matchAll(/<section\b[^>]*class=["'][^"']*wx-blog-cta[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi)]
    .map((match) => normalizeComparableText(match[1] ?? ''))
    .filter(Boolean);
  if (ctaBlocks.length > 1 && ctaBlocks.some((cta, idx) => ctaBlocks.indexOf(cta) !== idx)) {
    errors.push('Blog contains duplicate CTA blocks');
  }

  const imageSources = extractImageSources(post.blog_content);
  if (imageSources.some((src, idx) => imageSources.indexOf(src) !== idx)) {
    errors.push('Blog contains duplicate images');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function uniqueImageHtmlBySource(
  images: { slot1?: string; slot2?: string; slot3?: string },
): { slot1?: string; slot2?: string; slot3?: string } {
  const seen = new Set<string>();
  const out: { slot1?: string; slot2?: string; slot3?: string } = {};
  for (const slot of ['slot1', 'slot2', 'slot3'] as const) {
    const html = images[slot];
    if (!html) continue;
    const src = html.match(/<img\b[^>]*\ssrc="([^"]+)"/i)?.[1] ?? normalizeComparableText(html);
    if (seen.has(src)) continue;
    seen.add(src);
    out[slot] = html;
  }
  return out;
}

export function buildBlogSocialCaption(input: {
  platform: string;
  title: string | null;
  excerpt: string | null;
  clientName: string;
  blogUrl: string;
  existing?: string | null;
}): string {
  const limit = BLOG_SOCIAL_LIMITS[input.platform] ?? 500;
  const existing = input.existing?.trim();
  if (existing && existing.includes(input.blogUrl)) return existing;
  if (existing && existing.includes('[blog_url]')) return existing.replace(/\[blog_url\]/g, input.blogUrl);

  const title = input.title?.trim() || `${input.clientName} blog`;
  const excerpt = input.excerpt?.trim();
  let caption = '';
  switch (input.platform) {
    case 'linkedin':
      caption = `${title}: ${excerpt || 'A practical guide with service-specific insight and next steps.'} Read the full article: ${input.blogUrl}`;
      break;
    case 'x':
    case 'bluesky':
      caption = `${title}. ${input.blogUrl}`;
      break;
    case 'threads':
      caption = `${title}\n\n${excerpt || 'A quick read with practical guidance.'}\n${input.blogUrl}`;
      break;
    case 'pinterest':
      caption = `${title} | ${excerpt || 'Helpful local service guide'} | ${input.blogUrl}`;
      break;
    case 'google_business':
      caption = `${excerpt || title}\n\nLearn more: ${input.blogUrl}`;
      break;
    case 'instagram':
      caption = `${title}\n\n${excerpt || 'Read the full guide.'}\n${input.blogUrl}`;
      break;
    default:
      caption = `${title}\n\n${excerpt || 'Read the full guide from our team.'}\n${input.blogUrl}`;
  }

  if (caption.length <= limit) return caption;
  const suffix = ` ${input.blogUrl}`;
  const maxBody = Math.max(20, limit - suffix.length - 1);
  return `${caption.replace(input.blogUrl, '').trim().slice(0, maxBody).replace(/\s+\S*$/, '')}${suffix}`;
}

export function getCompatibleBlogDistributionPlatforms(input: {
  candidatePlatforms: string[];
  contentType: SupportedContentType;
}): string[] {
  return getCompatiblePlatforms(input.contentType, input.candidatePlatforms);
}
