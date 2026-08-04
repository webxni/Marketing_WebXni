export const AGENCY_SCHEMAS = {
  research: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'sources', 'audience', 'services', 'local_angles', 'risks', 'content_opportunities', 'keyword_research', 'missing_info', 'assumptions'],
    properties: {
      summary: { type: 'string' },
      sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } },
      audience: { type: 'array', items: { type: 'string' } },
      services: { type: 'array', items: { type: 'string' } },
      local_angles: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
      content_opportunities: { type: 'array', items: { type: 'string' } },
      // §5 missing-information protocol: gaps the agent could NOT confirm from
      // public sources (→ ask Marvin in Discord), plus any assumptions it made
      // so a human can correct them. Empty arrays when nothing is missing.
      missing_info: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'question'],
          properties: {
            field: { type: 'string' },          // e.g. service_areas, hours, certifications
            question: { type: 'string' },        // concise question to ask in Discord
            confidence: { type: 'string' },      // low|medium when partially known
          },
        },
      },
      assumptions: { type: 'array', items: { type: 'string' } },
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
    required: ['title', 'content_type', 'platforms', 'master_caption', 'platform_captions', 'target_keyword', 'target_locality', 'hook_family', 'designer_prompt_es', 'review_notes'],
    properties: {
      title: { type: 'string' },
      content_type: { type: 'string', enum: ['image', 'reel', 'video'] },
      platforms: { type: 'array', items: { type: 'string' } },
      master_caption: { type: 'string' },
      target_keyword: { type: 'string' },
      target_locality: { type: 'string' },
      hook_family: { type: 'string', enum: ['customer_question', 'myth_buster', 'process', 'mistake', 'comparison', 'seasonal', 'case_example', 'maintenance', 'cost_factor'] },
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
          pinterest:       { type: 'string' },
          bluesky:         { type: 'string' },
          youtube:         { type: 'string' },
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
          required: ['title', 'content_type', 'day_of_week', 'master_caption', 'platform_captions', 'target_keyword', 'target_locality', 'hook_family', 'designer_prompt_es'],
          properties: {
            title: { type: 'string' },
            content_type: { type: 'string', enum: ['image', 'reel', 'video'] },
            day_of_week: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] },
            master_caption: { type: 'string' },
            target_keyword: { type: 'string' },
            target_locality: { type: 'string' },
            hook_family: { type: 'string', enum: ['customer_question', 'myth_buster', 'process', 'mistake', 'comparison', 'seasonal', 'case_example', 'maintenance', 'cost_factor'] },
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
                pinterest:       { type: 'string' },
                bluesky:         { type: 'string' },
                youtube:         { type: 'string' },
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
  blogWeeklyBatch: {
    type: 'object',
    additionalProperties: false,
    required: ['blogs'],
    properties: {
      blogs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'slug', 'seo_title', 'meta_description', 'target_keyword', 'excerpt', 'html', 'day_of_week'],
          properties: {
            title: { type: 'string' },
            slug: { type: 'string' },
            seo_title: { type: 'string' },
            meta_description: { type: 'string' },
            target_keyword: { type: 'string' },
            excerpt: { type: 'string' },
            html: { type: 'string' },
            day_of_week: { type: 'string' },
            review_notes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
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
  gmbPost: {
    type: 'object',
    additionalProperties: false,
    required: ['post_type', 'title', 'body', 'cta_type', 'target_keyword', 'locality', 'designer_prompt_es', 'review_notes'],
    properties: {
      post_type: { type: 'string', enum: ['OFFER', 'UPDATE', 'EVENT'] },
      title: { type: 'string' },
      body: { type: 'string' },
      cta_type: { type: 'string', enum: ['CALL', 'LEARN_MORE', 'BOOK', 'ORDER', 'SIGN_UP', 'NONE'] },
      cta_url: { type: 'string' },
      offer_terms: { type: 'string' },     // OFFER only
      coupon_code: { type: 'string' },      // OFFER only
      event_start: { type: 'string' },      // EVENT only (ISO date)
      event_end: { type: 'string' },        // EVENT only (ISO date)
      target_keyword: { type: 'string' },
      locality: { type: 'string' },         // city / service-area term targeted
      designer_prompt_es: { type: 'string' },
      review_notes: { type: 'array', items: { type: 'string' } },
    },
  },
  gmbOffer: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'cta_text', 'cta_type', 'target_keyword', 'designer_prompt_es', 'review_notes'],
    properties: {
      title: { type: 'string' },                 // internal title, e.g. "Spring Lock Rekey Special"
      description: { type: 'string' },           // offer body shown on GBP
      cta_text: { type: 'string' },              // button text, e.g. "Claim Offer"
      cta_type: { type: 'string', enum: ['CALL', 'LEARN_MORE', 'BOOK', 'ORDER', 'SIGN_UP', 'NONE'] },
      cta_url: { type: 'string' },
      coupon_code: { type: 'string' },
      redeem_url: { type: 'string' },
      terms: { type: 'string' },
      valid_until: { type: 'string' },           // ISO date, optional
      target_keyword: { type: 'string' },
      designer_prompt_es: { type: 'string' },    // 1080x1080 GBP square image brief, Spanish
      review_notes: { type: 'array', items: { type: 'string' } },
    },
  },
  gmbEvent: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'event_title', 'event_start_date', 'event_end_date', 'cta_type', 'target_keyword', 'designer_prompt_es', 'review_notes'],
    properties: {
      title: { type: 'string' },                 // internal title
      description: { type: 'string' },
      event_title: { type: 'string' },           // public event name
      event_start_date: { type: 'string' },      // ISO date
      event_end_date: { type: 'string' },        // ISO date
      cta_type: { type: 'string', enum: ['CALL', 'LEARN_MORE', 'BOOK', 'ORDER', 'SIGN_UP', 'NONE'] },
      cta_url: { type: 'string' },
      target_keyword: { type: 'string' },
      designer_prompt_es: { type: 'string' },
      review_notes: { type: 'array', items: { type: 'string' } },
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
  reliabilityReview: {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'summary', 'findings', 'recommended_actions', 'code_proposals'],
    properties: {
      severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
      summary: { type: 'string' },
      findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'title', 'description'], properties: { severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] }, title: { type: 'string' }, description: { type: 'string' } } } },
      recommended_actions: { type: 'array', items: { type: 'string' } },
      code_proposals: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'problem', 'suggested_fix', 'affected_files', 'risk'], properties: { title: { type: 'string' }, problem: { type: 'string' }, root_cause: { type: 'string' }, suggested_fix: { type: 'string' }, affected_files: { type: 'array', items: { type: 'string' } }, diff: { type: 'string' }, risk: { type: 'string', enum: ['low', 'medium', 'high'] } } } },
    },
  },
  securityReview: {
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
  orchestratorReview: {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'summary', 'findings', 'recommended_actions', 'assignments'],
    properties: {
      severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
      summary: { type: 'string' },
      findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'title', 'description'], properties: { severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] }, title: { type: 'string' }, description: { type: 'string' } } } },
      recommended_actions: { type: 'array', items: { type: 'string' } },
      assignments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['agent_slug', 'action', 'priority', 'reason'], properties: { agent_slug: { type: 'string' }, action: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] }, reason: { type: 'string' } } } },
    },
  },
};

