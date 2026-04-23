/**
 * Autonomous content creation orchestrator.
 *
 * Full flow per post:
 *   1. Load client + intelligence + service areas
 *   2. Resolve platforms, content type, publish date
 *   3. Run topic research (researchTopic)
 *   4. Generate post content (generatePostContent — gpt-4o/mini)
 *   5. Translate Spanish image brief → English Stability prompt
 *   6. Generate image with Stability Core (up to 3 attempts)
 *   7. Auto-review each image; retry with improved prompt on failure
 *   8. Upload best image to R2 MEDIA bucket
 *   9. Create post in DB (status = pending_approval)
 *  10. Send Discord notification embed with preview
 */

import type { Env, ClientRow } from '../types';
import { createPost, getClientBySlug, getClientPlatforms, updatePost } from '../db/queries';
import {
  generatePostContent,
  researchTopic,
  detectFormatFromTitle,
  type GenerationContext,
  type ContentFormat,
  type TopicResearch,
} from '../services/openai';
import {
  buildStabilityPrompt,
  buildStructuredBlogPrompt,
  generateStabilityImage,
  reviewGeneratedImage,
  getAspectRatioForContent,
  base64ToUint8Array,
  BLOG_NEGATIVE_PROMPT,
  resolveStabilityApiKeys,
  type BlogImageSlot,
} from '../services/stability';
import { serializeBlogBodyImages, type BlogBodyImage } from '../modules/blog-body-images';
import { discordSend, DISCORD_COLORS } from '../services/discord';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateContentParams {
  clientSlug:    string;
  platforms?:    string[];
  contentType?:  'image' | 'reel' | 'video' | 'blog';
  topicOverride?: string;
  publishDate?:  string;
  status?:       'draft' | 'pending_approval';
  notifyDiscord?: boolean;
  triggeredBy?:  string;
}

export interface CreateContentResult {
  postId:        string;
  title:         string;
  platforms:     string[];
  imageStatus:   'generated' | 'failed' | 'skipped' | 'no_key';
  imageAttempts: number;
  r2Key:         string | null;
  status:        string;
  wpCaptionGbp?: string | null;
  wpCaptionLi?:  string | null;
}

