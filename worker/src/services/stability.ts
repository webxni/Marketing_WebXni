import type { Env } from '../types';

/**
 * Stability AI image generation service.
 *
 * Uses the Stable Image Core endpoint (v2beta) — fast, cost-effective ($0.03/image).
 * Requires STABILITY_API_KEY Cloudflare secret.
 *
 * Flow per image:
 *   1. Translate Spanish designer brief → English Stability prompt (via GPT-4o-mini)
 *   2. Call Stability Core API with prompt + aspect ratio
 *   3. Review result with GPT-4o-mini vision (low-detail)
 *   4. Return result + improved prompt on failure (caller retries up to 3×)
 */

export type StabilityAspectRatio =
  | '1:1'
  | '16:9'
  | '9:16'
  | '4:5'
  | '2:3'
  | '3:2'
  | '5:4'
  | '21:9';

export type StabilityStylePreset =
  | 'photographic'
  | 'cinematic'
  | 'digital-art'
  | 'enhance'
  | 'anime'
  | 'comic-book'
  | 'fantasy-art'
  | 'line-art'
  | 'analog-film'
  | 'neon-punk'
  | 'isometric'
  | 'low-poly'
  | 'origami'
  | 'modeling-compound'
  | 'pixel-art'
  | '3d-model'
  | 'tile-texture';

export interface StabilityParams {
  prompt:          string;
  negativePrompt?: string;
  aspectRatio?:    StabilityAspectRatio;
  outputFormat?:   'webp' | 'jpeg' | 'png';
  stylePreset?:    StabilityStylePreset;
  seed?:           number;
}

export interface StabilityResult {
  imageBase64:  string;
  outputFormat: string;
  seed:         number;
}

export interface ImageReviewResult {
  ok:              boolean;
  reason?:         string;
  improvedPrompt?: string;
}