const HIGH_QUALITY_CONTENT_STANDARD = [
  'HIGH-QUALITY CONTENT STANDARD (applies to every content agent):',
  '- Write like a senior local marketer, not a generic AI assistant.',
  '- Every draft must name a real service and a real city/service area from the brief or client context.',
  '- Prefer concrete customer situations, job types, materials, project constraints, neighborhoods, or seasonal needs over vague claims.',
  '- Never invent licenses, awards, guarantees, discounts, reviews, emergency availability, years in business, service areas, or offers.',
  '- Avoid filler phrases: trusted team, top-notch, high-quality, exceptional service, your go-to, look no further, tailored solutions, transform your space, peace of mind.',
  '- Use one primary keyword naturally plus one local modifier; do not repeat the same keyword phrase more than twice in a caption or paragraph.',
  '- If a target keyword contains a confirmed service area, target_locality and the customer-facing copy must use that same area. Never mix cities or markets in one draft.',
  '- Reject recycled title frames such as trusted solutions, expert service, addressing concerns, top tips, choosing the right, key criteria, and generic numbered checklists. Name the concrete decision, risk, material, mechanism, or process being taught.',
  '- Make the CTA specific to the platform and business: call, request an estimate, book a consultation, ask for availability, or visit the website.',
  '- review_notes must explain why the draft is on-brand, what source/brief facts it used, and any assumption Marvin should verify.',
].join('\n');

