export const AGENCY_SCHEMAS = {
  research: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'sources', 'audience', 'services', 'local_angles', 'risks', 'content_opportunities'],
    properties: {
      summary: { type: 'string' },
      sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } },
      audience: { type: 'array', items: { type: 'string' } },
      services: { type: 'array', items: { type: 'string' } },
      local_angles: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
      content_opportunities: { type: 'array', items: { type: 'string' } },
    },
  },
  strategy: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'monthly_focus', 'priority_services', 'content_pillars', 'weekly_plan', 'approval_notes'],
    properties: {
      summary: { type: 'string' },
      monthly_focus: { type: 'string' },
      priority_services: { type: 'array', items: { type: 'string' } },
      content_pillars: { type: 'array', items: { type: 'string' } },
      weekly_plan: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['week', 'theme', 'recommended_content'], properties: { week: { type: 'string' }, theme: { type: 'string' }, recommended_content: { type: 'array', items: { type: 'string' } } } } },
      approval_notes: { type: 'array', items: { type: 'string' } },
    },
  },
  socialDraft: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'content_type', 'platforms', 'master_caption', 'platform_captions', 'designer_prompt_es', 'review_notes'],
    properties: {
      title: { type: 'string' },
      content_type: { type: 'string', enum: ['image', 'reel', 'video'] },
      platforms: { type: 'array', items: { type: 'string' } },
      master_caption: { type: 'string' },
      platform_captions: {
        type: 'object',
        additionalProperties: false,
        required: ['facebook', 'instagram'],
        properties: {
          facebook:        { type: 'string' },
          instagram:       { type: 'string' },
          tiktok:          { type: 'string' },
          x:               { type: 'string' },
          threads:         { type: 'string' },
          google_business: { type: 'string' },
          linkedin:        { type: 'string' },
        },
      },
      designer_prompt_es: { type: 'string' },
      review_notes: { type: 'array', items: { type: 'string' } },
    },
  },
  blogDraft: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'slug', 'seo_title', 'meta_description', 'target_keyword', 'excerpt', 'html', 'review_notes'],
    properties: {
      title: { type: 'string' },
      slug: { type: 'string' },
      seo_title: { type: 'string' },
      meta_description: { type: 'string' },
      target_keyword: { type: 'string' },
      excerpt: { type: 'string' },
      html: { type: 'string' },
      review_notes: { type: 'array', items: { type: 'string' } },
    },
  },
  editorialReview: {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'summary', 'issues', 'recommended_changes'],
    properties: {
      severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
      summary: { type: 'string' },
      issues: { type: 'array', items: { type: 'string' } },
      recommended_changes: { type: 'array', items: { type: 'string' } },
    },
  },
  operationalReview: {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'summary', 'findings', 'recommended_actions'],
    properties: {
      severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
      summary: { type: 'string' },
      findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'title', 'description'], properties: { severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] }, title: { type: 'string' }, description: { type: 'string' } } } },
      recommended_actions: { type: 'array', items: { type: 'string' } },
    },
  },
};

export function buildAgencyPrompt(kind, { client, snapshot, task }) {
  const safeClient = JSON.stringify(client ?? {}, null, 2);
  const safeSnapshot = JSON.stringify(snapshot?.overview ?? {}, null, 2);
  const taskInput = JSON.stringify(task ?? {}, null, 2);
  const shared = [
    'You are working inside the WebXni production marketing platform.',
    'Preserve Marvin approval, designer asset delivery, and posting automation gates.',
    'Do not claim to publish, schedule, approve, or upload assets.',
    'Designer prompts must be Spanish.',
    `Client context:\n${safeClient}`,
    `Platform overview:\n${safeSnapshot}`,
    `Task input:\n${taskInput}`,
  ].join('\n\n');

  if (kind === 'research') {
    return `${shared}\n\nResearch the client defensively using only reliable, citeable public information available to the terminal agent. Focus on market, services, local angles, audience, and content opportunities.`;
  }
  if (kind === 'strategy') {
    return `${shared}\n\nCreate a reviewable draft strategy plan. Use existing research signals when present. Keep it practical for local SEO and social content.`;
  }
  if (kind === 'socialDraft') {
    return `${shared}\n\nDraft one reviewable social content item for this client.\n\nRULES:\n- Use the client's real services and local service areas.\n- Avoid generic captions. Be specific, local, and conversion-focused.\n- Vary the hook — do not start with the business name.\n- Include a clear CTA (call, text, visit, book).\n- platform_captions must include BOTH facebook AND instagram keys with distinct, platform-appropriate text.\n  facebook: slightly longer, conversational, allows emojis.\n  instagram: shorter, punchy, hashtag-friendly.\n  tiktok: casual and energetic if relevant to client.\n  google_business: concise, local SEO focused, no emojis.\n- designer_prompt_es: write the image/video prompt in Spanish for the designer.\n- Do not claim to publish, approve, or schedule. Status remains draft.`;
  }
  if (kind === 'blogDraft') {
    return `${shared}\n\nDraft one local SEO blog as HTML body content only. Use inline-safe article markup and do not include style tags. It must remain a draft and not publish to WordPress.`;
  }
  if (kind === 'operationalReview') {
    return `${shared}\n\nReview the current platform snapshot defensively. Identify only actionable production risks. Do not suggest shell commands that mutate production state.`;
  }
  return `${shared}\n\nReview the provided task/content context for factual risk, repetition, quality, and platform fit.`;
}
