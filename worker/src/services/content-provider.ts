import type { Env } from '../types';
import {
  buildGenerationRequest,
  buildGenerationSystemMessage,
  generatePostContent as generateWithOpenAI,
  normalizeGeneratedPost,
  researchTopic as researchTopicWithOpenAI,
  type GeneratePostResult,
  type GenerationContext,
  type GeneratedPost,
  type TopicResearch,
  type TopicResearchParams,
} from './openai';

export type ContentProviderName = 'openai' | 'claude';

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_REVIEW_THRESHOLD = 86;

export function normalizeContentProvider(value: unknown): ContentProviderName {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'claude' || normalized === 'anthropic' ? 'claude' : 'openai';
}

export function getProviderDisplayName(provider: ContentProviderName): string {
  return provider === 'claude' ? 'Claude' : 'OpenAI';
}

export function resolveProviderApiKey(
  env: Env,
  settings: Record<string, string>,
  provider: ContentProviderName,
): string {
  const hasProviderSpecificKeys = Boolean(settings['ai_openai_api_key'] || settings['ai_anthropic_api_key']);
  if (provider === 'claude') {
    return env.ANTHROPIC_API_KEY
      || settings['ai_anthropic_api_key']
      || (!hasProviderSpecificKeys && settings['ai_provider'] === 'anthropic' ? settings['ai_api_key'] ?? '' : '');
  }

  return env.OPENAI_API_KEY
    || settings['ai_openai_api_key']
    || (!hasProviderSpecificKeys && settings['ai_provider'] === 'openai' ? settings['ai_api_key'] ?? '' : '')
    || '';
}

function resolveProviderModel(
  settings: Record<string, string>,
  provider: ContentProviderName,
  kind: 'generation' | 'research' | 'review',
): string {
  if (provider === 'claude') {
    return settings['ai_anthropic_model']
      || (settings['ai_provider'] === 'anthropic' ? settings['ai_model'] : '')
      || DEFAULT_ANTHROPIC_MODEL;
  }

  if (kind === 'generation') {
    return settings['ai_openai_model']
      || (settings['ai_provider'] === 'openai' ? settings['ai_model'] : '')
      || DEFAULT_OPENAI_MODEL;
  }
  return 'gpt-4o-mini';
}

function isRetryableClaudeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('timed out') ||
    msg.includes('invalid JSON') ||
    msg.includes('non-object payload') ||
    msg.includes('missing ') ||
    msg.includes('Claude 429') ||
    msg.includes('Claude 500') ||
    msg.includes('Claude 502') ||
    msg.includes('Claude 503') ||
    msg.includes('Claude 504')
  );
}

function timeoutError(ms: number, label: string): Error {
  return new Error(`${label} request timed out after ${Math.round(ms / 1000)}s`);
}

async function callClaudeJson(
  apiKey: string,
  prompt: string,
  system: string,
  model: string,
  maxTokens: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError(timeoutMs, 'Claude')), timeoutMs);
  const abortFromOuter = () => controller.abort(signal?.reason ?? new Error('Generation aborted'));
  signal?.addEventListener('abort', abortFromOuter, { once: true });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        system,
        max_tokens: maxTokens,
        temperature: 0.35,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Claude ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json() as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find((item) => item.type === 'text')?.text?.trim();
    if (!text) throw new Error('Empty response from Claude');

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Claude returned invalid JSON: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('AbortError') || msg.includes('Generation aborted')) {
      if (signal?.aborted) throw new Error('Generation aborted');
      throw timeoutError(timeoutMs, 'Claude');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromOuter);
  }
}

async function generateWithClaude(
  apiKey: string,
  ctx: GenerationContext,
  settings: Record<string, string>,
  options?: { signal?: AbortSignal },
): Promise<GeneratePostResult> {
  const request = buildGenerationRequest(ctx);
  const started = Date.now();
  const model = resolveProviderModel(settings, 'claude', 'generation');
  const schemaJson = JSON.stringify(request.schema.schema);
  const generationPrompt =
    `${request.prompt}\n\nReturn ONLY raw JSON matching this schema exactly:\n${schemaJson}`;

  let draft: GeneratedPost | null = null;
  let attempts = 0;
  let lastError: unknown;

  for (let attempt = 1; attempt <= request.plan.retryLimit; attempt++) {
    attempts = attempt;
    if (options?.signal?.aborted) throw new Error('Generation aborted');
    try {
      const parsed = await callClaudeJson(
        apiKey,
        generationPrompt,
        buildGenerationSystemMessage(request.plan.mode),
        model,
        request.plan.maxTokens,
        request.plan.requestTimeoutMs,
        options?.signal,
      );
      draft = normalizeGeneratedPost(parsed, ctx);
      break;
    } catch (err) {
      lastError = err;
      if (attempt >= request.plan.retryLimit || !isRetryableClaudeError(err)) throw err;
    }
  }

  if (!draft) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  const reviewModel = resolveProviderModel(settings, 'claude', 'review');
  const reviewPrompt = `You are reviewing AI-generated weekly marketing content before it is saved.

Review this draft against these standards:
- Higher-quality, non-repetitive copy
- Strong SEO relevance
- Clear fit for the client's services, areas, buyer persona, package, and prior posts
- Strong CTA when appropriate
- Remove weak, vague, generic, or repetitive phrasing

Return ONLY JSON with this structure:
{
  "quality_score": number,
  "repetition_check": "short verdict",
  "seo_relevance": "short verdict",
  "client_fit": "short verdict",
  "cta_strength": "short verdict",
  "needs_revision": boolean,
  "final_post": <the full final post object matching the schema below>
}

If the draft is weak, revise it inside final_post before returning it. The final_post must always be present.

SCHEMA:
${schemaJson}

DRAFT:
${JSON.stringify(draft)}`;

  const reviewed = await callClaudeJson(
    apiKey,
    reviewPrompt,
    `${buildGenerationSystemMessage(request.plan.mode)}\nPerform a strict review and rewrite pass before final output.`,
    reviewModel,
    request.plan.maxTokens + 1200,
    Math.max(request.plan.requestTimeoutMs, 45_000),
    options?.signal,
  ) as Record<string, unknown>;

  const reviewedPost = normalizeGeneratedPost(reviewed['final_post'], ctx);
  const qualityScore = Number(reviewed['quality_score'] ?? 0);
  const finalPost = qualityScore < CLAUDE_REVIEW_THRESHOLD && reviewedPost ? reviewedPost : reviewedPost;

  return {
    post: finalPost,
    meta: {
      mode: request.plan.mode,
      model: `${model} + review:${reviewModel}`,
      attempts,
      promptChars: request.plan.promptChars,
      elapsedMs: Date.now() - started,
      requestTimeoutMs: request.plan.requestTimeoutMs,
    },
  };
}

