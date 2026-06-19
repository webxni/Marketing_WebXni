export const AGENCY_SCHEMAS = {
  research: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'sources', 'audience', 'services', 'local_angles', 'risks', 'content_opportunities', 'keyword_research'],
    properties: {
      summary: { type: 'string' },
      sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } },
      audience: { type: 'array', items: { type: 'string' } },
      services: { type: 'array', items: { type: 'string' } },
      local_angles: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
      content_opportunities: { type: 'array', items: { type: 'string' } },
      // First-class keyword research (§3) — the shared keyword set every agent uses.
      keyword_research: {
        type: 'object',
        additionalProperties: false,
        required: ['primary', 'long_tail', 'local_terms', 'near_me', 'intent', 'difficulty_notes'],
        properties: {
          primary: { type: 'array', items: { type: 'string' } },
          long_tail: { type: 'array', items: { type: 'string' } },
          local_terms: { type: 'array', items: { type: 'string' } },     // city / service-area keywords
          near_me: { type: 'array', items: { type: 'string' } },          // "near me" intent variants
          intent: { type: 'string' },                                     // dominant search intent
          difficulty_notes: { type: 'array', items: { type: 'string' } }, // difficulty / opportunity notes
        },
      },
    },
  },
  strategy: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'monthly_focus', 'priority_services', 'content_pillars', 'weekly_plan', 'seo_plan', 'success_metrics', 'approval_notes'],
    properties: {
      summary: { type: 'string' },
      monthly_focus: { type: 'string' },
      priority_services: { type: 'array', items: { type: 'string' } },
      content_pillars: { type: 'array', items: { type: 'string' } },
      weekly_plan: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['week', 'theme', 'recommended_content'], properties: { week: { type: 'string' }, theme: { type: 'string' }, recommended_content: { type: 'array', items: { type: 'string' } } } } },
      // Local-SEO plan (§3/§6): keyword -> content type -> channel -> cadence.
      seo_plan: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['keyword', 'content_type', 'channel', 'cadence'],
          properties: {
            keyword: { type: 'string' },
            content_type: { type: 'string' },                               // image|reel|video|blog|gmb
            channel: { type: 'string', enum: ['social', 'blog', 'gmb'] },
            cadence: { type: 'string' },                                     // e.g. "weekly", "2x/week"
          },
        },
      },
      success_metrics: { type: 'array', items: { type: 'string' } },         // keywords to track, cadence, ranking check-ins
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
  socialWeeklyBatch: {
    type: 'object',
    additionalProperties: false,
    required: ['posts'],
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'content_type', 'day_of_week', 'master_caption', 'platform_captions', 'designer_prompt_es'],
          properties: {
            title: { type: 'string' },
            content_type: { type: 'string', enum: ['image', 'reel', 'video'] },
            day_of_week: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] },
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
      },
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
  qualityCheck: {
    type: 'object',
    additionalProperties: false,
    required: ['pass', 'score', 'relevance', 'accuracy', 'brand_fit', 'keyword_usage', 'no_fluff', 'cta_present', 'issues', 'required_fixes'],
    properties: {
      pass: { type: 'boolean' },
      score: { type: 'integer', minimum: 0, maximum: 100 },
      relevance: { type: 'boolean' },
      accuracy: { type: 'boolean' },
      brand_fit: { type: 'boolean' },
      keyword_usage: { type: 'boolean' },
      no_fluff: { type: 'boolean' },
      cta_present: { type: 'boolean' },
      issues: { type: 'array', items: { type: 'string' } },
      required_fixes: { type: 'array', items: { type: 'string' } },
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
      // Optional code-fix PROPOSALS (system-reliability only). These are never
      // applied automatically — they are posted to Discord for a human to act on.
      code_proposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'problem', 'suggested_fix'],
          properties: {
            title: { type: 'string' },
            problem: { type: 'string' },
            root_cause: { type: 'string' },
            suggested_fix: { type: 'string' },
            affected_files: { type: 'array', items: { type: 'string' } },
            diff: { type: 'string' },
            risk: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
        },
      },
    },
  },
};