export interface PromptValidationResult {
  valid: boolean;
  score: number;
  label: 'Good' | 'Weak';
  reasons: string[];
  prompt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Select aspect ratio based on content type and target platforms. */
export function getAspectRatioForContent(
  contentType: string,
  platforms:   string[],
): StabilityAspectRatio {
  if (contentType === 'reel')  return '9:16';
  if (contentType === 'video') return '16:9';
  if (platforms.includes('pinterest') && !platforms.includes('facebook') && !platforms.includes('instagram')) return '2:3';
  if (platforms.includes('instagram') && !platforms.includes('facebook') && !platforms.includes('linkedin')) return '1:1';
  return '16:9'; // default — widest platform compatibility
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured blog prompt builder
//
// Builds prompts following: [scene] + [subject] + [location/context] + [style]
//   + [lighting] + [composition] + [quality]
//
// Each slot emphasizes a different visual angle so the three blog images feel
// complementary rather than repetitive.
// ─────────────────────────────────────────────────────────────────────────────

export type BlogImageSlot = 1 | 2 | 3;

export const MAX_BLOG_IMAGES = 3;
export const MAX_BLOG_IMAGE_ATTEMPTS = 2;
export const PROMPT_QUALITY_THRESHOLD = 0.72;

export interface BlogPromptContext {
  slot:          BlogImageSlot;
  blogTitle:     string;
  targetKeyword?:string;
  sectionHeading?: string;   // heading used to anchor mid-content image
  serviceType?:  string;     // 'interior repainting', 'roof replacement', etc.
  industry?:     string;     // 'remodeling', 'roofing', 'locksmith', etc.
  location?:     string;     // 'Los Angeles, CA' — derived from service areas
  clientName?:   string;
}

export interface BuildImagePromptInput {
  title: string;
  section?: string;
  service?: string;
  location?: string;
  intent?: string;
  slot?: BlogImageSlot;
}

export interface SocialImagePromptContext {
  title: string;
  businessType?: string | null;
  service?: string | null;
  location?: string | null;
  intent?: 'educational' | 'promo' | 'cta';
  clientName?: string | null;
  spanishBrief?: string | null;
}

const SLOT_FRAMING: Record<BlogImageSlot, { angle: string; shot: string; intent: string }> = {
  1: {
    angle:  'a hero establishing shot introducing the topic',
    shot:   'wide angle, eye-level, editorial magazine cover framing',
    intent: 'sets the visual tone — must be inviting, trustworthy and professional',
  },
  2: {
    angle:  'a process / close-up action view reinforcing the main point',
    shot:   'medium close-up, slightly elevated perspective, shallow depth of field',
    intent: 'shows craftsmanship or detail — draws the reader deeper into the story',
  },
  3: {
    angle:  'a finished-result / satisfied-client style shot',
    shot:   'wide angle, warm natural light, welcoming composition',
    intent: 'closes the narrative — suggests success and outcome before the CTA',
  },
};

function cleanFragment(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePhrase(value: string | null | undefined): string {
  return cleanFragment(value).replace(/[.,;:]+$/g, '');
}

function uniqueTokens(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const value of values) {
    const parts = normalizePhrase(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((part) => part.length >= 4)
      .filter((part) => !['with', 'from', 'into', 'that', 'this', 'your', 'home', 'blog', 'guide', 'tips', 'best', 'right', 'small'].includes(part));
    for (const part of parts) {
      if (seen.has(part)) continue;
      seen.add(part);
      tokens.push(part);
    }
  }
  return tokens;
}

function hasAnyToken(haystack: string, tokens: string[]): boolean {
  const lower = haystack.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}

function buildSceneSubject(input: BuildImagePromptInput): string {
  const section = normalizePhrase(input.section);
  const service = normalizePhrase(input.service) || 'professional service';
  const title = normalizePhrase(input.title);
  const subject = section || title || service;

  if (input.slot === 1) {
    return `Professional ${service} team illustrating ${title}`;
  }
  if (input.slot === 2) {
    return `Detailed ${service} action scene focused on ${subject}`;
  }
  return `Completed ${service} result showcasing ${subject}`;
}

function inferServiceAction(businessType: string, service: string, intent: 'educational' | 'promo' | 'cta'): string {
  const raw = `${businessType} ${service}`.toLowerCase();
  if (/roof/.test(raw)) return intent === 'promo' ? 'repairing and inspecting residential roofing materials' : 'repairing shingles on a residential roof';
  if (/lock|key|locksmith/.test(raw)) return intent === 'cta' ? 'installing and testing a new residential lockset' : 'rekeying and installing secure residential door hardware';
  if (/bath|tile|shower/.test(raw)) return 'installing bathroom tile during an active remodel';
  if (/kitchen|cabinet/.test(raw)) return 'installing cabinetry and finish materials during a kitchen remodel';
  if (/paint/.test(raw)) return 'painting and finishing interior residential walls';
  if (/remodel|renovat|construction|builder/.test(raw)) return 'completing a residential remodeling project with visible craftsmanship';
  return `performing ${service || businessType || 'professional service'} work on site`;
}

function inferSocialEnvironment(businessType: string, service: string): string {
  const raw = `${businessType} ${service}`.toLowerCase();
  if (/roof/.test(raw)) return 'real residential job site, visible roofline, tools and materials in active use';
  if (/lock|key|locksmith/.test(raw)) return 'real residential entryway, front door hardware, clean exterior home setting';
  if (/bath|tile|shower/.test(raw)) return 'small residential bathroom remodel, premium tile, glass shower, clean construction staging';
  if (/kitchen|cabinet/.test(raw)) return 'residential kitchen job site, modern cabinetry, stone surfaces, organized workspace';
  return 'real residential service environment, in-progress work area, authentic materials, clean staging';
}

export function buildSocialImagePrompt(ctx: SocialImagePromptContext): string {
  const businessType = normalizePhrase(ctx.businessType) || 'professional service';
  const service = normalizePhrase(ctx.service) || businessType;
  const location = normalizePhrase(ctx.location);
  const intent = ctx.intent ?? 'educational';
  const action = inferServiceAction(businessType, service, intent);
  const environment = inferSocialEnvironment(businessType, service);
  const intentDetail =
    intent === 'promo'
      ? 'showing a polished finished result suitable for a promotional social post'
      : intent === 'cta'
        ? 'showing trustworthy service execution that supports a direct response call-to-action'
        : 'showing hands-on professional work that teaches what the service looks like in real life';
  const locationContext = location ? `${location} residential context` : 'local residential context';
  const briefHint = normalizePhrase(ctx.spanishBrief)
    .replace(/[.!?].*$/g, '')
    .slice(0, 120);

  return [
    `Professional ${businessType} team ${action}`,
    `${service} service in progress`,
    locationContext,
    environment,
    intentDetail,
    'natural daylight with clean balanced exposure',
    'wide-angle professional documentary camera style, real job site perspective',
    'clean, modern, high-end look, realistic, high detail, photorealistic, 4k',
    briefHint,
  ].filter(Boolean).join(', ');
}

export function validateSocialImagePrompt(prompt: string, ctx: SocialImagePromptContext): PromptValidationResult {
  const normalized = cleanFragment(prompt);
  const businessTokens = uniqueTokens([ctx.businessType]);
  const serviceTokens = uniqueTokens([ctx.service, ctx.title]);
  const locationTokens = uniqueTokens([ctx.location]);
  const lower = normalized.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (normalized.length >= 110) score += 0.12;
  else reasons.push('Prompt is too short');

  if ((normalized.match(/,/g) ?? []).length >= 6) score += 0.12;
  else reasons.push('Prompt is not fully structured');

  if (hasAnyToken(lower, businessTokens)) score += 0.2;
  else reasons.push('Missing business type');

  if (hasAnyToken(lower, serviceTokens)) score += 0.22;
  else reasons.push('Missing service keyword');

  if (!locationTokens.length || hasAnyToken(lower, locationTokens)) score += locationTokens.length ? 0.14 : 0.08;
  else reasons.push('Missing location context');

  if (/\b(installing|repairing|rekeying|painting|inspecting|completing|working|testing|replacing)\b/i.test(normalized)) score += 0.12;
  else reasons.push('Missing real-world service action');

  if (/\b(job site|residential|entryway|roof|bathroom|kitchen|door|tile|materials|tools)\b/i.test(normalized)) score += 0.1;
  else reasons.push('Missing professional context');

  if (/\b(realistic|photorealistic|high detail|4k|daylight|wide-angle|camera style|modern|high-end)\b/i.test(normalized)) score += 0.12;
  else reasons.push('Missing quality or camera direction');

  if (/\b(nice|beautiful|modern scene|service business|professional scene)\b/i.test(normalized)) {
    score -= 0.18;
    reasons.push('Contains generic wording');
  }

  const boundedScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return {
    valid: boundedScore >= PROMPT_QUALITY_THRESHOLD,
    score: boundedScore,
    label: boundedScore >= PROMPT_QUALITY_THRESHOLD ? 'Good' : 'Weak',
    reasons,
    prompt: normalized,
  };
}

export function shouldRetrySocialImage(review: ImageReviewResult): boolean {
  if (review.ok) return false;
  const reason = String(review.reason ?? '').toLowerCase();
  return /\birrelevant|unrelated|wrong|mismatch|service|industry|topic\b/.test(reason);
}

export function buildImagePrompt(input: BuildImagePromptInput): string {
  const slot = input.slot ?? 1;
  const framing = SLOT_FRAMING[slot];
  const service = normalizePhrase(input.service) || 'professional service';
  const location = normalizePhrase(input.location);
  const section = normalizePhrase(input.section);
  const title = normalizePhrase(input.title);
  const environment =
    slot === 1
      ? 'residential service project with clean materials, human presence, and realistic working context'
      : slot === 2
        ? 'on-site working environment with visible craftsmanship, premium finishes, and uncluttered staging'
        : 'finished residential environment with refined materials, organized styling, and client-ready presentation';
  const lighting =
    slot === 3
      ? 'warm natural golden-hour interior light with balanced highlights and true-to-life color'
      : 'soft natural lighting with balanced exposure and gentle directional highlights';
  const camera =
    slot === 2
      ? 'medium-wide angle composition, slightly elevated perspective, crisp subject focus'
      : `${framing.shot}, clean lines, professional editorial composition`;
  const quality = 'highly detailed, realistic, photographic, sharp focus, professional architectural photography, 4k';
  const locationContext = location ? `${location} context` : 'local service context';

  return [
    buildSceneSubject({ ...input, slot }),
    `${service} project in ${locationContext}`,
    section || title,
    environment,
    lighting,
    camera,
    quality,
    framing.intent,
  ].filter(Boolean).join(', ');
}

/** Deterministic structured prompt — no external LLM call required. */
export function buildStructuredBlogPrompt(ctx: BlogPromptContext): string {
  return buildImagePrompt({
    title: ctx.blogTitle,
    section: cleanFragment(ctx.sectionHeading) || cleanFragment(ctx.targetKeyword) || cleanFragment(ctx.blogTitle),
    service: cleanFragment(ctx.serviceType) || cleanFragment(ctx.industry) || 'professional service',
    location: cleanFragment(ctx.location),
    intent: SLOT_FRAMING[ctx.slot].intent,
    slot: ctx.slot,
  });
}

export function validateImagePrompt(prompt: string, ctx: BlogPromptContext): PromptValidationResult {
  const normalized = cleanFragment(prompt);
  const reasons: string[] = [];
  let score = 0;

  const serviceTokens = uniqueTokens([ctx.serviceType, ctx.industry, ctx.targetKeyword]);
  const locationTokens = uniqueTokens([ctx.location]);
  const subjectTokens = uniqueTokens([ctx.sectionHeading, ctx.blogTitle, ctx.targetKeyword]);
  const lower = normalized.toLowerCase();

  if (normalized.length >= 110) score += 0.12;
  else reasons.push('Prompt is too short');

  if ((normalized.match(/,/g) ?? []).length >= 5) score += 0.1;
  else reasons.push('Prompt is not fully structured');

  if (hasAnyToken(lower, serviceTokens)) score += 0.24;
  else reasons.push('Missing service keyword');

  if (!locationTokens.length || hasAnyToken(lower, locationTokens)) score += locationTokens.length ? 0.18 : 0.08;
  else reasons.push('Missing location context');

  if (hasAnyToken(lower, subjectTokens)) score += 0.22;
  else reasons.push('Missing topic subject');

  if (/\b(interior|bathroom|kitchen|roof|locksmith|tile|contractor|service|remodel|repair|installation|home|residential|project)\b/i.test(normalized)) {
    score += 0.08;
  } else {
    reasons.push('Subject feels abstract');
  }

  if (/\b(soft natural|warm natural|daylight|lighting|wide angle|composition|photographic|realistic|4k|detail)\b/i.test(normalized)) {
    score += 0.14;
  } else {
    reasons.push('Missing visual direction');
  }

  if (/\b(nice|beautiful|modern)\b/i.test(normalized)) {
    score -= 0.16;
    reasons.push('Contains generic adjectives');
  }

  if (ctx.slot === 1) {
    const heroKeywordPresent = hasAnyToken(lower, uniqueTokens([ctx.blogTitle, ctx.targetKeyword]));
    const heroServicePresent = hasAnyToken(lower, serviceTokens);
    const heroLocationPresent = !locationTokens.length || hasAnyToken(lower, locationTokens);
    if (heroKeywordPresent) score += 0.08;
    else reasons.push('Hero prompt missing title keyword');
    if (!heroServicePresent) reasons.push('Hero prompt missing service keyword');
    if (!heroLocationPresent) reasons.push('Hero prompt missing location');
  }

  const boundedScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return {
    valid: boundedScore >= PROMPT_QUALITY_THRESHOLD && reasons.filter((reason) => reason.startsWith('Hero prompt')).length === 0,
    score: boundedScore,
    label: boundedScore >= PROMPT_QUALITY_THRESHOLD ? 'Good' : 'Weak',
    reasons,
    prompt: normalized,
  };
}

export const BLOG_NEGATIVE_PROMPT = [
  'cartoon', 'illustration', 'abstract', 'unrealistic', 'distorted', 'low quality',
  'text', 'watermark', 'logo', 'signage with letters',
  'distorted anatomy', 'extra fingers', 'deformed faces',
  'blurry', 'low resolution', 'jpeg artifacts',
  'anime', '3d render',
  'oversaturated', 'harsh lighting', 'cluttered background',
].join(', ');

export async function resolveStabilityApiKeys(env: Env): Promise<{ openAiKey: string; stabilityKey: string }> {
  let openAiKey = env.OPENAI_API_KEY || '';
  let stabilityKey = env.STABILITY_API_KEY || '';

  // Some runtimes under nodejs_compat expose bindings through process.env.
  try {
    const procEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (!openAiKey) openAiKey = procEnv?.OPENAI_API_KEY || '';
    if (!stabilityKey) stabilityKey = procEnv?.STABILITY_API_KEY || '';
  } catch {
    // ignore
  }

  if (!openAiKey || !stabilityKey) {
    try {
      const raw = await env.KV_BINDING.get('settings:system');
      const settings = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      if (!openAiKey) openAiKey = settings['ai_api_key'] || settings['OPENAI_API_KEY'] || '';
      if (!stabilityKey) stabilityKey = settings['stability_api_key'] || settings['STABILITY_API_KEY'] || '';
    } catch {
      // ignore malformed KV settings
    }
  }

  if (!stabilityKey) {
    console.warn('[stability] STABILITY_API_KEY missing at runtime', {
      hasEnvBinding: Boolean(env.STABILITY_API_KEY),
      hasOpenAiBinding: Boolean(env.OPENAI_API_KEY),
    });
  }

  return { openAiKey, stabilityKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt translation (Spanish brief → English Stability prompt)
// ─────────────────────────────────────────────────────────────────────────────

export async function buildStabilityPrompt(
  openAiKey: string,
  spanishBrief: string,
  context: { topic: string; industry: string },
): Promise<string> {
  if (!openAiKey || !spanishBrief) return spanishBrief;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        temperature: 0.3,
        max_tokens:  180,
        messages: [{
          role:    'user',
          content: `Convert this Spanish marketing design brief into a concise, effective Stability AI image prompt in English (max 120 words). Focus only on visual elements: scene, style, lighting, mood, composition. Remove text-overlay instructions, tool names, and Spanish dimensions.

Industry: ${context.industry}
Topic: ${context.topic}
Spanish brief: ${spanishBrief}

Return ONLY the English Stability prompt.`,
        }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return spanishBrief;
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || spanishBrief;
  } catch {
    return spanishBrief;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stability Core generation
// ─────────────────────────────────────────────────────────────────────────────

export async function generateStabilityImage(
  apiKey: string,
  params: StabilityParams,
): Promise<StabilityResult> {
  const form = new FormData();
  form.append('prompt',        params.prompt);
  form.append('output_format', params.outputFormat ?? 'webp');
  if (params.aspectRatio)    form.append('aspect_ratio',   params.aspectRatio);
  if (params.negativePrompt) form.append('negative_prompt', params.negativePrompt);
  if (params.stylePreset)    form.append('style_preset',   params.stylePreset);
  if (typeof params.seed === 'number' && params.seed > 0) form.append('seed', String(params.seed));

  const res = await fetch(
    'https://api.stability.ai/v2beta/stable-image/generate/core',
    {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
      body:    form,
      signal:  AbortSignal.timeout(60_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Stability API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as { image?: string; finish_reason?: string; seed?: number };

  if (!data.image) {
    throw new Error(`Stability: empty image — finish_reason=${data.finish_reason ?? 'unknown'}`);
  }
  if (data.finish_reason === 'CONTENT_FILTERED') {
    throw new Error('Stability: content filtered — adjust prompt');
  }
  if (data.finish_reason !== 'SUCCESS') {
    throw new Error(`Stability generation failed: ${data.finish_reason}`);
  }

  return {
    imageBase64:  data.image,
    outputFormat: params.outputFormat ?? 'webp',
    seed:         data.seed ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Image auto-review via GPT-4o-mini vision (low detail — cheap and fast)
// ─────────────────────────────────────────────────────────────────────────────

export async function reviewGeneratedImage(
  openAiKey: string,
  imageBase64: string,
  context: { topic: string; industry: string; clientName: string },
): Promise<ImageReviewResult> {
  if (!openAiKey) return { ok: true };
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        temperature: 0,
        max_tokens:  200,
        messages: [{
          role:    'user',
          content: [
            {
              type:      'image_url',
              image_url: { url: `data:image/webp;base64,${imageBase64}`, detail: 'low' },
            },
            {
              type: 'text',
              text: `Evaluate this AI-generated image for a professional ${context.industry} business (${context.clientName}) marketing post about "${context.topic}".

Check: (1) relevant to topic/industry, (2) no broken artifacts or distortion, (3) professional quality, (4) no garbled text, (5) appropriate for a business.

Return JSON only:
{ "ok": true }
or
{ "ok": false, "reason": "one-line reason", "improved_prompt": "improved English Stability AI prompt (max 80 words)" }`,
            },
          ],
        }],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) return { ok: true }; // permissive on API failure
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw  = data.choices?.[0]?.message?.content;
    if (!raw) return { ok: true };

    const parsed = JSON.parse(raw) as { ok?: boolean; reason?: string; improved_prompt?: string };
    return {
      ok:              parsed.ok !== false,
      reason:          parsed.reason,
      improvedPrompt:  parsed.improved_prompt,
    };
  } catch {
    return { ok: true }; // be permissive — generation errors are not review failures
  }
}