async function researchTopicWithClaude(
  apiKey: string,
  params: TopicResearchParams,
  settings: Record<string, string>,
): Promise<TopicResearch | null> {
  const { client, intelligence: i, contentType, contentIntent, platforms, publishDate, recentTitles, recentFormats, serviceAreas, serviceNames } = params;
  const lang = client.language && client.language !== 'en' ? client.language : 'en';
  const model = resolveProviderModel(settings, 'claude', 'research');
  const formatOptions = ['faq', 'myth_vs_fact', 'checklist', 'mistake_to_avoid', 'comparison', 'process_breakdown', 'quick_explainer', 'local_advice', 'trust_builder'];

  let prompt = `You are a content strategist for ${client.canonical_name}.`;
  prompt += `\nIndustry: ${client.industry ?? 'unknown'}`;
  prompt += `\nLocation: ${client.state ?? 'unknown'}`;
  if (serviceAreas.length > 0) prompt += `\nService areas: ${serviceAreas.slice(0, 6).join(', ')}`;
  if (serviceNames.length > 0) prompt += `\nServices offered: ${serviceNames.slice(0, 10).join(', ')}`;
  if (i?.service_priorities) prompt += `\nPriority services: ${i.service_priorities}`;
  if (i?.seasonal_notes) prompt += `\nSeasonal context: ${i.seasonal_notes}`;
  if (i?.local_seo_themes) prompt += `\nLocal SEO themes: ${i.local_seo_themes}`;
  prompt += `\nContent type: ${contentType}`;
  prompt += `\nPublish date: ${publishDate}`;
  prompt += `\nTarget platforms: ${platforms.filter((pl) => pl !== 'website_blog').join(', ') || 'social media'}`;
  prompt += `\nContent intent: ${contentIntent}`;
  if (recentTitles.length > 0) {
    prompt += `\n\nRECENT TOPICS TO AVOID:\n${recentTitles.slice(0, 20).map((title) => `- ${title}`).join('\n')}`;
  }
  if (recentFormats.length > 0) {
    prompt += `\n\nRECENT FORMATS TO AVOID:\n${[...new Set(recentFormats.slice(0, 6))].map((format) => `- ${format.replace(/_/g, ' ')}`).join('\n')}`;
  }
  prompt += `\n\nPick the single best topic for this post.
Return ONLY JSON:
{
  "topic": "specific post topic, max 12 words",
  "angle": "1 sentence",
  "format": "one of: ${formatOptions.join('|')}",
  "targetKeyword": "2-5 word SEO keyword phrase",
  "localModifier": "city or area name, or empty string",
  "searchQuestion": "Google-style customer question"
}${lang !== 'en' ? `\nWrite "topic", "angle", and "searchQuestion" in ${lang}.` : ''}`;

  try {
    const parsed = await callClaudeJson(
      apiKey,
      prompt,
      'You are a content strategist. Return only valid JSON. No markdown.',
      model,
      700,
      20_000,
    ) as Partial<TopicResearch>;

    if (!parsed.topic || !parsed.format || !parsed.targetKeyword) return null;
    return {
      topic: String(parsed.topic).trim(),
      angle: String(parsed.angle ?? '').trim(),
      format: formatOptions.includes(String(parsed.format)) ? parsed.format as TopicResearch['format'] : 'quick_explainer',
      targetKeyword: String(parsed.targetKeyword).trim(),
      localModifier: String(parsed.localModifier ?? '').trim(),
      searchQuestion: String(parsed.searchQuestion ?? '').trim(),
    };
  } catch {
    return null;
  }
}

export async function generateWithProvider(
  provider: ContentProviderName,
  apiKey: string,
  ctx: GenerationContext,
  settings: Record<string, string>,
  options?: { signal?: AbortSignal },
): Promise<GeneratePostResult> {
  if (provider === 'claude') {
    return generateWithClaude(apiKey, ctx, settings, options);
  }
  return generateWithOpenAI(apiKey, ctx, options);
}

export async function researchTopicWithProvider(
  provider: ContentProviderName,
  apiKey: string,
  params: TopicResearchParams,
  settings: Record<string, string>,
): Promise<TopicResearch | null> {
  if (provider === 'claude') {
    return researchTopicWithClaude(apiKey, params, settings);
  }
  return researchTopicWithOpenAI(apiKey, params);
}