interface IntelRow {
  brand_voice?:        string | null;
  tone_keywords?:      string | null;
  prohibited_terms?:   string | null;
  approved_ctas?:      string | null;
  content_goals?:      string | null;
  service_priorities?: string | null;
  content_angles?:     string | null;
  seasonal_notes?:     string | null;
  audience_notes?:     string | null;
  primary_keyword?:    string | null;
  secondary_keywords?: string | null;
  local_seo_themes?:   string | null;
  humanization_style?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeContentType(raw: string | undefined): 'image' | 'reel' | 'video' | 'blog' {
  if (raw === 'reel' || raw === 'video' || raw === 'blog') return raw;
  return 'image';
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function str(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestration
// ─────────────────────────────────────────────────────────────────────────────

export async function createContentWithImage(
  env: Env,
  params: CreateContentParams,
  openAiKey: string,
): Promise<CreateContentResult> {
  const db = env.DB;

  // ── 1. Load client ──────────────────────────────────────────────────────────
  const client = await getClientBySlug(db, params.clientSlug);
  if (!client) throw new Error(`Client not found: ${params.clientSlug}`);

  const contentType = normalizeContentType(params.contentType);

  // ── 2. Resolve platforms ────────────────────────────────────────────────────
  let platforms: string[] = params.platforms ?? [];
  if (platforms.length === 0) {
    const clientPlatforms = await getClientPlatforms(db, client.id);
    platforms = clientPlatforms.map(p => p.platform).filter(Boolean);
    // Filter to content-type compatible platforms
    if (contentType === 'blog') {
      platforms = ['website_blog'];
    } else if (contentType === 'reel') {
      const REEL_COMPATIBLE = new Set(['facebook', 'instagram', 'tiktok', 'youtube']);
      platforms = platforms.filter(p => REEL_COMPATIBLE.has(p));
    }
  }
  if (platforms.length === 0) platforms = ['facebook', 'instagram'];

  // ── 3. Resolve publish date ─────────────────────────────────────────────────
  const publishDate = params.publishDate ?? `${today()}T10:00`;

  // ── 4. Load intelligence + service context ──────────────────────────────────
  const [intel, fbRows, recRows, svcAreaRows, svcNameRows] = await Promise.all([
    db.prepare('SELECT * FROM client_intelligence WHERE client_id = ?')
      .bind(client.id).first<IntelRow>().then(r => r ?? null),
    db.prepare('SELECT sentiment, message AS note FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 8')
      .bind(client.id).all<{ sentiment: string; note: string }>(),
    db.prepare(`SELECT title, master_caption FROM posts WHERE client_id = ? AND status NOT IN ('cancelled') ORDER BY created_at DESC LIMIT 20`)
      .bind(client.id).all<{ title: string | null; master_caption: string | null }>(),
    db.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 8')
      .bind(client.id).all<{ city: string }>(),
    db.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 12')
      .bind(client.id).all<{ name: string }>(),
  ]);

  const recentTitles  = recRows.results.map(r => r.title ?? r.master_caption?.slice(0, 80) ?? '').filter(Boolean) as string[];
  const serviceAreas  = svcAreaRows.results.map(r => r.city);
  const serviceNames  = svcNameRows.results.map(r => r.name);
  const recentFormats = recRows.results
    .map(r => detectFormatFromTitle(r.title ?? ''))
    .filter((f): f is ContentFormat => f !== null);

  // ── 5. Topic research ───────────────────────────────────────────────────────
  let topicResearch: TopicResearch | null = null;

  if (params.topicOverride) {
    // User supplied a specific topic — use it directly
    topicResearch = {
      topic:          params.topicOverride,
      angle:          'user-specified',
      format:         'quick_explainer',
      targetKeyword:  params.topicOverride.toLowerCase().split(' ').slice(0, 4).join(' '),
      localModifier:  serviceAreas[0] ?? '',
      searchQuestion: params.topicOverride,
    };
  } else {
    try {
      topicResearch = await researchTopic(openAiKey, {
        client:        { canonical_name: client.canonical_name, industry: client.industry, state: client.state, language: client.language },
        intelligence:  intel ? { service_priorities: intel.service_priorities, seasonal_notes: intel.seasonal_notes, local_seo_themes: intel.local_seo_themes } : null,
        contentType,
        contentIntent: 'educational',
        platforms,
        publishDate:   publishDate.slice(0, 10),
        recentTitles,
        recentFormats,
        serviceAreas,
        serviceNames,
      });
    } catch { /* non-fatal — proceed without research */ }
  }

  // ── 6. Generate post content (OpenAI) ───────────────────────────────────────
  const ctx: GenerationContext = {
    client: {
      canonical_name:      client.canonical_name,
      notes:               client.notes,
      brand_json:          client.brand_json,
      brand_primary_color: (client as ClientRow & { brand_primary_color?: string | null }).brand_primary_color ?? null,
      language:            client.language,
      phone:               client.phone,
      cta_text:            client.cta_text,
      industry:            client.industry,
      state:               client.state,
      owner_name:          client.owner_name,
      wp_template_key:     client.wp_template_key ?? client.wp_template ?? null,
    },
    intelligence:  intel as GenerationContext['intelligence'],
    recentTitles,
    feedback:      fbRows.results,
    publishDate:   publishDate.slice(0, 10),
    contentType,
    platforms,
    contentIntent: 'educational',
    topicResearch,
    serviceAreas,
    serviceNames,
    recentFormats,
    highQuality:   true, // autonomous creation always uses high-quality
  };

  const genResult = await generatePostContent(openAiKey, ctx);
  const p = genResult.post;

  // ── 7. Stability image generation (3-attempt loop) ──────────────────────────
  const { stabilityKey: stabKey } = await resolveStabilityApiKeys(env);
  let imageStatus: CreateContentResult['imageStatus'] = 'skipped';
  let imageAttempts = 0;
  let r2Key: string | null = null;
  let blogBodyImagesJson: string | null = null;

  // Blog content gets a dedicated 3-image path (hero + mid + pre-CTA).
  if (stabKey && contentType === 'blog') {
    const location = serviceAreas[0] ?? client.state ?? '';
    const serviceType = (p.target_keyword ?? '') || serviceNames[0] || client.industry || '';
    const sectionHeadings = extractSectionHeadings(p.blog_content ?? '');

    const blogImages: BlogBodyImage[] = [];
    let anyGenerated = false;
    let anyFailed = false;
    for (const slot of [1, 2, 3] as const) {
      const heading =
        slot === 1 ? (p.title ?? '') :
        slot === 2 ? (sectionHeadings[1] ?? sectionHeadings[0] ?? p.title ?? '') :
                     (sectionHeadings[sectionHeadings.length - 1] ?? p.title ?? '');

      const imgResult = await generateBlogSlotImage(env, openAiKey, stabKey, {
        slot,
        blogTitle:      p.title ?? topicResearch?.topic ?? '',
        targetKeyword:  p.target_keyword ?? topicResearch?.targetKeyword,
        sectionHeading: heading,
        serviceType,
        industry:       client.industry ?? '',
        location,
        clientName:     client.canonical_name,
        clientId:       client.id,
      });
      blogImages.push(imgResult);
      if (imgResult.status === 'generated') anyGenerated = true;
      if (imgResult.status === 'failed')    anyFailed = true;
    }
    blogBodyImagesJson = serializeBlogBodyImages(blogImages);

    // Promote slot 1 to the legacy featured/asset slot for backwards-compat.
    const slot1 = blogImages.find((i) => i.slot === 1);
    if (slot1?.r2_key) r2Key = slot1.r2_key;

    imageStatus = anyGenerated ? 'generated' : (anyFailed ? 'failed' : 'skipped');
    imageAttempts = Math.max(0, ...blogImages.map((i) => i.attempts ?? 0));
  } else if (stabKey && contentType !== 'blog' && p.ai_image_prompt) {
    imageStatus = 'failed';
    const aspectRatio = getAspectRatioForContent(contentType, platforms);
    const postId_tmp  = crypto.randomUUID().replace(/-/g, '').toLowerCase();

    // Translate Spanish brief → English Stability prompt (once, then refine per attempt)
    let stabilityPrompt = await buildStabilityPrompt(openAiKey, p.ai_image_prompt, {
      topic:    topicResearch?.topic ?? p.title ?? '',
      industry: client.industry ?? '',
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      imageAttempts = attempt;
      try {
        const imgResult = await generateStabilityImage(stabKey, {
          prompt:       stabilityPrompt,
          aspectRatio,
          outputFormat: 'webp',
          negativePrompt: 'text, watermark, blurry, distorted, low quality, cartoon, ugly',
        });

        // Review the generated image
        const review = await reviewGeneratedImage(openAiKey, imgResult.imageBase64, {
          topic:      topicResearch?.topic ?? p.title ?? '',
          industry:   client.industry ?? '',
          clientName: client.canonical_name,
        });

        if (review.ok || attempt === 3) {
          // Store in R2
          const ext   = 'webp';
          const rKey  = `${client.id}/ai-generated/${postId_tmp}-${attempt}.${ext}`;
          await env.MEDIA.put(rKey, base64ToUint8Array(imgResult.imageBase64), {
            httpMetadata:   { contentType: 'image/webp' },
            customMetadata: { source: 'stability', clientId: client.id, prompt: stabilityPrompt.slice(0, 500) },
          });
          r2Key       = rKey;
          imageStatus = 'generated';
          break;
        }

        // Image failed review — improve prompt for next attempt
        if (review.improvedPrompt) {
          stabilityPrompt = review.improvedPrompt;
        } else {
          stabilityPrompt = `${stabilityPrompt}, photorealistic, high quality, professional photography`;
        }
      } catch (err) {
        console.warn(`[autonomous-content] Stability attempt ${attempt}/3 failed: ${str(err)}`);
        if (attempt === 3) {
          imageStatus = 'failed';
          imageAttempts = attempt;
        }
      }
    }
  } else if (!stabKey) {
    imageStatus = 'no_key';
  }

  // ── 8. Create post in DB ─────────────────────────────────────────────────────
  const finalStatus  = params.status ?? 'pending_approval';
  const assetDelivered = r2Key ? 1 : 0;

  const newPost = await createPost(db, {
    client_id:               client.id,
    title:                   p.title ?? `${client.canonical_name} — ${today()}`,
    status:                  finalStatus,
    content_type:            contentType,
    platforms:               JSON.stringify(platforms),
    publish_date:            publishDate,
    master_caption:          p.master_caption ?? null,
    cap_facebook:            p.cap_facebook   ?? null,
    cap_instagram:           p.cap_instagram  ?? null,
    cap_linkedin:            p.cap_linkedin   ?? null,
    cap_x:                   p.cap_x          ?? null,
    cap_threads:             p.cap_threads    ?? null,
    cap_tiktok:              p.cap_tiktok     ?? null,
    cap_pinterest:           p.cap_pinterest  ?? null,
    cap_bluesky:             p.cap_bluesky    ?? null,
    cap_google_business:     p.cap_google_business ?? null,
    blog_content:            p.blog_content   ?? null,
    blog_excerpt:            p.blog_excerpt   ?? null,
    seo_title:               p.seo_title      ?? null,
    meta_description:        p.meta_description ?? null,
    target_keyword:          p.target_keyword ?? null,
    secondary_keywords:      p.secondary_keywords ?? null,
    slug:                    p.slug           ?? null,
    ai_image_prompt:         p.ai_image_prompt ?? null,
    ai_video_prompt:         p.ai_video_prompt ?? null,
    video_script:            p.video_script   ?? null,
    asset_r2_key:            r2Key,
    asset_r2_bucket:         r2Key ? 'MEDIA' : null,
    asset_type:              r2Key ? 'image' : null,
    asset_delivered:         assetDelivered,
    ready_for_automation:    0,
    gbp_cta_type:            contentType === 'blog' ? 'LEARN_MORE' : null,
    gbp_topic_type:          contentType === 'blog' ? 'STANDARD' : null,
    scheduled_by_automation: 0,
    platform_manual_override: 0,
    generation_run_id:       null,
  });

  if (blogBodyImagesJson) {
    await updatePost(db, newPost.id, { blog_body_images: blogBodyImagesJson });
  }

  // ── 9. Discord notification ──────────────────────────────────────────────────
  if (params.notifyDiscord !== false) {
    try {
      await notifyDiscordContentCreated(env, {
        postId:       newPost.id,
        title:        newPost.title ?? '',
        clientName:   client.canonical_name,
        platforms,
        publishDate,
        caption:      p.master_caption ?? '',
        imageStatus,
        imageAttempts,
        r2Key,
        triggeredBy:  params.triggeredBy ?? 'agent',
      });
    } catch (err) {
      console.warn(`[autonomous-content] Discord notify failed: ${str(err)}`);
    }
  }

  return {
    postId:       newPost.id,
    title:        newPost.title ?? '',
    platforms,
    imageStatus,
    imageAttempts,
    r2Key,
    status:       finalStatus,
    wpCaptionGbp: p.cap_google_business ?? null,
    wpCaptionLi:  p.cap_linkedin ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Blog image slot generator — used for each of the 3 body images.
// Returns a BlogBodyImage entry regardless of outcome (status tracks failure).
// ─────────────────────────────────────────────────────────────────────────────

export interface BlogSlotGenContext {
  slot:           BlogImageSlot;
  blogTitle:      string;
  targetKeyword?: string | null;
  sectionHeading?: string;
  serviceType?:   string;
  industry?:      string;
  location?:      string;
  clientName?:    string;
  clientId:       string;
  /** Override the auto-built prompt — used by manual regenerate. */
  promptOverride?: string;
}

export async function generateBlogSlotImage(
  env: Env,
  openAiKey: string,
  stabilityKey: string,
  ctx: BlogSlotGenContext,
): Promise<BlogBodyImage> {
  const basePrompt = ctx.promptOverride?.trim() || buildStructuredBlogPrompt({
    slot:           ctx.slot,
    blogTitle:      ctx.blogTitle,
    targetKeyword:  ctx.targetKeyword ?? undefined,
    sectionHeading: ctx.sectionHeading,
    serviceType:    ctx.serviceType,
    industry:       ctx.industry,
    location:       ctx.location,
    clientName:     ctx.clientName,
  });

  let prompt = basePrompt;
  let attempts = 0;
  let lastError = '';
  const postId_tmp = crypto.randomUUID().replace(/-/g, '').toLowerCase();

  for (let attempt = 1; attempt <= 3; attempt++) {
    attempts = attempt;
    try {
      const img = await generateStabilityImage(stabilityKey, {
        prompt,
        aspectRatio:    '16:9',
        outputFormat:   'webp',
        stylePreset:    'photographic',
        negativePrompt: BLOG_NEGATIVE_PROMPT,
      });

      const review = await reviewGeneratedImage(openAiKey, img.imageBase64, {
        topic:      ctx.sectionHeading || ctx.blogTitle,
        industry:   ctx.industry ?? '',
        clientName: ctx.clientName ?? '',
      });

      if (review.ok || attempt === 3) {
        const rKey = `${ctx.clientId}/ai-generated/blog-${postId_tmp}-slot${ctx.slot}-a${attempt}.webp`;
        await env.MEDIA.put(rKey, base64ToUint8Array(img.imageBase64), {
          httpMetadata:   { contentType: 'image/webp' },
          customMetadata: {
            source: 'stability-blog',
            slot:   String(ctx.slot),
            prompt: prompt.slice(0, 500),
          },
        });

        return {
          slot:       ctx.slot,
          r2_key:     rKey,
          prompt,
          wp_media_id: null,
          attempts,
          status:     'generated',
          updated_at: Math.floor(Date.now() / 1000),
        };
      }

      // Auto-review flagged the image — sharpen the prompt for the next attempt.
      prompt = review.improvedPrompt?.trim()
        ? `${review.improvedPrompt}. Editorial photograph, photorealistic, 4k, professional photography`
        : `${prompt}. Tighten framing, emphasize professional quality, sharp focus, documentary photography style`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[autonomous-content] blog slot ${ctx.slot} attempt ${attempt}/3 failed: ${lastError}`);
    }
  }

  return {
    slot:       ctx.slot,
    r2_key:     null,
    prompt:     basePrompt,
    wp_media_id: null,
    attempts,
    status:     'failed',
    error:      lastError || 'generation failed',
    updated_at: Math.floor(Date.now() / 1000),
  };
}

export function resolveBlogSlotHeading(slot: BlogImageSlot, blogTitle: string, headings: string[]): string {
  if (slot === 1) return blogTitle;
  if (slot === 2) return headings[1] ?? headings[0] ?? blogTitle;
  return headings[headings.length - 1] ?? blogTitle;
}

export function isWeakBlogImagePrompt(prompt: string | null | undefined): boolean {
  const cleaned = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return true;
  const commaCount = (cleaned.match(/,/g) ?? []).length;
  if (cleaned.length < 110) return true;
  if (commaCount < 4) return true;
  if (!/\b(daylight|lighting|light|composition|wide angle|close-up|editorial|photograph|photography|realistic|detail|4k)\b/i.test(cleaned)) return true;
  return false;
}

export interface EnsureBlogBodyImagesContext {
  blogTitle: string;
  blogContent?: string | null;
  targetKeyword?: string | null;
  serviceType?: string;
  industry?: string;
  location?: string;
  clientName?: string;
  clientId: string;
  existing?: BlogBodyImage[];
  forceSlots?: BlogImageSlot[];
  regenerateWeakPrompts?: boolean;
  promptOverrides?: Partial<Record<BlogImageSlot, string>>;
}

export async function ensureBlogBodyImagesGenerated(
  env: Env,
  openAiKey: string,
  stabilityKey: string,
  ctx: EnsureBlogBodyImagesContext,
): Promise<BlogBodyImage[]> {
  const headings = extractSectionHeadings(ctx.blogContent ?? '');
  const existingBySlot = new Map((ctx.existing ?? []).map((img) => [img.slot, img]));
  const force = new Set(ctx.forceSlots ?? []);
  const next: BlogBodyImage[] = [];

  for (const slot of [1, 2, 3] as const) {
    const current = existingBySlot.get(slot);
    const overriddenPrompt = ctx.promptOverrides?.[slot]?.trim();
    const shouldGenerate =
      force.has(slot) ||
      !current?.r2_key ||
      Boolean(overriddenPrompt) ||
      (ctx.regenerateWeakPrompts === true && isWeakBlogImagePrompt(current?.prompt));

    if (!shouldGenerate && current) {
      next.push(current);
      continue;
    }

    const generated = await generateBlogSlotImage(env, openAiKey, stabilityKey, {
      slot,
      blogTitle: ctx.blogTitle,
      targetKeyword: ctx.targetKeyword,
      sectionHeading: resolveBlogSlotHeading(slot, ctx.blogTitle, headings),
      serviceType: ctx.serviceType,
      industry: ctx.industry,
      location: ctx.location,
      clientName: ctx.clientName,
      clientId: ctx.clientId,
      promptOverride: overriddenPrompt || current?.prompt || undefined,
    });
    next.push(generated);
  }

  return next.sort((a, b) => a.slot - b.slot);
}

export function extractSectionHeadings(html: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord notification helper
// ─────────────────────────────────────────────────────────────────────────────

async function notifyDiscordContentCreated(
  env: Env,
  data: {
    postId:       string;
    title:        string;
    clientName:   string;
    platforms:    string[];
    publishDate:  string;
    caption:      string;
    imageStatus:  string;
    imageAttempts: number;
    r2Key:        string | null;
    triggeredBy:  string;
  },
): Promise<void> {
  const channelId = env.DISCORD_CHANNEL_ID ?? '';
  const botToken  = env.DISCORD_BOT_TOKEN  ?? '';
  if (!channelId || !botToken) return;

  const postUrl     = `https://marketing.webxni.com/posts/${data.postId}`;
  const platformStr = data.platforms.join(', ') || '—';
  const dateStr     = data.publishDate.slice(0, 16).replace('T', ' ');
  const imageIcon   = data.imageStatus === 'generated' ? '🖼️' : data.imageStatus === 'no_key' ? '—' : '⚠️';
  const imageNote   = data.imageStatus === 'generated'
    ? `Generated (${data.imageAttempts} attempt${data.imageAttempts !== 1 ? 's' : ''})`
    : data.imageStatus === 'no_key'
      ? 'No Stability key configured'
      : `Generation failed after ${data.imageAttempts} attempt${data.imageAttempts !== 1 ? 's' : ''}`;

  await discordSend({
    channelId,
    token: botToken,
    embeds: [{
      color:  DISCORD_COLORS.success,
      title:  `✨ New content created — ${data.clientName}`,
      description: `**${data.title}**\n${data.caption.slice(0, 200)}${data.caption.length > 200 ? '…' : ''}`,
      fields: [
        { name: '📅 Scheduled',  value: dateStr,     inline: true },
        { name: '📱 Platforms',  value: platformStr, inline: true },
        { name: `${imageIcon} Image`, value: imageNote, inline: false },
        { name: '🔗 Review',     value: `[Open in app](${postUrl})`, inline: false },
      ],
      footer:    { text: `Triggered by: ${data.triggeredBy} · Status: pending_approval` },
      timestamp: new Date().toISOString(),
    }],
  });
}