export function buildAgencyPrompt(kind, { client, snapshot, task }) {
  // content_brief carries the per-client "template": brand voice, services,
  // service areas, approved CTAs, and forbidden terms. Keep it out of the raw
  // JSON dump and surface it as a labeled CLIENT CONTENT BRIEF block.
  const contentBrief = client?.content_brief ? String(client.content_brief) : '';
  const clientForJson = { ...(client ?? {}) };
  delete clientForJson.content_brief;
  const safeClient = JSON.stringify(clientForJson, null, 2);
  const safeSnapshot = JSON.stringify(snapshot?.overview ?? {}, null, 2);
  const taskInput = JSON.stringify(task ?? {}, null, 2);
  const shared = [
    'You are working inside the WebXni production marketing platform.',
    'Preserve Marvin approval, designer asset delivery, and posting automation gates.',
    'Do not claim to publish, schedule, approve, or upload assets.',
    'Designer prompts must be Spanish.',
    ...(contentBrief
      ? [`CLIENT CONTENT BRIEF (use this brand voice, services, areas, and CTAs; obey NEVER USE terms):\n${contentBrief}`]
      : []),
    ...(task?.revision_required
      ? [`REVISION PASS — the prior draft FAILED the quality gate. Rewrite it to fix every required fix below while keeping the same format/schema and the same day_of_week/content_type. Do not lower quality elsewhere.\nREQUIRED FIXES:\n${(task.required_fixes || []).map((f) => `- ${f}`).join('\n') || '- (see issues)'}\nISSUES:\n${(task.quality_issues || []).map((i) => `- ${i}`).join('\n') || '- (none listed)'}\nPRIOR DRAFT:\n${JSON.stringify(task.draft ?? {}, null, 2)}`]
      : []),
    `Client context:\n${safeClient}`,
    `Platform overview:\n${safeSnapshot}`,
    `Task input:\n${taskInput}`,
  ].join('\n\n');

  if (kind === 'research') {
    return `${shared}\n\nResearch the client defensively using only reliable, citeable public information available to the terminal agent. Focus on market, services, local angles, audience, and content opportunities.\n\nKEYWORD RESEARCH (first-class — the package goal is ranking #1 locally):\n- keyword_research.primary: the 3-6 highest-intent head terms for this business.\n- long_tail: specific multi-word variants real customers search.\n- local_terms: city / neighborhood / service-area keywords from the client's actual areas.\n- near_me: "near me" style local-intent variants.\n- intent: the dominant search intent (local | commercial | transactional | informational).\n- difficulty_notes: brief difficulty/opportunity notes per cluster.\nGround keywords in the client's REAL services and service areas — do not invent locations or services.`;
  }
  if (kind === 'strategy') {
    return `${shared}\n\nCreate a reviewable draft local-SEO strategy. Use existing research + the TARGET KEYWORDS in the brief.\n- seo_plan: an explicit map of keyword -> content_type -> channel (social|blog|gmb) -> cadence. This is the local-SEO plan, not a vague theme list.\n- success_metrics: which target keywords to track, GMB/post cadence, and ranking-movement check-ins.\nBe honest: optimize what the agency controls (relevance, locality, freshness, consistency, quality). Do not promise a guaranteed #1. Keep it a draft for Marvin's review.`;
  }
  if (kind === 'socialWeeklyBatch') {
    const schedule = client?.weekly_schedule_text || 'No package schedule provided.';
    return `${shared}\n\nGenerate ALL social posts for this client's upcoming week based on their package schedule.\n\nPACKAGE SCHEDULE:\n${schedule}\n\nRULES:\n- Create exactly one post per slot in the schedule (exclude blog slots — those are handled separately).\n- Each post must use the correct content_type (image, reel, or video) and day_of_week.\n- Use the client's REAL services and local service areas. Be specific — avoid generic captions.\n- Vary the hook across posts — do not repeat the same opening.\n- Each post needs a clear CTA (call, text, book, visit).\n- platform_captions must include facebook AND instagram with distinct tones:\n  facebook: conversational, slightly longer, emojis ok.\n  instagram: short, punchy, hashtags at the end.\n  google_business: concise, local SEO focused, no emojis.\n- designer_prompt_es: write the visual concept in Spanish for the designer.\n- Status must remain draft — do not approve, publish, or schedule.`;
  }
  if (kind === 'socialDraft') {
    return `${shared}\n\nDraft one reviewable social content item for this client.\n\nRULES:\n- Use the client's real services and local service areas.\n- Avoid generic captions. Be specific, local, and conversion-focused.\n- Vary the hook — do not start with the business name.\n- Include a clear CTA (call, text, visit, book).\n- platform_captions must include BOTH facebook AND instagram keys with distinct, platform-appropriate text.\n  facebook: slightly longer, conversational, allows emojis.\n  instagram: shorter, punchy, hashtag-friendly.\n  tiktok: casual and energetic if relevant to client.\n  google_business: concise, local SEO focused, no emojis.\n- designer_prompt_es: write the image/video prompt in Spanish for the designer.\n- Do not claim to publish, approve, or schedule. Status remains draft.`;
  }
  if (kind === 'blogDraft') {
    return `${shared}\n\nDraft one local SEO blog as HTML body content only. Use inline-safe article markup and do not include style tags. It must remain a draft and not publish to WordPress.`;
  }
  if (kind === 'qualityCheck') {
    const draft = task?.draft ? JSON.stringify(task.draft, null, 2) : (task?.review_target ? JSON.stringify(task.review_target, null, 2) : '{}');
    return `${shared}\n\nYou are the QUALITY GATE. Score the DRAFT below against the rubric before it can enter Editorial Review. Be strict and honest.\n\nDRAFT TO EVALUATE:\n${draft}\n\nRUBRIC (each is a boolean; "pass" is true only if ALL are true and score >= 80):\n- relevance: on-topic for the client's services and the selected topic.\n- accuracy: factually grounded in the CLIENT CONTENT BRIEF — no invented claims, certifications, or locations.\n- brand_fit: matches the client's brand voice; obeys NEVER USE / prohibited terms.\n- keyword_usage: uses the client's target keywords + correct local/service-area terms naturally (not stuffed).\n- no_fluff: concrete and specific; no filler or generic platitudes.\n- cta_present: a clear, approved call-to-action is present and correct for the channel format.\nList concrete "issues" and concrete "required_fixes" whenever a check fails. Do not approve, publish, or schedule — scoring only.`;
  }
  if (kind === 'operationalReview') {
    const base = `${shared}\n\nReview the current platform snapshot defensively. Identify only actionable production risks. Do not suggest shell commands that mutate production state.`;
    if (task?.agent_slug === 'system-reliability') {
      return `${base}\n\nADDITIONALLY: for recurring or code-level reliability issues, output a "code_proposals" array. Each proposal must name the problem, the likely root cause, a concrete suggested fix, the affected_files, and a risk rating. Optionally include a small unified-diff snippet in "diff". These proposals are POSTED TO DISCORD FOR A HUMAN — they are NEVER applied automatically. Do NOT attempt to edit files, run commands, deploy, or change any production state yourself. Propose only.`;
    }
    return base;
  }
  return `${shared}\n\nReview the provided task/content context for factual risk, repetition, quality, and platform fit.`;
}
