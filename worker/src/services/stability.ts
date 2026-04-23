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

/** Deterministic structured prompt — no external LLM call required. */
export function buildStructuredBlogPrompt(ctx: BlogPromptContext): string {
  const framing = SLOT_FRAMING[ctx.slot];
  const subject =
    cleanFragment(ctx.sectionHeading) ||
    cleanFragment(ctx.targetKeyword) ||
    cleanFragment(ctx.blogTitle);
  const service = cleanFragment(ctx.serviceType) || cleanFragment(ctx.industry) || 'professional service';
  const locationTag = cleanFragment(ctx.location);
  const locationPhrase = locationTag ? `in ${locationTag}` : '';

  const parts = [
    // [scene] + [subject]
    `Professional editorial photograph depicting ${framing.angle}: ${subject}`,
    // [location / context]
    `real ${service} business setting ${locationPhrase}`.trim(),
    // [style]
    'clean modern documentary style, realistic human subjects, authentic textures, branded-magazine quality',
    // [lighting]
    'soft natural daylight with gentle directional highlights, balanced exposure, no harsh shadows',
    // [composition]
    `${framing.shot}, rule-of-thirds composition, uncluttered background, ample negative space for potential text overlay`,
    // [quality]
    'ultra-detailed, sharp focus, photographically accurate, 4k, color-graded for print, professional photography',
    // [framing intent guidance]
    framing.intent,
  ];

  return parts.filter(Boolean).join('. ');
}

export const BLOG_NEGATIVE_PROMPT = [
  'text', 'watermark', 'logo', 'signage with letters',
  'distorted anatomy', 'extra fingers', 'deformed faces',
  'blurry', 'low quality', 'low resolution', 'jpeg artifacts',
  'cartoon', 'anime', 'illustration', '3d render',
  'oversaturated', 'harsh lighting', 'cluttered background',
].join(', ');

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
