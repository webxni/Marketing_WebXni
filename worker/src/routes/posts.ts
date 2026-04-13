/**
 * Post routes — CRUD + workflow actions
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  listPosts,
  getPostById,
  createPost,
  updatePost,
  setPostStatus,
  getPostPlatforms,
  writeAuditLog,
  getClientWithConfig,
} from '../db/queries';

export const postRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

/** GET /api/posts */
postRoutes.get('/', async (c) => {
  const q = c.req.query();
  const { client, status, platform, limit, page } = q;
  // Support both date_from/date_to and from/to
  const dateFrom = q['date_from'] ?? q['from'];
  const dateTo   = q['date_to']   ?? q['to'];

  let clientId: string | undefined;
  if (client) {
    const row = await c.env.DB
      .prepare('SELECT id FROM clients WHERE slug = ?')
      .bind(client)
      .first<{ id: string }>();
    clientId = row?.id;
  }

  const pageNum  = page ? Math.max(1, parseInt(page)) : 1;
  const limitNum = limit ? Math.min(200, parseInt(limit)) : 50;
  const offset   = (pageNum - 1) * limitNum;

  const [posts, countRow] = await Promise.all([
    listPosts(c.env.DB, {
      clientId,
      status,
      platform,
      dateFrom,
      dateTo,
      limit: limitNum,
      offset,
    }),
    c.env.DB
      .prepare('SELECT COUNT(*) as n FROM posts' +
        (clientId  ? ' WHERE client_id = ?' :
         status    ? ' WHERE status = ?'    : ''))
      .bind(...(clientId ? [clientId] : status ? [status] : []))
      .first<{ n: number }>(),
  ]);

  // Join client name
  const enriched = await Promise.all(posts.map(async (p) => {
    const cl = await c.env.DB
      .prepare('SELECT slug, canonical_name FROM clients WHERE id = ?')
      .bind(p.client_id)
      .first<{ slug: string; canonical_name: string }>();
    return { ...p, client_slug: cl?.slug, client_name: cl?.canonical_name };
  }));

  return c.json({ posts: enriched, total: countRow?.n ?? posts.length });
});

/** GET /api/posts/:id */
postRoutes.get('/:id', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  const platforms = await getPostPlatforms(c.env.DB, post.id);
  // Join client name
  const cl = await c.env.DB
    .prepare('SELECT slug, canonical_name FROM clients WHERE id = ?')
    .bind(post.client_id)
    .first<{ slug: string; canonical_name: string }>();
  return c.json({ post: { ...post, client_slug: cl?.slug, client_name: cl?.canonical_name }, platforms });
});

