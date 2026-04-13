/**
 * OpenAI client — direct fetch, no SDK dependency.
 * Used for AI content generation.
 */

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
  youtube_title?:      string;
  youtube_description?: string;
  blog_content?:       string;
  seo_title?:          string;
  meta_description?:   string;
  target_keyword?:     string;
  video_script?:       string;
  // Designer prompts (always generated in Spanish)
  ai_image_prompt?:    string;
  ai_video_prompt?:    string;
}

export interface GenerationContext {
  client: {
    canonical_name: string;
    notes?:         string | null;
    brand_json?:    string | null;
    language?:      string | null;
    phone?:         string | null;
    cta_text?:      string | null;
    industry?:      string | null;
    state?:         string | null;
    owner_name?:    string | null;
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
  // GBP-specific context (optional — only set when generating GBP caption)
  gbpTopicType?: string | null;  // 'STANDARD'|'EVENT'|'OFFER'
  gbpCtaType?:   string | null;  // 'BOOK'|'ORDER'|'SHOP'|'LEARN_MORE'|'SIGN_UP'|'CALL'
  gbpOfferTitle?: string | null;
  gbpEventTitle?: string | null;
}

function line(condition: unknown, text: string): string {
  return condition ? `\n${text}` : '';
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

function buildPrompt(ctx: GenerationContext): string {
  const { client, intelligence: i, recentTitles, feedback, publishDate, contentType, platforms, gbpTopicType, gbpCtaType, gbpOfferTitle, gbpEventTitle } = ctx;
  const isBlog    = contentType === 'blog';
  const isVideo   = contentType === 'video' || contentType === 'reel';
  const isYoutube = platforms.includes('youtube');
  const lang      = client.language && client.language !== 'en' ? client.language : 'en';

  let p = `You are a professional social media content writer for ${client.canonical_name}.${line(client.industry, `Industry: ${client.industry}`)}${line(client.state, `Location: ${client.state}`)}${lang !== 'en' ? `\nWrite ALL content in ${lang}.` : ''}

BUSINESS CONTEXT:${line(i?.service_priorities, `- Services/Products: ${i?.service_priorities}`)}${line(i?.brand_voice, `- Brand voice: ${i?.brand_voice}`)}${line(i?.tone_keywords, `- Tone: ${i?.tone_keywords}`)}${line(i?.audience_notes, `- Target audience: ${i?.audience_notes}`)}${line(i?.content_goals, `- Content goals: ${i?.content_goals}`)}${line(i?.content_angles, `- Content angles to use: ${i?.content_angles}`)}${line(i?.local_seo_themes, `- Local SEO themes: ${i?.local_seo_themes}`)}${line(i?.primary_keyword, `- Primary keyword: ${i?.primary_keyword}`)}${line(i?.secondary_keywords, `- Secondary keywords: ${i?.secondary_keywords}`)}${line(client.cta_text, `- Preferred CTA: ${client.cta_text}`)}${line(i?.approved_ctas, `- Approved CTAs: ${i?.approved_ctas}`)}${line(i?.prohibited_terms, `- NEVER USE these words/phrases: ${i?.prohibited_terms}`)}${line(i?.humanization_style, `- Writing style note: ${i?.humanization_style}`)}${line(i?.seasonal_notes, `- Seasonal note: ${i?.seasonal_notes}`)}${line(client.notes, `- Additional context: ${client.notes}`)}`;

  if (recentTitles.length > 0) {
    p += `\n\nRECENT POSTS — do NOT repeat these topics or angles:\n${recentTitles.slice(0, 15).map(t => `- ${t}`).join('\n')}`;
  }

  const positives = feedback.filter(f => f.sentiment === 'positive').slice(0, 3);
  const negatives = feedback.filter(f => f.sentiment === 'negative').slice(0, 3);
  if (positives.length > 0) p += `\n\nWHAT PERFORMS WELL (do more of this):\n${positives.map(f => `- ${f.note}`).join('\n')}`;
  if (negatives.length > 0) p += `\n\nAVOID (based on past feedback):\n${negatives.map(f => `- ${f.note}`).join('\n')}`;

  p += `\n\nTASK:
Create a ${contentType} social media post for publish date: ${publishDate}.
Target platforms: ${platforms.join(', ')}.

Return a JSON object with the following fields (include only fields relevant to the platforms listed):
- "title": short descriptive post title (required, 5-10 words)
- "master_caption": main caption — concise, engaging fallback used for any platform not listed below (required, 100-250 chars)`;

  if (platforms.includes('facebook'))        p += '\n- "cap_facebook": engaging Facebook caption, can be longer, include a question or CTA (150-400 chars)';
  if (platforms.includes('instagram'))       p += '\n- "cap_instagram": Instagram caption with relevant emojis and 10-15 hashtags (150-300 chars + hashtags on new lines)';
  if (platforms.includes('linkedin'))        p += '\n- "cap_linkedin": professional LinkedIn caption, insight-driven, no hashtag spam (200-500 chars, 3-5 hashtags max)';
  if (platforms.includes('x'))               p += '\n- "cap_x": X/Twitter post, punchy and direct, max 280 chars total';
  if (platforms.includes('threads'))         p += '\n- "cap_threads": casual Threads post, conversational, 100-250 chars';
  if (platforms.includes('tiktok'))          p += '\n- "cap_tiktok": TikTok caption with trending hashtags (150-250 chars + 5-10 hashtags)';
  if (platforms.includes('pinterest'))       p += '\n- "cap_pinterest": Pinterest description, keyword-rich, 100-200 chars + 5-8 hashtags';
  if (platforms.includes('bluesky'))         p += '\n- "cap_bluesky": Bluesky post, casual and direct, max 300 chars';
  if (platforms.includes('google_business')) {
    let gbpInstruction = '\n- "cap_google_business": Google Business post, factual and local, 100-250 chars, NO hashtags';
    if (gbpTopicType === 'OFFER' && gbpOfferTitle) gbpInstruction += `. This is a SPECIAL OFFER post for: "${gbpOfferTitle}". Highlight the offer value clearly.`;
    if (gbpTopicType === 'EVENT' && gbpEventTitle) gbpInstruction += `. This is an EVENT post for: "${gbpEventTitle}". Create excitement and urgency around the event.`;
    if (gbpCtaType && GBP_CTA_INTENT[gbpCtaType]) gbpInstruction += ` ${GBP_CTA_INTENT[gbpCtaType]}`;
    p += gbpInstruction;
  }
  if (isYoutube)  p += '\n- "youtube_title": SEO-optimized YouTube title (60-70 chars)\n- "youtube_description": YouTube description with timestamps placeholder, links placeholder, CTA (200-400 chars)';
  if (isBlog)     p += '\n- "blog_content": complete HTML blog post body (600-900 words, use <h2>, <h3>, <p>, <ul> tags, keyword-rich)\n- "seo_title": SEO page title with primary keyword (55-60 chars)\n- "meta_description": compelling meta description (150-155 chars)\n- "target_keyword": primary SEO keyword phrase';
  if (isVideo)    p += '\n- "video_script": 30-60 second video script — hook line, 3 body points, strong CTA';

  // Designer prompts — always in Spanish regardless of content language
  if (!isBlog) {
    // Determine asset type, orientation, and dimensions by content type + platform context
    let assetSpec = '';
    if (contentType === 'reel') {
      assetSpec = 'Tipo de archivo: VIDEO VERTICAL (Reel/TikTok). Orientación: VERTICAL. Dimensiones: 1080 × 1920 px (relación 9:16).';
    } else if (contentType === 'video') {
      assetSpec = 'Tipo de archivo: VIDEO HORIZONTAL. Orientación: HORIZONTAL. Dimensiones: 1920 × 1080 px (relación 16:9).';
    } else if (platforms.includes('pinterest') && !platforms.includes('instagram') && !platforms.includes('facebook')) {
      assetSpec = 'Tipo de archivo: IMAGEN. Orientación: VERTICAL. Dimensiones: 1000 × 1500 px (relación 2:3). Optimizada para Pinterest.';
    } else if (platforms.includes('instagram') && !platforms.includes('facebook') && !platforms.includes('pinterest')) {
      assetSpec = 'Tipo de archivo: IMAGEN. Orientación: CUADRADA. Dimensiones: 1080 × 1080 px (relación 1:1). Optimizada para Instagram.';
    } else {
      assetSpec = 'Tipo de archivo: IMAGEN. Orientación: HORIZONTAL. Dimensiones: 1200 × 628 px (relación 1.91:1). Válida para Facebook, LinkedIn, Google Business.';
    }

    const brandColors = client.brand_json
      ? (() => { try { const b = JSON.parse(client.brand_json!); return b.colors ? `Colores de marca: ${Array.isArray(b.colors) ? b.colors.join(', ') : b.colors}.` : ''; } catch { return ''; } })()
      : '';

    const platformCtx = platforms.length > 0
      ? `Plataformas destino: ${platforms.join(', ')}.`
      : '';

    p += `\n- "ai_image_prompt": (SIEMPRE EN ESPAÑOL — OBLIGATORIO) Brief visual completo para la diseñadora:\n  ${assetSpec}\n  ${platformCtx}${brandColors ? '\n  ' + brandColors : ''}\n  Incluye: estilo visual, paleta de colores, composición, elementos visuales clave, ambiente/mood, texto sugerido para overlay (headline corto), y herramienta recomendada (Canva / Adobe / Midjourney). 3-5 oraciones descriptivas.`;
  }
  if (isVideo) {
    const videoDims = contentType === 'reel'
      ? 'Formato VERTICAL 9:16 (1080×1920). Para Reels / TikTok.'
      : 'Formato HORIZONTAL 16:9 (1920×1080). Para YouTube / Facebook Video.';
    p += `\n- "ai_video_prompt": (SIEMPRE EN ESPAÑOL — OBLIGATORIO) Concepto de video para la diseñadora:\n  ${videoDims}\n  Describe: escena principal, movimiento de cámara, estilo cinematográfico, paleta de colores, música o audio sugerido, transiciones clave, texto en pantalla (CTA). 3-4 oraciones.`;
  }

  p += '\n\nIMPORTANT: Return ONLY valid JSON. No markdown code blocks, no explanation outside the JSON.';
  return p;
}

export async function generatePostContent(
  apiKey: string,
  ctx:    GenerationContext,
): Promise<GeneratedPost> {
  const prompt = buildPrompt(ctx);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:           'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an expert social media content writer. Always respond with valid JSON only, no markdown.' },
        { role: 'user',   content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.75,
      max_tokens:      3500,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const raw  = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty response from OpenAI');

  const parsed = JSON.parse(raw) as GeneratedPost;
  if (!parsed.master_caption) throw new Error('Generation missing master_caption');
  if (!parsed.title)          parsed.title = ctx.client.canonical_name + ' — ' + ctx.publishDate;

  return parsed;
}
