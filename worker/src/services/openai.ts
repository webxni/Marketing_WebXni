/**
 * OpenAI client — direct fetch, no SDK dependency.
 * Used for AI content generation.
 */
import {
  inferBusinessTemplateKey,
  renderStructuredBlogHtml,
  type BlogFaqItem,
  type BlogSection,
  type StructuredBlogContent,
} from './wordpress';

export interface GeneratedPost {
  title:               string;
  master_caption:      string;
  cap_facebook?:       string;
  cap_instagram?:      string;
  cap_linkedin?:       string;
  cap_x?:              string;
  cap_threads?:        string;
  cap_tiktok?:         string;
  cap_pinterest?:      string;
  cap_bluesky?:        string;
  cap_google_business?: string;
  cap_gbp_la?:         string;
  cap_gbp_wa?:         string;
  cap_gbp_or?:         string;
  youtube_title?:      string;
  youtube_description?: string;
  blog_content?:       string;
  blog_excerpt?:       string;  // plain-text 150-160 char excerpt for WordPress
  seo_title?:          string;
  meta_description?:   string;
  target_keyword?:     string;
  secondary_keywords?: string;
  slug?:               string;  // URL slug suggestion
  video_script?:       string;
  // Designer prompts (always generated in Spanish)
  ai_image_prompt?:    string;
  ai_video_prompt?:    string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content format rotation + topic research types
// ─────────────────────────────────────────────────────────────────────────────

export type ContentFormat =
  | 'faq'
  | 'myth_vs_fact'
  | 'checklist'
  | 'mistake_to_avoid'
  | 'comparison'
  | 'process_breakdown'
  | 'quick_explainer'
  | 'local_advice'
  | 'trust_builder';

export interface TopicResearch {
  topic:          string;         // specific post topic
  angle:          string;         // rationale for this angle
  format:         ContentFormat;  // format to use
  targetKeyword:  string;         // 2-5 word SEO keyword phrase
  localModifier:  string;         // city or area to include
  searchQuestion: string;         // the customer search question this answers
}

export interface TopicResearchParams {
  client: {
    canonical_name: string;
    industry?:      string | null;
    state?:         string | null;
    language?:      string | null;
  };
  intelligence: {
    service_priorities?: string | null;
    seasonal_notes?:     string | null;
    local_seo_themes?:   string | null;
  } | null;
  contentType:    string;
  contentIntent:  'educational' | 'sales';
  platforms:      string[];
  publishDate:    string;
  recentTitles:   string[];
  recentFormats:  ContentFormat[];
  serviceAreas:   string[];
  serviceNames:   string[];
}

export interface ContentQualityResult {
  passed:   boolean;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Content provider interface — for future provider abstraction (OpenAI / Claude)
// ─────────────────────────────────────────────────────────────────────────────

export interface ContentProvider {
  readonly name: string;
  generatePost(ctx: GenerationContext): Promise<GeneratePostResult>;
  researchTopic(params: TopicResearchParams): Promise<TopicResearch | null>;
}

export interface GenerationContext {
  client: {
    canonical_name:      string;
    notes?:              string | null;
    brand_json?:         string | null;
    brand_primary_color?: string | null;
    language?:           string | null;
    phone?:              string | null;
    cta_text?:           string | null;
    industry?:           string | null;
    state?:              string | null;
    owner_name?:         string | null;
    wp_template_key?:    string | null;
  };
  intelligence: {
    brand_voice?:         string | null;
    tone_keywords?:       string | null;
    prohibited_terms?:    string | null;
    approved_ctas?:       string | null;
    content_goals?:       string | null;
    service_priorities?:  string | null;
    content_angles?:      string | null;
    seasonal_notes?:      string | null;
    audience_notes?:      string | null;
    primary_keyword?:     string | null;
    secondary_keywords?:  string | null;
    local_seo_themes?:    string | null;
    humanization_style?:  string | null;
  } | null;
  recentTitles:  string[];
  feedback:      { sentiment: string; note: string }[];
  publishDate:   string;   // YYYY-MM-DD
  contentType:   string;   // image | video | reel | blog
  platforms:     string[];
  contentIntent?: 'educational' | 'sales';  // 70/30 balance directive
  // GBP-specific context (optional — only set when generating GBP caption)
  gbpTopicType?: string | null;  // 'STANDARD'|'EVENT'|'OFFER'
  gbpCtaType?:   string | null;  // 'BOOK'|'ORDER'|'SHOP'|'LEARN_MORE'|'SIGN_UP'|'CALL'
  gbpOfferTitle?: string | null;
  gbpEventTitle?: string | null;
  gbpLocations?: Array<{ label: string; captionField: string | null }>;
  // Topic research (pre-generation research phase output)
  topicResearch?:  TopicResearch | null;
  // Service areas and names for SEO-aware, locally relevant generation
  serviceAreas?:   string[];
  serviceNames?:   string[];
  // Derived format history — drives format rotation
  recentFormats?:  ContentFormat[];
  // High-quality mode — uses better model + larger token budget
  highQuality?:    boolean;
}

function line(condition: unknown, text: string): string {
  return condition ? `\n${text}` : '';
}

type JsonSchema = Record<string, unknown>;

export interface GenerationPlan {
  mode: 'social' | 'blog';
  model: 'gpt-4o-mini' | 'gpt-4o';
  requestTimeoutMs: number;
  perPostTimeoutMs: number;
  maxTokens: number;
  retryLimit: number;
  promptChars: number;
}

export interface GeneratePostResult {
  post: GeneratedPost;
  meta: {
    mode: 'social' | 'blog';
    model: 'gpt-4o-mini' | 'gpt-4o';
    attempts: number;
    promptChars: number;
    elapsedMs: number;
    requestTimeoutMs: number;
  };
}

// Maps GBP CTA type to a natural language instruction for caption generation
const GBP_CTA_INTENT: Record<string, string> = {
  BOOK:       'End with a clear booking CTA — e.g. "Book your appointment today" or "Schedule a visit".',
  ORDER:      'Include an ordering CTA — e.g. "Order now" or "Get yours today".',
  SHOP:       'Include a shopping CTA — e.g. "Shop our products" or "Visit our store".',
  LEARN_MORE: 'Use an informational, educational tone. End with "Learn more" or "Find out more".',
  SIGN_UP:    'Include a sign-up or registration CTA — e.g. "Sign up today" or "Register now".',
  CALL:       'Include a direct call-to-action — e.g. "Call us today" or "Give us a call". If a phone number is available, include it.',
};

const ANTISLOP_INSTRUCTIONS = `ANTISLOP INSTRUCTIONS:
- Never use these words or close variants unless they appear in a required proper noun or quoted source: delve, tapestry, vibrant, unleash, unlock, elevate, embark, journey, transformative, landscape, paramount.
- Avoid AI filler, generic inspiration-speak, poetic abstractions, vague hype, and empty setup lines.
- Use active voice with clear subjects and verbs. Prefer "we repair roofs" over "roof repair services are provided."
- Keep the tone direct, professional, specific, and human. Sound like a strong marketer, not a motivational template.
- Vary sentence length and structure. Mix short sentences with longer ones. Do not let the copy fall into a uniform rhythm.
- State the point plainly. Do not pad sentences with throat-clearing phrases, summary crutches, or fake authenticity markers.
- Do not write "In today's world," "In conclusion," "Here's the thing," "Let's dive in," or similar stock phrasing.
- Use simple concrete wording. If a sentence sounds like canned AI marketing copy, rewrite it with sharper, more literal language.
- Do not swap banned words for nearby buzzwords. Restructure the sentence so it says something specific instead.`;

const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  faq:               'Q&A format — answer 3-5 real customer questions',
  myth_vs_fact:      'myth vs. fact — debunk a common misconception in this industry',
  checklist:         'numbered checklist — practical steps or criteria',
  mistake_to_avoid:  'mistake to avoid — expose a costly or common error customers make',
  comparison:        'comparison — contrast two approaches, products, or service tiers',
  process_breakdown: 'process breakdown — explain how this service works step by step',
  quick_explainer:   'quick explainer — define an important concept or term clearly',
  local_advice:      'local advice — location-specific guidance customers in this area need',
  trust_builder:     'trust builder — demonstrate expertise, licensing, or quality process',
};

// Derive content format from a post title heuristically (for format rotation tracking)
export function detectFormatFromTitle(title: string): ContentFormat | null {
  const t = title.toLowerCase();
  if (/\bvs\.?\b|\bdifference between\b|\bcompare\b/.test(t)) return 'comparison';
  if (/\bchecklist\b|\bthings to\b|\bsteps to\b|\bways to\b|\b\d+ steps\b/.test(t)) return 'checklist';
  if (/\bmistake\b|\bavoid\b|\bdon.t\b|\bdo not\b|\bwrong\b/.test(t)) return 'mistake_to_avoid';
  if (/\bhow .* works?\b|\bprocess\b|\bstep.by.step\b|\bwhat to expect\b/.test(t)) return 'process_breakdown';
  if (/\bwhat is\b|\bexplained\b|\bguide to\b|\bunderstanding\b/.test(t)) return 'quick_explainer';
  if (/\bmyth\b|\btruth about\b|\bdebunk\b|\breality\b/.test(t)) return 'myth_vs_fact';
  if (/\bfaq\b|\bquestions about\b|\bask\b|\banswered\b/.test(t)) return 'faq';
  if (/\bwhy choose\b|\blicensed\b|\bcertified\b|\bprofessional\b|\btrusted\b/.test(t)) return 'trust_builder';
  if (/\bin [a-z]+\b|\blocal\b|\bnearby\b|\barea\b/.test(t)) return 'local_advice';
  return null;
}

function buildGenerationSystemMessage(mode: 'social' | 'blog' | 'gbp'): string {
  const role =
    mode === 'blog'
      ? 'You are an expert SEO blog writer.'
      : mode === 'gbp'
        ? 'You are a Google Business Profile marketing expert.'
        : 'You are an expert social media content writer.';
  return `${role}

${ANTISLOP_INSTRUCTIONS}

Return valid JSON only.`;
}

function getLanguage(ctx: GenerationContext): string {
  return ctx.client.language && ctx.client.language !== 'en' ? ctx.client.language : 'en';
}

function getPrimaryColor(ctx: GenerationContext): string {
  return ctx.client.brand_primary_color
    ?? (() => { try { const b = JSON.parse(ctx.client.brand_json ?? '{}'); return b.primary_color ?? b.primaryColor ?? null; } catch { return null; } })()
    ?? '#1a73e8';
}

function getBrandColors(ctx: GenerationContext): string {
  if (!ctx.client.brand_json) return '';
  try {
    const parsed = JSON.parse(ctx.client.brand_json);
    if (!parsed.colors) return '';
    return Array.isArray(parsed.colors) ? parsed.colors.join(', ') : String(parsed.colors);
  } catch {
    return '';
  }
}

function buildSharedContext(ctx: GenerationContext, mode: 'social' | 'blog'): string {
  const { client, intelligence: i, recentTitles, feedback, contentIntent } = ctx;
  const lang = getLanguage(ctx);
  const positives = feedback.filter(f => f.sentiment === 'positive').slice(0, mode === 'blog' ? 2 : 3);
  const negatives = feedback.filter(f => f.sentiment === 'negative').slice(0, 2);
  const intentIsEducational = !contentIntent || contentIntent === 'educational';
  const intentInstruction = intentIsEducational
    ? 'CONTENT INTENT: EDUCATIONAL. Focus on tips, how-to, trust-building, and problem solving. Mention the brand naturally at most once.'
    : 'CONTENT INTENT: SALES. Focus on outcomes, value, and a clear service angle without sounding pushy.';

  const serviceAreasStr = (ctx.serviceAreas ?? []).slice(0, 8).join(', ');
  const serviceNamesStr = (ctx.serviceNames ?? []).slice(0, 10).join(', ');

  let block = `BUSINESS CONTEXT:${line(client.industry, `- Industry: ${client.industry}`)}${line(client.state, `- Location: ${client.state}`)}${line(serviceAreasStr, `- Service areas: ${serviceAreasStr}`)}${line(i?.service_priorities, `- Key services: ${i?.service_priorities}`)}${line(serviceNamesStr, `- Specific services: ${serviceNamesStr}`)}${line(i?.brand_voice, `- Brand voice: ${i?.brand_voice}`)}${line(i?.tone_keywords, `- Tone: ${i?.tone_keywords}`)}${line(i?.audience_notes, `- Audience: ${i?.audience_notes}`)}${line(i?.content_goals, `- Goals: ${i?.content_goals}`)}${line(i?.content_angles, `- Preferred angles: ${i?.content_angles}`)}${line(client.cta_text, `- Preferred CTA: ${client.cta_text}`)}${line(i?.approved_ctas, `- Approved CTAs: ${i?.approved_ctas}`)}${line(i?.prohibited_terms, `- NEVER USE: ${i?.prohibited_terms}`)}${line(i?.seasonal_notes, `- Seasonal notes: ${i?.seasonal_notes}`)}${line(client.notes, `- Additional context: ${client.notes}`)}${line(i?.humanization_style, `- Humanization style: ${i?.humanization_style}`)}`;

  if (mode === 'blog') {
    block += `${line(i?.local_seo_themes, `\n- Local SEO themes: ${i?.local_seo_themes}`)}${line(i?.primary_keyword, `\n- Primary keyword: ${i?.primary_keyword}`)}${line(i?.secondary_keywords, `\n- Secondary keywords: ${i?.secondary_keywords}`)}`;
  }

  block += `\n\n${intentInstruction}`;

  // Topic research directive — injected when the pre-generation research phase ran
  if (ctx.topicResearch) {
    const tr = ctx.topicResearch;
    const formatLabel = CONTENT_FORMAT_LABELS[tr.format] ?? tr.format.replace(/_/g, ' ');
    block += `\n\nCONTENT DIRECTIVE FOR THIS POST:`;
    block += `\n- Topic: ${tr.topic}`;
    block += `\n- Format: ${formatLabel}`;
    block += `\n- Customer search question to answer: "${tr.searchQuestion}"`;
    block += `\n- Target keyword: "${tr.targetKeyword}" — use naturally 2-4 times, once in first 100 words`;
    if (tr.localModifier) block += `\n- Local modifier: mention "${tr.localModifier}" naturally at least once`;
    if (tr.angle) block += `\n- Why this angle matters: ${tr.angle}`;
    block += `\n\nThis directive is the topic you MUST write about. Do not default to a generic topic.`;
  }

  block += '\n\nCONTENT SAFETY:';
  block += '\n- NEVER include exact prices, dollar amounts, percentages, or invented statistics.';
  block += '\n- Keep claims specific to services, expertise, process, and value.';
  block += '\n- Write naturally. Avoid filler openers and generic marketing language.';
  if (lang !== 'en') block += `\n- Write all customer-facing copy in ${lang}.`;

  if (recentTitles.length > 0) {
    const limit = mode === 'blog' ? 8 : 12;
    block += `\n\nRECENT POSTS (DO NOT REPEAT TOPIC OR ANGLE):\n${recentTitles.slice(0, limit).map(t => `- ${t}`).join('\n')}`;
  }
  const recentFormats = ctx.recentFormats ?? [];
  if (recentFormats.length > 0) {
    const uniqueFormats = [...new Set(recentFormats.slice(0, 6))];
    block += `\n\nRECENT FORMATS USED (pick a different one):\n${uniqueFormats.map(f => `- ${f.replace(/_/g, ' ')}`).join('\n')}`;
  }
  if (positives.length > 0) block += `\n\nWHAT HAS WORKED WELL:\n${positives.map(f => `- ${f.note}`).join('\n')}`;
  if (negatives.length > 0) block += `\n\nAVOID THESE PATTERNS:\n${negatives.map(f => `- ${f.note}`).join('\n')}`;

  return block;
}

function buildSocialPrompt(ctx: GenerationContext): string {
  const { publishDate, contentType, gbpTopicType, gbpCtaType, gbpOfferTitle, gbpEventTitle } = ctx;
  const platforms = ctx.platforms.filter(p => p !== 'website_blog');
  const isVideo = contentType === 'video' || contentType === 'reel';
  const isYoutube = platforms.includes('youtube');
  const brandColors = getBrandColors(ctx);

  let assetSpec = '';
  if (contentType === 'reel') {
    assetSpec = 'Tipo de archivo: VIDEO VERTICAL. Dimensiones: 1080x1920 (9:16).';
  } else if (contentType === 'video') {
    assetSpec = 'Tipo de archivo: VIDEO HORIZONTAL. Dimensiones: 1920x1080 (16:9).';
  } else if (platforms.includes('pinterest') && !platforms.includes('instagram') && !platforms.includes('facebook')) {
    assetSpec = 'Tipo de archivo: IMAGEN VERTICAL. Dimensiones: 1000x1500 (2:3).';
  } else if (platforms.includes('instagram') && !platforms.includes('facebook') && !platforms.includes('pinterest')) {
    assetSpec = 'Tipo de archivo: IMAGEN CUADRADA. Dimensiones: 1080x1080 (1:1).';
  } else {
    assetSpec = 'Tipo de archivo: IMAGEN VERTICAL/CUADRADA. Dimensiones base: 1080x1350 (4:5).';
  }

  const topicDirective = ctx.topicResearch
    ? `Write one ${contentType} post about: "${ctx.topicResearch.topic}"\nFormat: ${CONTENT_FORMAT_LABELS[ctx.topicResearch.format] ?? ctx.topicResearch.format.replace(/_/g, ' ')}\nDo not change the topic.`
    : `Create one ${contentType} post for ${publishDate}.`;

  let prompt = `You are a professional social media content writer for ${ctx.client.canonical_name}.

${buildSharedContext(ctx, 'social')}

TASK:
${topicDirective}
Target platforms: ${platforms.join(', ') || 'facebook, instagram'}.

Return ONLY JSON matching the requested schema. Keep captions concise and platform-native.
- "title": short descriptive title, 5-10 words
- "master_caption": fallback caption, 100-220 chars`;

  if (platforms.includes('facebook'))  prompt += '\n- "cap_facebook": Facebook caption, 140-320 chars';
  if (platforms.includes('instagram')) prompt += '\n- "cap_instagram": Instagram caption, 120-260 chars plus 8-12 hashtags';
  if (platforms.includes('linkedin'))  prompt += '\n- "cap_linkedin": LinkedIn caption, 180-420 chars, professional and insight-driven';
  if (platforms.includes('x'))         prompt += '\n- "cap_x": X post, max 280 chars';
  if (platforms.includes('threads'))   prompt += '\n- "cap_threads": Threads caption, 100-220 chars';
  if (platforms.includes('tiktok'))    prompt += '\n- "cap_tiktok": TikTok caption, 120-220 chars plus 5-8 hashtags';
  if (platforms.includes('pinterest')) prompt += '\n- "cap_pinterest": Pinterest description, 100-200 chars plus 4-6 hashtags';
  if (platforms.includes('bluesky'))   prompt += '\n- "cap_bluesky": Bluesky caption, max 280 chars';
  if (platforms.includes('google_business')) {
    let gbpInstruction = '\n- "cap_google_business": Google Business caption, 90-220 chars, factual, local, no hashtags';
    if (gbpTopicType === 'OFFER' && gbpOfferTitle) gbpInstruction += `. This is an offer tied to "${gbpOfferTitle}".`;
    if (gbpTopicType === 'EVENT' && gbpEventTitle) gbpInstruction += `. This is an event tied to "${gbpEventTitle}".`;
    if (gbpCtaType && GBP_CTA_INTENT[gbpCtaType]) gbpInstruction += ` ${GBP_CTA_INTENT[gbpCtaType]}`;
    prompt += gbpInstruction;
    if ((ctx.gbpLocations ?? []).length > 1) {
      prompt += '\nAlso return location-specific GBP variants that stay aligned with the shared GBP caption but mention the location naturally when relevant.';
      for (const location of ctx.gbpLocations ?? []) {
        if (!location.captionField) continue;
        prompt += `\n- "${location.captionField}": Google Business caption variant for ${location.label}, 90-220 chars, factual, local, no hashtags`;
      }
    }
  }
  if (isYoutube) {
    prompt += '\n- "youtube_title": YouTube title, 60-70 chars';
    prompt += '\n- "youtube_description": YouTube description, 180-320 chars';
  }
  if (isVideo) prompt += '\n- "video_script": 30-60 second script with hook, 3 beats, CTA';

  prompt += `\n- "ai_image_prompt": MUST BE IN SPANISH. Designer brief with ${assetSpec}${brandColors ? ` Colores de marca: ${brandColors}.` : ''} Include style, composition, mood, visual elements, overlay text, and recommended tool in 3-4 sentences.`;
  if (isVideo) {
    prompt += `\n- "ai_video_prompt": MUST BE IN SPANISH. Video concept with camera movement, pacing, visual style, transitions, audio direction, and CTA in 3-4 sentences.`;
  }

  return prompt;
}

function buildBlogPrompt(ctx: GenerationContext): string {
  const templateKey = inferBusinessTemplateKey({
    wp_template_key: ctx.client.wp_template_key,
    industry: ctx.client.industry,
  });

  return `You are a senior SEO blog writer for ${ctx.client.canonical_name}.

${buildSharedContext(ctx, 'blog')}

TASK:
${ctx.topicResearch
  ? `Write a blog post about: "${ctx.topicResearch.topic}"\nAnswer this customer question: "${ctx.topicResearch.searchQuestion}"\nPrimary target keyword: "${ctx.topicResearch.targetKeyword}"\n${ctx.topicResearch.localModifier ? `Local modifier: include "${ctx.topicResearch.localModifier}" naturally at least once.\n` : ''}Do not change the topic.`
  : `Create one publication-ready blog post for ${ctx.publishDate}.`}
This is BLOG generation only. Do not generate social-platform caption variants.

Return ONLY JSON matching the requested schema:
- "title": keyword-led blog title, 50-65 chars — must include the target keyword
- "master_caption": short teaser summary for internal/social fallback, 110-180 chars
- "blog_excerpt": plain-text excerpt, 150-160 chars, no HTML
- "slug": lowercase hyphenated slug, max 55 chars
- "seo_title": SEO title, 50-60 chars
- "meta_description": meta description, 148-155 chars
- "target_keyword": primary keyword phrase${ctx.topicResearch?.targetKeyword ? ` (use: "${ctx.topicResearch.targetKeyword}")` : ''}
- "secondary_keywords": comma-separated secondary keyword phrases, 3-6 items — related long-tail variants
- "intro": opening section, 80-140 words, plain text — include target keyword within first 80 words
- "sections": array of 3-4 objects with:
  - "heading": H2 heading — include keyword or close variant in at least 2 headings
  - "html": valid HTML for that section body, 2-4 paragraphs and optional ul/ol
- "faq": array of 3-5 objects with:
  - "question": real customer question (search-style, not promotional)
  - "answer": concise, direct answer (2-4 sentences)
- "cta_heading": CTA heading
- "cta_body": CTA body copy, 1-2 sentences, no prices
- "cta_button_label": CTA button text, 2-5 words
- "ai_image_prompt": image brief for the featured/blog image

BLOG REQUIREMENTS:
- Opening paragraph must include the target keyword within the first 80 words.
- Use 3-4 sections and include the keyword or a close variant in at least 2 headings.
- Use <ul> or <ol> where it improves clarity.
- FAQ must answer real questions customers actually search for — specific, helpful, non-promotional.
- Each FAQ answer must be different and non-repetitive.
- The blog must read like it was written by an expert practitioner, not an AI copywriter.
- End with a conclusion paragraph that does not repeat the intro.
- No prices, no invented stats, no markdown, no code fences.

TEMPLATE CONTEXT:
- Selected business template: ${templateKey}
- Do NOT generate full-page HTML, CSS, <html>, <body>, <style>, or inline layout markup.
- Generate structured content only. The app will render the final professional template.`;
}

function buildResponseSchema(ctx: GenerationContext): { name: string; schema: JsonSchema } {
  const isBlog = ctx.contentType === 'blog';
  const isVideo = ctx.contentType === 'video' || ctx.contentType === 'reel';
  const platforms = ctx.platforms.filter(p => p !== 'website_blog');
  const properties: Record<string, JsonSchema> = {
    title: { type: 'string' },
    master_caption: { type: 'string' },
  };
  const required = ['title', 'master_caption'];

  if (isBlog) {
    properties.blog_excerpt = { type: 'string' };
    properties.slug = { type: 'string' };
    properties.seo_title = { type: 'string' };
    properties.meta_description = { type: 'string' };
    properties.target_keyword = { type: 'string' };
    properties.secondary_keywords = { type: 'string' };
    properties.intro = { type: 'string' };
    properties.sections = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          heading: { type: 'string' },
          html: { type: 'string' },
        },
        required: ['heading', 'html'],
      },
    };
    properties.faq = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['question', 'answer'],
      },
    };
    properties.cta_heading = { type: 'string' };
    properties.cta_body = { type: 'string' };
    properties.cta_button_label = { type: 'string' };
    properties.ai_image_prompt = { type: 'string' };
    required.push(
      'blog_excerpt',
      'slug',
      'seo_title',
      'meta_description',
      'target_keyword',
      'secondary_keywords',
      'intro',
      'sections',
      'faq',
      'cta_heading',
      'cta_body',
      'cta_button_label',
      'ai_image_prompt',
    );
  } else {
    if (platforms.includes('facebook')) properties.cap_facebook = { type: 'string' };
    if (platforms.includes('instagram')) properties.cap_instagram = { type: 'string' };
    if (platforms.includes('linkedin')) properties.cap_linkedin = { type: 'string' };
    if (platforms.includes('x')) properties.cap_x = { type: 'string' };
    if (platforms.includes('threads')) properties.cap_threads = { type: 'string' };
    if (platforms.includes('tiktok')) properties.cap_tiktok = { type: 'string' };
    if (platforms.includes('pinterest')) properties.cap_pinterest = { type: 'string' };
    if (platforms.includes('bluesky')) properties.cap_bluesky = { type: 'string' };
    if (platforms.includes('google_business')) properties.cap_google_business = { type: 'string' };
    for (const location of ctx.gbpLocations ?? []) {
      if (location.captionField) properties[location.captionField] = { type: 'string' };
    }
    if (platforms.includes('youtube')) {
      properties.youtube_title = { type: 'string' };
      properties.youtube_description = { type: 'string' };
    }
    if (isVideo) properties.video_script = { type: 'string' };
    properties.ai_image_prompt = { type: 'string' };
    required.push('ai_image_prompt');
    if (isVideo) {
      properties.ai_video_prompt = { type: 'string' };
      required.push('video_script', 'ai_video_prompt');
    }
  }

  // OpenAI strict mode requires ALL properties to appear in required.
  // Properties added above but not yet in required must be included.
  const allRequired = Object.keys(properties);

  return {
    name: isBlog ? 'blog_generation' : 'social_generation',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties,
      required: allRequired,
    },
  };
}