/** POST /api/posts */
postRoutes.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  // Resolve client_slug → client_id if needed
  let clientId = body['client_id'] as string | undefined;
  if (!clientId && body['client_slug']) {
    const row = await c.env.DB
      .prepare('SELECT id FROM clients WHERE slug = ?')
      .bind(body['client_slug'])
      .first<{ id: string }>();
    if (!row) return c.json({ error: 'Client not found' }, 404);
    clientId = row.id;
  }
  if (!clientId) return c.json({ error: 'client_id or client_slug required' }, 400);

  const user = c.get('user');
  const post = await createPost(c.env.DB, {
    client_id:           clientId,
    title:               (body['title'] as string) ?? null,
    status:              (body['status'] as string) ?? 'draft',
    content_type:        (body['content_type'] as string) ?? 'image',
    platforms:           typeof body['platforms'] === 'string'
                           ? body['platforms']
                           : JSON.stringify(body['platforms'] ?? []),
    publish_date:        (body['publish_date'] as string) ?? null,
    master_caption:      (body['master_caption'] as string) ?? null,
    cap_facebook:        (body['cap_facebook'] as string) ?? null,
    cap_instagram:       (body['cap_instagram'] as string) ?? null,
    cap_linkedin:        (body['cap_linkedin'] as string) ?? null,
    cap_x:               (body['cap_x'] as string) ?? null,
    cap_threads:         (body['cap_threads'] as string) ?? null,
    cap_tiktok:          (body['cap_tiktok'] as string) ?? null,
    cap_pinterest:       (body['cap_pinterest'] as string) ?? null,
    cap_bluesky:         (body['cap_bluesky'] as string) ?? null,
    cap_google_business: (body['cap_google_business'] as string) ?? null,
    cap_gbp_la:          (body['cap_gbp_la'] as string) ?? null,
    cap_gbp_wa:          (body['cap_gbp_wa'] as string) ?? null,
    cap_gbp_or:          (body['cap_gbp_or'] as string) ?? null,
    // Content fields
    blog_content:        (body['blog_content'] as string) ?? null,
    seo_title:           (body['seo_title'] as string) ?? null,
    meta_description:    (body['meta_description'] as string) ?? null,
    target_keyword:      (body['target_keyword'] as string) ?? null,
    slug:                (body['slug'] as string) ?? null,
    youtube_title:       (body['youtube_title'] as string) ?? null,
    youtube_description: (body['youtube_description'] as string) ?? null,
    video_script:        (body['video_script'] as string) ?? null,
    ai_image_prompt:     (body['ai_image_prompt'] as string) ?? null,
    ai_video_prompt:     (body['ai_video_prompt'] as string) ?? null,
    // GBP
    gbp_topic_type:       (body['gbp_topic_type'] as string) ?? null,
    gbp_cta_type:         (body['gbp_cta_type'] as string) ?? null,
    gbp_cta_url:          (body['gbp_cta_url'] as string) ?? null,
    gbp_event_title:      (body['gbp_event_title'] as string) ?? null,
    gbp_event_start_date: (body['gbp_event_start_date'] as string) ?? null,
    gbp_event_start_time: (body['gbp_event_start_time'] as string) ?? null,
    gbp_event_end_date:   (body['gbp_event_end_date'] as string) ?? null,
    gbp_event_end_time:   (body['gbp_event_end_time'] as string) ?? null,
    gbp_coupon_code:      (body['gbp_coupon_code'] as string) ?? null,
    gbp_redeem_url:       (body['gbp_redeem_url'] as string) ?? null,
    gbp_terms:            (body['gbp_terms'] as string) ?? null,
    asset_r2_key:        (body['asset_r2_key'] as string) ?? null,
    canva_link:          (body['canva_link'] as string) ?? null,
    created_by:          user.userId,
  } as Parameters<typeof createPost>[1]);

  await writeAuditLog(c.env.DB, {
    user_id: user.userId,
    action: 'post.create',
    entity_type: 'post',
    entity_id: post.id,
  });
  return c.json({ post }, 201);
});

/** PUT /api/posts/:id */
postRoutes.put('/:id', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  // Version snapshot
  const snap = JSON.stringify(post);
  const version = await c.env.DB
    .prepare('SELECT COALESCE(MAX(version), 0) + 1 as v FROM post_versions WHERE post_id = ?')
    .bind(post.id)
    .first<{ v: number }>();
  await c.env.DB
    .prepare('INSERT INTO post_versions (id, post_id, version, changed_by, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID().replace(/-/g, ''), post.id, version?.v ?? 1, c.get('user').userId, snap, Math.floor(Date.now() / 1000))
    .run();

  await updatePost(c.env.DB, post.id, body as Record<string, unknown>);
  const updated = await getPostById(c.env.DB, post.id);
  return c.json({ post: updated });
});

/** POST /api/posts/:id/approve */
postRoutes.post('/:id/approve', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  await setPostStatus(c.env.DB, post.id, 'approved');
  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'post.approve',
    entity_type: 'post',
    entity_id: post.id,
    old_value: { status: post.status },
    new_value: { status: 'approved' },
  });
  return c.json({ ok: true, status: 'approved' });
});

/** POST /api/posts/:id/reject */
postRoutes.post('/:id/reject', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  let reason = '';
  try { reason = ((await c.req.json()) as { reason?: string }).reason ?? ''; } catch { /* empty */ }
  await setPostStatus(c.env.DB, post.id, 'draft');
  if (reason) await updatePost(c.env.DB, post.id, { error_log: `[REJECTED] ${reason}` });
  return c.json({ ok: true, status: 'draft' });
});