const DESIGNER_PROMPT_STANDARD = [
  'DESIGNER PROMPT STANDARD:',
  '- designer_prompt_es must be Spanish and production-ready for Skarleth.',
  '- Include asset type, orientation/ratio, main subject, setting/background, brand cues, text overlay guidance, and what to avoid.',
  '- Do not ask the designer to invent logos, awards, before/after claims, or fake customer photos.',
].join('\n');

const PLATFORM_QUALITY_STANDARD = [
  'PLATFORM QUALITY STANDARD:',
  '- Facebook: local hook + useful context + CTA; conversational, not sales spam.',
  '- Instagram: punchy visual-first caption + 3-6 relevant local/service hashtags at the end.',
  '- Google Business: no hashtags, no emoji, service + city in the first sentence, direct CTA.',
  '- LinkedIn: professional outcome or project/process angle, no consumer-heavy hype.',
  '- TikTok/Reels/video: action-oriented hook that matches a visual sequence the designer can execute.',
].join('\n');

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
    HIGH_QUALITY_CONTENT_STANDARD,
    DESIGNER_PROMPT_STANDARD,
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
    return `${shared}\n\nResearch the client defensively using only reliable, citeable public information available to the terminal agent. Focus on market, services, local angles, audience, and content opportunities.\n\nRESEARCH QUALITY BAR:\n- sources must be real pages consulted, with title + URL; prefer the client site, GBP/public profiles, service pages, and credible local/industry references.\n- summary must distinguish confirmed facts from assumptions.\n- content_opportunities must be usable by social, blog, and GMB agents: include service + location + customer intent, not vague topic names.\n- risks must include any claims the content agents should avoid.\n\nKEYWORD RESEARCH (first-class — the package goal is ranking #1 locally):\n- keyword_research.primary: the 3-6 highest-intent head terms for this business.\n- long_tail: specific multi-word variants real customers search.\n- local_terms: city / neighborhood / service-area keywords from the client's actual areas.\n- near_me: "near me" style local-intent variants.\n- intent: the dominant search intent (local | commercial | transactional | informational).\n- difficulty_notes: brief difficulty/opportunity notes per cluster.\nGround keywords in the client's REAL services and service areas — do not invent locations or services.\n\nMISSING-INFORMATION PROTOCOL (§5): SEARCH the client's website and the open web FIRST. Only when a fact is still unknown or low-confidence after searching, add it to "missing_info" with a concise, specific question for Marvin (e.g. "Do you serve Riverside County, or only San Bernardino? Needed for local keyword targeting."). Record any working "assumptions" you had to make. NEVER invent services, certifications, claims, hours, or locations — unknown means search, then ask. Do not block: still produce everything you can confirm.`;
  }
  if (kind === 'strategy') {
    return `${shared}\n\nCreate a reviewable draft local-SEO strategy. Use existing research + the TARGET KEYWORDS in the brief.\n- monthly_focus must be specific to the client's lead goal, strongest services, and service areas.\n- content_pillars must be reusable by social, blog, and GMB agents without becoming repetitive.\n- weekly_plan must assign a different service angle, location angle, and customer intent per week.\n- seo_plan: an explicit map of keyword -> content_type -> channel (social|blog|gmb) -> cadence. This is the local-SEO plan, not a vague theme list.\n- success_metrics: which target keywords to track, GMB/post cadence, and ranking-movement check-ins.\n- approval_notes must call out assumptions, missing assets, risky claims, and any client approval needed before content is generated.\nBe honest: optimize what the agency controls (relevance, locality, freshness, consistency, quality). Do not promise a guaranteed #1. Keep it a draft for Marvin's review.`;
  }
  if (kind === 'socialWeeklyBatch') {
    const schedule = client?.weekly_schedule_text || 'No package schedule provided.';
    return `${shared}\n\n${PLATFORM_QUALITY_STANDARD}\n\nGenerate ALL social posts for this client's upcoming week based on their package schedule.\n\nPACKAGE SCHEDULE:\n${schedule}\n\nRULES:\n- Create exactly one post per slot in the schedule (exclude blog slots — those are handled separately).\n- Each post must use the correct content_type (image, reel, or video) and day_of_week.\n- Use the client's REAL services and local service areas. Be specific — avoid generic captions.\n- Vary hook_family, service angle, target_locality, target_keyword, and CTA. Do not reuse a hook family until all suitable families have been used.\n- Avoid recurring templates such as before-you-hire/call, permit checklists, project-manager checklists, and numbered things-to-know unless the brief makes that exact angle necessary.\n- Each post needs a clear CTA (call, text, book, visit).\n- master_caption should be 70-140 words for image posts, 45-90 words for reels/videos, unless the platform caption requires shorter copy.\n- LOCAL SEO: set target_keyword to one approved TARGET KEYWORD and target_locality to one confirmed service area. Use both naturally without stuffing.\n- Generate distinct platform_captions for every platform in ACTIVE DELIVERY PLATFORMS in the client context. Never copy the same caption across channels.\n- platform_captions must include facebook AND instagram with distinct tones, optimized PER PLATFORM:\n  facebook: conversational, slightly longer, emojis ok; lead with a local hook.\n  instagram: short, punchy, hashtags at the end including local + service hashtags.\n  google_business: concise, local-SEO focused, primary keyword + city near the front, no emojis.\n- designer_prompt_es: write the visual concept in Spanish for the designer using the designer prompt standard.\n- review_notes: include service used, locality used, CTA reason, and any assumption.\n- Status must remain draft — do not approve, publish, or schedule.`;
  }
  if (kind === 'socialDraft') {
    return `${shared}\n\n${PLATFORM_QUALITY_STANDARD}\n\nDraft one reviewable social content item for this client.\n\nRULES:\n- Use the client's real services and local service areas.\n- Avoid generic captions. Be specific, local, and conversion-focused.\n- Preserve target_keyword, target_locality, hook_family, day_of_week, and content_type during revision.\n- Do not start with the business name; start with the selected hook family and a concrete local situation.\n- Include a clear CTA (call, text, visit, book).\n- platform_captions must include BOTH facebook AND instagram keys with distinct, platform-appropriate text.\n  facebook: slightly longer, conversational, allows emojis.\n  instagram: shorter, punchy, hashtag-friendly.\n  tiktok: casual and energetic if relevant to client.\n  google_business: concise, local SEO focused, no emojis.\n- designer_prompt_es: write the image/video prompt in Spanish using the designer prompt standard.\n- review_notes: include service used, locality used, CTA reason, and any assumption.\n- Do not claim to publish, approve, or schedule. Status remains draft.`;
  }
  if (kind === 'blogWeeklyBatch') {
    const schedule = client?.blog_schedule_text || 'thursday: blog';
    return `${shared}\n\nGenerate ALL blog posts for this client's upcoming week based on their blog schedule.\n\nBLOG SCHEDULE:\n${schedule}\n\nRULES:\n- Create exactly one blog per blog slot in the schedule. Set day_of_week to the slot's day.\n- Each blog: title, slug (kebab-case), seo_title, meta_description, target_keyword, excerpt, and html (article body only — inline-safe markup, no <style>, no <html>/<head>).\n- Blog body target: 900-1,400 useful words unless the task says otherwise. Use H2/H3 structure, short paragraphs, one FAQ section, and a practical CTA.\n- LOCAL SEO: build each blog around a primary TARGET KEYWORD + city/service-area terms; use the keyword in the title, first paragraph, and a subheading naturally (no stuffing). Use the research content opportunities + strategy seo_plan in the brief.\n- Include concrete, client-relevant sections: who it helps, what to expect, common mistakes, local considerations, and when to call/request an estimate.\n- Use the client's REAL services and service areas. Be genuinely useful and locally specific — no fluff.\n- review_notes: identify the keyword, locality, source/brief facts used, and assumptions Marvin should verify.\n- Status remains draft. Do not publish to WordPress, approve, or schedule.`;
  }
  if (kind === 'blogDraft') {
    return `${shared}\n\nDraft one local SEO blog as HTML body content only. Use inline-safe article markup and do not include style tags.\n- Body target: 900-1,400 useful words unless the task says otherwise. Use H2/H3 structure, short paragraphs, one FAQ section, and a practical CTA.\n- LOCAL SEO: build the blog around the client's primary TARGET KEYWORD + city/service-area terms; use the keyword in the title, first paragraph, and a subheading naturally (no stuffing). Add long-tail variants where they fit.\n- Include concrete, client-relevant sections: who it helps, what to expect, common mistakes, local considerations, and when to call/request an estimate.\n- Keep it genuinely useful and locally specific. It must remain a draft and not publish to WordPress.`;
  }
  if (kind === 'gmbPost') {
    const loc = task?.target_location;
    const locName = loc ? (loc.locality || loc.label) : '';
    const locBlock = loc
      ? `\n\nTARGET LOCATION: This post is for the client's "${loc.label}" Google Business Profile${loc.locality ? ` (area: ${loc.locality})` : ''}. You MUST name the location "${locName}" explicitly in the title or first line of the body, and set "locality" to "${locName}". Write SPECIFICALLY for ${locName} — its neighborhoods, local landmarks, and local keyword variants. It MUST read differently from the other locations' posts (no copy-paste across locations).`
      : '';
    return `${shared}${locBlock}\n\nDraft ONE Google Business Profile post engineered to push this client toward 1st-position LOCAL ranking — not a generic post.\n\nRULES:\n- Choose the best post_type for the goal: OFFER (promotion + offer_terms, optional coupon_code), UPDATE (What's New), or EVENT (with event_start/event_end ISO dates).\n- Body target: 120-220 words. First sentence must include service + locality. No hashtags. Minimal emoji.\n- Inject the client's TARGET KEYWORDS + the specific service-area/city term naturally into title + body (no stuffing). Set "locality" to the city/area you targeted.\n- Align to the client's real GMB categories and actual services. Never invent services, locations, hours, or offers.\n- Include a clear cta_type appropriate to the business (CALL for locksmiths/emergency, BOOK/LEARN_MORE for remodeling). Set cta_url when relevant.\n- Keep it fresh, locally specific, and conversion-focused. Use a concrete customer scenario or seasonal trigger.\n- designer_prompt_es: the image concept in Spanish using the designer prompt standard.\n- review_notes: include keyword, locality, post_type reason, CTA reason, and any assumption.\n- This is a DRAFT for review. Do not claim to publish/schedule to GMB.`;
  }
  if (kind === 'gmbOffer') {
    return `${shared}\n\nDraft ONE Google Business Profile OFFER proposal that supports the client's local-SEO ranking strategy. Use the client's TARGET KEYWORDS + real services + service-area term naturally.\n- title: short internal name. description: the customer-facing offer. cta_text: button label.\n- cta_type: pick the most fitting (CALL for emergency trades, BOOK/LEARN_MORE otherwise). Include coupon_code/redeem_url/terms only if genuinely applicable — never invent discounts the client didn't authorize; if unsure, leave them empty and note it in review_notes.\n- valid_until: a reasonable ISO end date if the offer is time-bound, else empty.\n- description must make the service, locality, eligibility, and CTA clear without legal/discount ambiguity.\n- designer_prompt_es: a 1080x1080 GBP square image brief in Spanish using the designer prompt standard.\nThis is a PROPOSAL for Marvin to review and activate — do not claim to publish or activate it.`;
  }
  if (kind === 'gmbEvent') {
    return `${shared}\n\nDraft ONE Google Business Profile EVENT proposal that supports local-SEO ranking (e.g. a seasonal service push, open house, community involvement). Use TARGET KEYWORDS + real services + locality.\n- event_title: public name. event_start_date/event_end_date: realistic near-future ISO dates.\n- cta_type fitting the business; description is the customer-facing copy.\n- designer_prompt_es: Spanish image brief using the designer prompt standard.\nNever invent events the client isn't actually doing — if you cannot ground it, keep it a generic seasonal awareness theme and flag in review_notes. PROPOSAL only for Marvin to review/activate.`;
  }
  if (kind === 'qualityCheck') {
    const draft = task?.draft ? JSON.stringify(task.draft, null, 2) : (task?.review_target ? JSON.stringify(task.review_target, null, 2) : '{}');
    return `${shared}\n\nYou are the QUALITY GATE. Score the DRAFT below against the rubric before it can enter Editorial Review. Be strict and honest.\n\nDRAFT TO EVALUATE:\n${draft}\n\nRUBRIC (each is a boolean; "pass" is true only if ALL are true and score >= 85):\n- relevance: on-topic for the client's services and the selected topic.\n- accuracy: factually grounded in the CLIENT CONTENT BRIEF — no invented claims, certifications, or locations.\n- brand_fit: matches the client's brand voice; obeys NEVER USE / prohibited terms.\n- keyword_usage: uses the client's target keywords + correct local/service-area terms naturally (not stuffed).\n- no_fluff: concrete and specific; no filler, generic platitudes, or repeated hooks.\n- cta_present: a clear, approved call-to-action is present and correct for the channel format.\nAutomatically fail drafts that are generic enough to fit any competitor, omit a real locality, omit a real service, include unsupported offers/claims, or give the designer an unusable visual brief. List concrete "issues" and concrete "required_fixes" whenever a check fails. Do not approve, publish, or schedule — scoring only.`;
  }
  if (kind === 'editorialReview') {
    return `${shared}\n\nYou are the EDITORIAL REVIEW agent. Review the supplied draft content and return only the required JSON.\n\nCHECKS:\n- package fit: if package_violation is present, severity must be at least high and recommended_changes must say to remove/cancel or reclassify before approval.\n- factual risk: flag unsupported response times, prices, review counts, licenses, warranties, guarantees, awards, 'free' offers, and availability claims.\n- service-area accuracy: flag mixed or stray locations that do not match the post's main target locality or client context.\n- platform fit: Facebook, Instagram, Google Business, LinkedIn, X/Threads/Pinterest/Bluesky/TikTok captions must be distinct where present and appropriate for that platform.\n- asset readiness: image posts need ai_image_prompt; reel/video posts need ai_video_prompt or video_script/shot direction; blog posts need usable blog_content and excerpt.\n- Spanish designer prompts: ai_image_prompt/ai_video_prompt must be in Spanish and specific enough for Skarleth to produce the asset.\n- repetition: flag repeated hooks, generic hashtags, or topic sameness when visible in the payload.\n- gates: never approve, publish, mark ready, or mark assets delivered.\n\nSeverity guide: critical for legal/safety/credential risk; high for package mismatch, wrong industry/service, or invented offer/price/SLA; medium for unverified claims or service-area contamination; low for copy polish/platform fit; info for clean passes with minor notes.`;
  }
  if (kind === 'operationalReview') {
    const base = `${shared}\n\nReview the current platform snapshot defensively. Identify only actionable production risks. Do not suggest shell commands that mutate production state.`;
    if (task?.agent_slug === 'system-reliability') {
      return `${base}\n\nADDITIONALLY: for recurring or code-level reliability issues, output a "code_proposals" array. Each proposal must name the problem, the likely root cause, a concrete suggested fix, the affected_files, and a risk rating. Optionally include a small unified-diff snippet in "diff". These proposals are POSTED TO DISCORD FOR A HUMAN — they are NEVER applied automatically. Do NOT attempt to edit files, run commands, deploy, or change any production state yourself. Propose only.`;
    }
    return base;
  }
  if (kind === 'reliabilityReview') {
    return `${shared}\n\nAudit runtime reliability only: generation runs, approved jobs, backend attempts, leases, expected schedule timing, retries, and recorded errors. A zero-output run is not a failure when no package slot was due. Tie every finding to a run, job, or backend identifier in the supplied snapshot. Do not discuss content strategy, local git state, or security unless it directly caused a runtime failure. Code proposals are advisory and must never be applied automatically.`;
  }
  if (kind === 'securityReview') {
    return `${shared}\n\nAudit security only: authentication failures, authorization boundaries, role access, bot-secret protection, approved-command whitelisting, credential exposure, MCP permissions, and sensitive logging. Do not report content throughput, local git status, copy quality, or ordinary generation failures as security findings. Redact secrets and recommend human-reviewed remediation only.`;
  }
  if (kind === 'orchestratorReview') {
    return `${shared}\n\nAct as the agency operations coordinator. Prioritize only current, evidence-backed work. Convert each actionable issue into an assignment naming the responsible existing agent, one concrete action, priority, and reason. Respect profile-completeness, editorial-review, Marvin approval, and designer gates. Do not duplicate reliability/security findings and do not claim an assignment was executed.`;
  }
  return `${shared}\n\nReview the provided task/content context for factual risk, repetition, quality, and platform fit.`;
}