function buildGenerationRequest(ctx: GenerationContext) {
  const isBlog = ctx.contentType === 'blog';
  const prompt = isBlog ? buildBlogPrompt(ctx) : buildSocialPrompt(ctx);
  const schema = buildResponseSchema(ctx);
  const useHighQualityModel = isBlog || ctx.highQuality;
  const plan: GenerationPlan = {
    mode: isBlog ? 'blog' : 'social',
    model: useHighQualityModel ? 'gpt-4o' : 'gpt-4o-mini',
    requestTimeoutMs: isBlog ? 90_000 : (ctx.highQuality ? 50_000 : 30_000),
    perPostTimeoutMs: isBlog ? 120_000 : (ctx.highQuality ? 75_000 : 45_000),
    maxTokens: isBlog ? 4200 : (ctx.highQuality ? 1800 : 1400),
    retryLimit: isBlog ? 2 : 3,
    promptChars: prompt.length,
  };
  return { prompt, schema, plan };
}

export function describeGenerationPlan(ctx: GenerationContext): GenerationPlan {
  return buildGenerationRequest(ctx).plan;
}

function normalizeGeneratedPost(value: unknown, ctx: GenerationContext): GeneratedPost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OpenAI returned a non-object payload');
  }

  const parsed = { ...(value as Record<string, unknown>) } as Record<string, unknown>;
  const normalized: GeneratedPost = {
    title: '',
    master_caption: '',
  };

  for (const [key, raw] of Object.entries(parsed)) {
    if (typeof raw !== 'string') continue;
    const clean = raw.trim();
    if (!clean) continue;
    (normalized as unknown as Record<string, string>)[key] = clean;
  }

  if (!normalized.title) normalized.title = `${ctx.client.canonical_name} — ${ctx.publishDate}`;
  if (!normalized.master_caption) throw new Error('Generation missing master_caption');

  if (ctx.contentType === 'blog') {
    const parsed = value as Record<string, unknown>;
    const intro = typeof parsed['intro'] === 'string' ? parsed['intro'].trim() : '';
    const sectionsRaw = Array.isArray(parsed['sections']) ? parsed['sections'] : [];
    const faqRaw = Array.isArray(parsed['faq']) ? parsed['faq'] : [];
    const sections: BlogSection[] = sectionsRaw
      .map((item) => ({
        heading: typeof (item as Record<string, unknown>)['heading'] === 'string' ? String((item as Record<string, unknown>)['heading']).trim() : '',
        html: typeof (item as Record<string, unknown>)['html'] === 'string' ? String((item as Record<string, unknown>)['html']).trim() : '',
      }))
      .filter((item) => item.heading && item.html);
    const faq: BlogFaqItem[] = faqRaw
      .map((item) => ({
        question: typeof (item as Record<string, unknown>)['question'] === 'string' ? String((item as Record<string, unknown>)['question']).trim() : '',
        answer: typeof (item as Record<string, unknown>)['answer'] === 'string' ? String((item as Record<string, unknown>)['answer']).trim() : '',
      }))
      .filter((item) => item.question && item.answer);
    const requiredBlogKeys = ['blog_excerpt', 'slug', 'seo_title', 'meta_description', 'target_keyword', 'secondary_keywords', 'ai_image_prompt'] as const;
    for (const key of requiredBlogKeys) {
      if (!normalized[key]) throw new Error(`Generation missing ${key}`);
    }
    if (!intro) throw new Error('Generation missing intro');
    if (sections.length < 3) throw new Error('Generation missing blog sections');
    const structured: StructuredBlogContent = {
      title: normalized.title,
      excerpt: normalized.blog_excerpt!,
      focusKeyword: normalized.target_keyword!,
      secondaryKeywords: normalized.secondary_keywords!,
      seoTitle: normalized.seo_title!,
      metaDescription: normalized.meta_description!,
      slug: normalized.slug!,
      intro,
      sections,
      faq,
      ctaHeading: typeof parsed['cta_heading'] === 'string' ? String(parsed['cta_heading']).trim() : (ctx.client.cta_text ?? 'Talk To Our Team'),
      ctaBody: typeof parsed['cta_body'] === 'string' ? String(parsed['cta_body']).trim() : 'Get expert guidance tailored to your situation and goals.',
      ctaButtonLabel: typeof parsed['cta_button_label'] === 'string' ? String(parsed['cta_button_label']).trim() : (ctx.client.cta_text ?? 'Contact Us Today'),
      imagePrompt: normalized.ai_image_prompt,
    };
    normalized.blog_content = renderStructuredBlogHtml({
      templateKey: inferBusinessTemplateKey({
        wp_template_key: ctx.client.wp_template_key,
        industry: ctx.client.industry,
      }),
      primaryColor: getPrimaryColor(ctx),
      clientName: ctx.client.canonical_name,
      phone: ctx.client.phone,
      ctaDefault: ctx.client.cta_text,
      blog: structured,
    });
  } else {
    if (!normalized.ai_image_prompt) throw new Error('Generation missing ai_image_prompt');
    if ((ctx.contentType === 'video' || ctx.contentType === 'reel') && (!normalized.video_script || !normalized.ai_video_prompt)) {
      throw new Error('Generation missing video_script or ai_video_prompt');
    }
  }

  return normalized;
}

function isRetryableGenerationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('timed out') ||
    msg.includes('invalid JSON') ||
    msg.includes('non-object payload') ||
    msg.includes('missing ') ||
    msg.includes('OpenAI 429') ||
    msg.includes('OpenAI 500') ||
    msg.includes('OpenAI 502') ||
    msg.includes('OpenAI 503') ||
    msg.includes('OpenAI 504')
  );
}

function timeoutError(ms: number): Error {
  return new Error(`OpenAI request timed out after ${Math.round(ms / 1000)}s`);
}

async function callOpenAiJson(
  apiKey: string,
  request: ReturnType<typeof buildGenerationRequest>,
  attempt: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError(request.plan.requestTimeoutMs)), request.plan.requestTimeoutMs);
  const abortFromOuter = () => controller.abort(signal?.reason ?? new Error('Generation aborted'));
  signal?.addEventListener('abort', abortFromOuter, { once: true });

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Connection': 'close',
      },
      body: JSON.stringify({
        model: request.plan.model,
        messages: [
          { role: 'system', content: buildGenerationSystemMessage(request.plan.mode) },
          { role: 'user', content: request.prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: request.schema.name,
            strict: true,
            schema: request.schema.schema,
          },
        },
        temperature: attempt === 1 ? 0.7 : 0.25,
        max_tokens: request.plan.maxTokens,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Empty response from OpenAI');

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`OpenAI returned invalid JSON: ${raw.slice(0, 200)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('AbortError') || msg.includes('Generation aborted')) {
      if (signal?.aborted) throw new Error('Generation aborted');
      throw timeoutError(request.plan.requestTimeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromOuter);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic research — cheap pre-generation call that picks topic/angle/keyword
// ─────────────────────────────────────────────────────────────────────────────

export async function researchTopic(
  apiKey: string,
  params: TopicResearchParams,
): Promise<TopicResearch | null> {
  const { client, intelligence: i, contentType, contentIntent, platforms, publishDate, recentTitles, recentFormats, serviceAreas, serviceNames } = params;
  const lang = client.language && client.language !== 'en' ? client.language : 'en';

  const formatOptions: ContentFormat[] = ['faq', 'myth_vs_fact', 'checklist', 'mistake_to_avoid', 'comparison', 'process_breakdown', 'quick_explainer', 'local_advice', 'trust_builder'];
  const usedFormatsSet = new Set(recentFormats.slice(0, 6));
  const unusedFormats = formatOptions.filter(f => !usedFormatsSet.has(f));
  const preferredFormats = unusedFormats.length > 0 ? unusedFormats : formatOptions;

  let p = `You are a content strategist for ${client.canonical_name}.`;
  p += `\nIndustry: ${client.industry ?? 'unknown'}`;
  p += `\nLocation: ${client.state ?? 'unknown'}`;
  if (serviceAreas.length > 0) p += `\nService areas: ${serviceAreas.slice(0, 6).join(', ')}`;
  if (serviceNames.length > 0) p += `\nServices offered: ${serviceNames.slice(0, 10).join(', ')}`;
  if (i?.service_priorities) p += `\nPriority services: ${i.service_priorities}`;
  if (i?.seasonal_notes) p += `\nSeasonal context: ${i.seasonal_notes}`;
  if (i?.local_seo_themes) p += `\nLocal SEO themes: ${i.local_seo_themes}`;
  p += `\nContent type: ${contentType}`;
  p += `\nPublish date: ${publishDate}`;
  p += `\nTarget platforms: ${platforms.filter(pl => pl !== 'website_blog').join(', ') || 'social media'}`;
  p += `\nContent intent: ${contentIntent}`;

  if (recentTitles.length > 0) {
    p += `\n\nRECENT TOPICS TO AVOID (do NOT repeat these angles):\n${recentTitles.slice(0, 20).map(t => `- ${t}`).join('\n')}`;
  }
  if (recentFormats.length > 0) {
    p += `\n\nRECENTLY USED FORMATS (pick something different):\n${[...new Set(recentFormats.slice(0, 6))].map(f => `- ${f.replace(/_/g, ' ')}`).join('\n')}`;
  }

  p += `\n\nPick the single best topic for this ${contentType} post. Requirements:
- Answers a real customer search question — something people actually Google
- Specific to this business, industry, and location
- NOT a repeat of any recent topic listed above
- Prefers formats not recently used: ${preferredFormats.slice(0, 3).map(f => f.replace(/_/g, ' ')).join(', ')}
- Educational and genuinely useful to the customer
- Local modifier included where natural

Return JSON only:
{
  "topic": "specific post topic, not a generic category (max 12 words)",
  "angle": "1 sentence — why this angle is valuable to this customer right now",
  "format": "one of: ${formatOptions.join('|')}",
  "targetKeyword": "2-5 word SEO keyword phrase, ideally with local modifier",
  "localModifier": "primary city or area name, or empty string if not applicable",
  "searchQuestion": "the exact customer question this post answers (Google-style)"
}${lang !== 'en' ? `\n\nWrite "topic", "angle", and "searchQuestion" in ${lang}.` : ''}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a content strategist. Return only valid JSON. No markdown.' },
          { role: 'user', content: p },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.9,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<TopicResearch>;
    if (!parsed.topic || !parsed.format || !parsed.targetKeyword) return null;

    return {
      topic:          String(parsed.topic).trim(),
      angle:          String(parsed.angle ?? '').trim(),
      format:         (formatOptions.includes(parsed.format as ContentFormat) ? parsed.format : 'quick_explainer') as ContentFormat,
      targetKeyword:  String(parsed.targetKeyword).trim(),
      localModifier:  String(parsed.localModifier ?? '').trim(),
      searchQuestion: String(parsed.searchQuestion ?? '').trim(),
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality validator — soft checks logged as warnings, never block saves
// ─────────────────────────────────────────────────────────────────────────────

export function validateGeneratedContent(
  post: GeneratedPost,
  ctx: GenerationContext,
): ContentQualityResult {
  const warnings: string[] = [];
  const title   = post.title ?? '';
  const caption = post.master_caption ?? '';

  // Banned antislop words
  const BANNED = ['delve', 'tapestry', 'vibrant', 'unleash', 'elevate', 'embark', 'transformative', 'paramount', 'journey'];
  for (const w of BANNED) {
    if (title.toLowerCase().includes(w) || caption.toLowerCase().includes(w)) {
      warnings.push(`banned word: "${w}"`);
    }
  }

  // Generic filler patterns
  const GENERIC: RegExp[] = [
    /\d+ tips? (for|to) (your|any|every|a)/i,
    /everything you need to know/i,
    /ultimate guide/i,
    /in today.?s (world|market|landscape|digital age)/i,
    /at the end of the day/i,
    /game.?changer/i,
    /level up your/i,
  ];
  for (const p of GENERIC) {
    if (p.test(title) || p.test(caption)) {
      warnings.push(`generic pattern: "${p.source}"`);
    }
  }

  // Near-duplicate title check (4+ significant words overlap)
  const titleWords = new Set(
    title.toLowerCase().split(/\s+/).filter(w => w.length > 4 && !/^(about|their|which|should|would|could|these|those|where|there|every|after|before)$/.test(w))
  );
  if (titleWords.size >= 3) {
    for (const recent of ctx.recentTitles.slice(0, 20)) {
      const recentWords = recent.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const overlap = recentWords.filter(w => titleWords.has(w));
      if (overlap.length >= 4) {
        warnings.push(`near-duplicate of recent: "${recent.slice(0, 60)}"`);
        break;
      }
    }
  }

  // Topic directive adherence check
  if (ctx.topicResearch && title) {
    const topicWords = ctx.topicResearch.topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const titleLower = title.toLowerCase();
    const matched = topicWords.filter(w => titleLower.includes(w));
    if (topicWords.length >= 3 && matched.length < 2) {
      warnings.push(`title may not reflect researched topic: "${ctx.topicResearch.topic}"`);
    }
  }

  return { passed: warnings.length === 0, warnings };
}

export async function generatePostContent(
  apiKey: string,
  ctx: GenerationContext,
  options?: { signal?: AbortSignal },
): Promise<GeneratePostResult> {
  const request = buildGenerationRequest(ctx);
  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= request.plan.retryLimit; attempt++) {
    if (options?.signal?.aborted) throw new Error('Generation aborted');
    try {
      const parsed = await callOpenAiJson(apiKey, request, attempt, options?.signal);
      const post = normalizeGeneratedPost(parsed, ctx);
      return {
        post,
        meta: {
          mode: request.plan.mode,
          model: request.plan.model,
          attempts: attempt,
          promptChars: request.plan.promptChars,
          elapsedMs: Date.now() - started,
          requestTimeoutMs: request.plan.requestTimeoutMs,
        },
      };
    } catch (err) {
      lastError = err;
      if (attempt >= request.plan.retryLimit || !isRetryableGenerationError(err)) throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ─────────────────────────────────────────────────────────────────────────────
// GBP offer / event variation generation
// ─────────────────────────────────────────────────────────────────────────────

export interface GbpOfferVariation {
  title:            string;
  description:      string;
  cta_text:         string;
  gbp_cta_type:     string;
  gbp_coupon_code?: string;
  gbp_terms?:       string;
  ai_image_prompt:  string;  // Spanish designer brief
}

export interface GbpEventVariation {
  title:           string;
  gbp_event_title: string;
  description:     string;
  gbp_cta_type:    string;
  ai_image_prompt: string;  // Spanish designer brief
}

export interface GbpGenerationContext {
  client: {
    canonical_name:       string;
    industry?:            string | null;
    state?:               string | null;
    phone?:               string | null;
    cta_text?:            string | null;
    brand_primary_color?: string | null;
    brand_json?:          string | null;
    notes?:               string | null;
    language?:            string | null;
  };
  intelligence: {
    brand_voice?:        string | null;
    tone_keywords?:      string | null;
    prohibited_terms?:   string | null;
    approved_ctas?:      string | null;
    service_priorities?: string | null;
    seasonal_notes?:     string | null;
    audience_notes?:     string | null;
    humanization_style?: string | null;
  } | null;
  services:      string[];   // service names for context
  areas:         string[];   // city/area names
  recentTitles:  string[];   // recent offer or event titles to avoid repeating
}

export async function generateGbpVariations(
  apiKey: string,
  type:   'offer' | 'event',
  ctx:    GbpGenerationContext,
): Promise<GbpOfferVariation[] | GbpEventVariation[]> {
  const { client, intelligence: i, services, areas, recentTitles } = ctx;
  const lang = client.language && client.language !== 'en' ? client.language : 'en';

  const brandColor = client.brand_primary_color
    ?? (() => { try { const b = JSON.parse(client.brand_json ?? '{}'); return b.primary_color ?? b.primaryColor ?? null; } catch { return null; } })()
    ?? '#1a73e8';

  let p = `You are a Google Business Profile marketing expert for ${client.canonical_name}.`;
  if (client.industry) p += `\nIndustry: ${client.industry}`;
  if (client.state)    p += `\nLocation: ${client.state}`;
  if (lang !== 'en')   p += `\nWrite ALL captions and text content in ${lang}.`;

  p += `\n\nBUSINESS CONTEXT:`;
  if (i?.service_priorities) p += `\n- Services: ${i.service_priorities}`;
  if (services.length > 0)   p += `\n- Service list: ${services.slice(0, 12).join(', ')}`;
  if (areas.length > 0)      p += `\n- Service areas: ${areas.slice(0, 8).join(', ')}`;
  if (i?.brand_voice)        p += `\n- Brand voice: ${i.brand_voice}`;
  if (i?.tone_keywords)      p += `\n- Tone: ${i.tone_keywords}`;
  if (i?.audience_notes)     p += `\n- Audience: ${i.audience_notes}`;
  if (client.cta_text)       p += `\n- Preferred CTA: ${client.cta_text}`;
  if (i?.approved_ctas)      p += `\n- Approved CTAs: ${i.approved_ctas}`;
  if (i?.prohibited_terms)   p += `\n- NEVER USE: ${i.prohibited_terms}`;
  if (i?.seasonal_notes)     p += `\n- Seasonal notes: ${i.seasonal_notes}`;
  if (i?.humanization_style) p += `\n- Writing style: ${i.humanization_style}`;

  p += `\n\nCONTENT RULES:
- NEVER include exact prices, dollar amounts, percentages, or invented statistics
- Write naturally — no corporate buzzwords, no generic filler openers
- Keep descriptions concise and action-oriented (GBP has character limits)
- Local focus where relevant`;

  if (recentTitles.length > 0) {
    p += `\n\nDO NOT REPEAT these recent ${type}s (use different angles):\n${recentTitles.slice(0, 12).map(t => `- ${t}`).join('\n')}`;
  }

  if (type === 'offer') {
    p += `\n\nGenerate 3 distinct Google Business OFFER post variations for this business.
Use 3 different angles — e.g. service-specific, seasonal, trust/authority.
Return a JSON object with key "variations" containing an array of exactly 3 objects, each with:
- "title": Compelling offer headline, 5-10 words${lang !== 'en' ? ` (in ${lang})` : ''}
- "description": GBP offer caption, 100-200 chars, no prices${lang !== 'en' ? ` (in ${lang})` : ''}
- "cta_text": Short CTA label, 2-4 words${lang !== 'en' ? ` (in ${lang})` : ''}
- "gbp_cta_type": One of BOOK|ORDER|SHOP|LEARN_MORE|SIGN_UP|CALL — best match for this business type
- "gbp_coupon_code": Optional short coupon code (e.g. "FREE-QUOTE"), null if not applicable
- "gbp_terms": Optional 1-line terms (e.g. "New customers only. Limited availability."), null if not needed
- "ai_image_prompt": MUST BE IN SPANISH — design brief for the designer. 1080×1080px square image for GBP. Brand color: ${brandColor}. Include: estilo visual, composición, elementos visuales principales, mood/ambiente, texto sugerido para overlay. 2-3 sentences in Spanish.

IMPORTANT: Return only valid JSON. No markdown.`;
  } else {
    p += `\n\nGenerate 3 distinct Google Business EVENT post variations for this business.
Use 3 different angles — e.g. promotional event, seasonal event, educational/workshop event.
Return a JSON object with key "variations" containing an array of exactly 3 objects, each with:
- "title": Internal event name, 5-10 words${lang !== 'en' ? ` (in ${lang})` : ''}
- "gbp_event_title": Short GBP display title, 3-7 words, compelling${lang !== 'en' ? ` (in ${lang})` : ''}
- "description": GBP event caption, 100-200 chars, action-oriented${lang !== 'en' ? ` (in ${lang})` : ''}
- "gbp_cta_type": One of BOOK|ORDER|SHOP|LEARN_MORE|SIGN_UP|CALL
- "ai_image_prompt": MUST BE IN SPANISH — design brief for the designer. 1080×1080px square image for GBP. Brand color: ${brandColor}. Include: estilo visual, composición, elementos visuales, mood, texto sugerido para overlay. 2-3 sentences in Spanish.

IMPORTANT: Return only valid JSON. No markdown.`;
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:           'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildGenerationSystemMessage('gbp') },
        { role: 'user',   content: p },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.9,
      max_tokens:      2000,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const raw  = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty response from OpenAI');

  const parsed = JSON.parse(raw) as { variations: GbpOfferVariation[] | GbpEventVariation[] };
  if (!Array.isArray(parsed.variations) || parsed.variations.length === 0) {
    throw new Error('No variations returned from OpenAI');
  }
  return parsed.variations;
}