/** POST /api/posts/:id/ready */
postRoutes.post('/:id/ready', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  await updatePost(c.env.DB, post.id, { status: 'ready', ready_for_automation: 1, asset_delivered: 1 });
  return c.json({ ok: true, status: 'ready' });
});

/** POST /api/posts/:id/publish */
postRoutes.post('/:id/publish', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);

  let dryRun = false;
  try { dryRun = ((await c.req.json()) as { dry_run?: boolean }).dry_run ?? false; } catch { /* empty */ }

  const { createPostingJob } = await import('../db/queries');
  const job = await createPostingJob(c.env.DB, { triggered_by: 'api', mode: dryRun ? 'dry_run' : 'real', client_filter: undefined });

  const { runPosting } = await import('../loader/posting-run');
  c.executionCtx.waitUntil(
    runPosting(c.env, { mode: dryRun ? 'dry_run' : 'real', job_id: job.id, triggered_by: 'api' }),
  );

  return c.json({ ok: true, job_id: job.id, dry_run: dryRun }, 202);
});

/** POST /api/posts/:id/retry */
postRoutes.post('/:id/retry', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare("UPDATE post_platforms SET status = 'pending', tracking_id = NULL, error_message = NULL WHERE post_id = ? AND status = 'failed'")
    .bind(post.id)
    .run();
  await setPostStatus(c.env.DB, post.id, 'ready', 'Pending');
  return c.json({ ok: true, message: 'Failed platforms reset' });
});

/** GET /api/posts/:id/platforms */
postRoutes.get('/:id/platforms', async (c) => {
  const platforms = await getPostPlatforms(c.env.DB, c.req.param('id'));
  return c.json({ platforms });
});

/** DELETE /api/posts/:id */
postRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin' && user.role !== 'manager') {
    return c.json({ error: 'Forbidden — only admin/manager can delete posts' }, 403);
  }
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);

  await c.env.DB
    .prepare('DELETE FROM post_platforms WHERE post_id = ?')
    .bind(post.id)
    .run();
  await c.env.DB
    .prepare('DELETE FROM post_versions WHERE post_id = ?')
    .bind(post.id)
    .run();
  await c.env.DB
    .prepare('DELETE FROM posts WHERE id = ?')
    .bind(post.id)
    .run();

  await writeAuditLog(c.env.DB, {
    user_id: user.userId,
    action: 'post.delete',
    entity_type: 'post',
    entity_id: post.id,
    old_value: { title: post.title, status: post.status },
  });
  return c.json({ ok: true });
});

/** GET /api/posts/:id/history */
postRoutes.get('/:id/history', async (c) => {
  const versions = await c.env.DB
    .prepare('SELECT id, version, changed_by, created_at FROM post_versions WHERE post_id = ? ORDER BY version DESC')
    .bind(c.req.param('id'))
    .all();
  return c.json({ versions: versions.results });
});

/** POST /api/posts/:id/translate — translate post context to Spanish for designer */
postRoutes.post('/:id/translate', async (c) => {
  try {
    const post = await getPostById(c.env.DB, c.req.param('id'));
    if (!post) return c.json({ error: 'Not found' }, 404);

    const fields: Record<string, string> = {};
    if (post.title)          fields.title = post.title;
    if (post.master_caption) fields.master_caption = post.master_caption;

    if (Object.keys(fields).length === 0) {
      return c.json({ translations: {} });
    }

    if (!c.env.OPENAI_API_KEY) {
      return c.json({ error: 'OPENAI_API_KEY not configured' }, 503);
    }

    const prompt = `Translate the following social media post fields to Spanish. Return a JSON object with the same keys. Keep brand names, hashtags, and emojis as-is. Only translate the text.\n\n${JSON.stringify(fields)}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a translator. Always respond with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 500,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return c.json({ error: `OpenAI ${res.status}: ${errBody.slice(0, 300)}` }, 502);
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw  = data.choices?.[0]?.message?.content;
    if (!raw) return c.json({ error: 'Empty response from OpenAI' }, 502);

    const translations = JSON.parse(raw) as Record<string, string>;
    return c.json({ translations });
  } catch (err) {
    console.error('[translate]', err);
    return c.json({ error: String(err) }, 500);
  }
});

/** POST /api/posts/:id/generate-caption — generate a caption for a new platform */
postRoutes.post('/:id/generate-caption', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);

  const { platform } = await c.req.json<{ platform: string }>();
  if (!platform) return c.json({ error: 'platform required' }, 400);

  // Map platform to caption field
  const capField = platform === 'google_business' ? 'cap_google_business' : `cap_${platform}`;

  const client = await getClientWithConfig(c.env.DB, post.client_id);
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const intel = await c.env.DB
    .prepare('SELECT * FROM client_intelligence WHERE client_id = ?')
    .bind(post.client_id)
    .first<{ brand_voice?: string | null; prohibited_terms?: string | null }>();

  // Build a focused prompt for one platform caption
  const platformInstructions: Record<string, string> = {
    facebook:        'engaging Facebook caption, can be longer, include a question or CTA (150-400 chars)',
    instagram:       'Instagram caption with relevant emojis and 10-15 hashtags (150-300 chars + hashtags on new lines)',
    linkedin:        'professional LinkedIn caption, insight-driven, no hashtag spam (200-500 chars, 3-5 hashtags max)',
    x:               'X/Twitter post, punchy and direct, max 280 chars total',
    threads:         'casual Threads post, conversational, 100-250 chars',
    tiktok:          'TikTok caption with trending hashtags (150-250 chars + 5-10 hashtags)',
    pinterest:       'Pinterest description, keyword-rich, 100-200 chars + 5-8 hashtags',
    bluesky:         'Bluesky post, casual and direct, max 300 chars',
    google_business: 'Google Business post, factual and local, 100-250 chars, NO hashtags',
    youtube:         'YouTube description with CTA (200-400 chars)',
    website_blog:    'blog teaser/excerpt, compelling lead paragraph (100-200 chars)',
  };

  const instrText = platformInstructions[platform] ?? 'concise social media caption (100-250 chars)';
  const lang = client.language && client.language !== 'en' ? client.language : 'en';

  const prompt = `You are a social media writer for ${client.canonical_name}.${client.industry ? ` Industry: ${client.industry}.` : ''}${lang !== 'en' ? ` Write in ${lang}.` : ''}
${intel?.brand_voice ? `Brand voice: ${intel.brand_voice}.` : ''}${intel?.prohibited_terms ? ` NEVER USE: ${intel.prohibited_terms}.` : ''}${client.cta_text ? ` Preferred CTA: ${client.cta_text}.` : ''}

Post title: ${post.title ?? ''}
Master caption: ${post.master_caption ?? ''}

Write a ${platform} caption: ${instrText}.

Return JSON: { "caption": "..." }`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a social media content writer. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.75,
      max_tokens: 400,
    }),
  });

  if (!res.ok) return c.json({ error: 'Generation service unavailable' }, 502);

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const raw  = data.choices?.[0]?.message?.content;
  if (!raw) return c.json({ error: 'Empty response' }, 502);

  let caption: string;
  try {
    caption = (JSON.parse(raw) as { caption: string }).caption;
  } catch {
    return c.json({ error: 'Failed to parse response' }, 502);
  }

  // Save caption to post and add platform to platforms list
  const existingPlatforms: string[] = JSON.parse(post.platforms ?? '[]');
  const updatedPlatforms = existingPlatforms.includes(platform)
    ? existingPlatforms
    : [...existingPlatforms, platform];

  await c.env.DB
    .prepare(`UPDATE posts SET ${capField} = ?, platforms = ?, updated_at = ? WHERE id = ?`)
    .bind(caption, JSON.stringify(updatedPlatforms), Math.floor(Date.now() / 1000), post.id)
    .run();

  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'generate_caption',
    entity_type: 'post',
    entity_id: post.id,
  });

  return c.json({ ok: true, platform, caption, field: capField });
});
