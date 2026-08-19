import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ClientRow, Env, SessionData } from '../types';
import {
  appendAgencyLog,
  getAgencyClientContentBrief,
  getClientGenerationTopicHistory,
  createAgentFinding,
  createAgentRun,
  createAgentTask,
  createGenerationRun,
  createApprovedCommandJob,
  createPost,
  updatePost,
  getPostById,
  getPostByAutomationSlot,
  getAgencyClientCoverage,
  getAgencyLogs,
  getApprovedCommandJobById,
  getAgentSystemHealthSnapshot,
  getAgentTask,
  getGenerationRunById,
  saveClientResearch,
  saveClientStrategy,
  saveContentReview,
  listAgencyReviewQueueCandidates,
  listAgencyBackendHealth,
  recordAgencyBackendHealth,
  listAgencyOverview,
  listAgentDefinitions,
  listAgentFindings,
  listAgentRuns,
  listAgentTasks,
  listApprovedCommandJobs,
  updateAgentFinding,
  updateAgentHeartbeat,
  updateAgentRun,
  updateAgentTask,
  finalizeGenerationRun,
  checkStaleAgents,
  markAgentStale,
  getAgentHealthSummary,
  writeAuditLog,
  recordAgencyCost,
  getAgentSpendToday,
  upsertClientKeywords,
  upsertClientProfileGap,
  createClientOfferDraft,
  createClientEventDraft,
  listAgencyStrategyPlans,
  approveAgencyStrategyPlan,
  listClientsByOwnerGroup,
  getClientById,
  resolveContentReviewFinding,
  buildTopicFingerprint,
  findRecentTopicConflict,
} from '../db/queries';
import { buildPostContentHash, normalizeContentReviewFindings } from '../modules/content-review';
import { redactSecrets } from '../modules/redaction';
import { resolveBlogTemplateConfig } from '../modules/blog-templates';
import { syncUploadPostClientPlatforms } from '../modules/uploadpost-platform-sync';
import { UploadPostClient } from '../services/uploadpost';
import { discordSend } from '../services/discord';
import { requirePermission } from '../middleware/auth';
import {
  evaluateLocksmithGenerationGate,
  getLocksmithPortfolioTopicCollision,
  assertLocksmithPortfolioGenerationReady,
  assertLocksmithContentReady,
  findProhibitedLocksmithService,
  isGovernedLocksmith,
  LOCKSMITH_OWNER_GROUP,
  validateLocksmithGeneratedContent,
} from '../modules/editorial-governance';
import { agencySafety, backendPriorityForAgent, commandForAgent } from '../modules/agency-contract';

export const agencyRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();
export const agencyInternalRoutes = new Hono<{ Bindings: Env; Variables: Record<string, unknown> }>();

// Internal automation callers need a stable, secret-safe failure contract.
// Without this handler Hono collapses unexpected D1/runtime failures to a plain
// 500, which leaves the harness unable to classify, quarantine, or repair the
// underlying defect without blind retries.
agencyInternalRoutes.onError((error, c) => {
  const detail = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 600);
  console.error('[agency-internal] request failed:', detail);
  return c.json({
    error: 'Internal agency request failed',
    code: 'AGENCY_INTERNAL_ERROR',
    detail,
  }, 500);
});

agencyRoutes.use('*', requirePermission('automation.generate'));

const TIMELINE = [
  { day: 'Monday', title: 'Security check', agent_slug: 'security-sentinel', summary: 'Defensive audit and auth signal review.' },
  { day: 'Monday', title: 'System health check', agent_slug: 'system-reliability', summary: 'Queue, generation, and posting reliability review.' },
  { day: 'Monday', title: 'Client research batch', agent_slug: 'client-research', summary: 'Quota-limited research for active clients.' },
  { day: 'Tuesday', title: 'Client research batch', agent_slug: 'client-research', summary: 'Continue gradual research coverage.' },
  { day: 'Wednesday', title: 'Strategy refinement', agent_slug: 'strategy', summary: 'Convert research into reviewable themes and plans.' },
  { day: 'Thursday', title: 'Blog draft preparation', agent_slug: 'blog-writer', summary: 'Draft SEO blog content without publishing.' },
  { day: 'Friday', title: 'Weekly strategy planning', agent_slug: 'strategy', summary: 'Prepare priorities for the upcoming content week.' },
  { day: 'Saturday', title: 'Blog generation and review', agent_slug: 'blog-writer', summary: 'Optional quota-limited blog work.' },
  { day: 'Sunday', title: 'Social draft generation', agent_slug: 'social-copy', summary: 'Generate drafts for Marvin approval.' },
  { day: 'Sunday', title: 'Editorial review', agent_slug: 'editorial-review', summary: 'Quality and factual-risk review before approval.' },
  { day: 'Sunday', title: 'Agency summary', agent_slug: 'agency-orchestrator', summary: 'Summarize bottlenecks and next actions.' },
] as const;

function timelineStatus(day: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = days[new Date().getUTCDay()];
  const todayIdx = days.indexOf(today);
  const itemIdx = days.indexOf(day);
  if (itemIdx < todayIdx) return 'completed';
  if (itemIdx === todayIdx) return 'waiting';
  return 'upcoming';
}

function agencySkills() {
  return [
    ['webxni-agency-orchestrator', 'Coordinates safe weekly agency work.', 'agency-orchestrator', 'Hermes CLI'],
    ['webxni-system-reliability', 'Reviews platform and job health defensively.', 'system-reliability', 'Hermes CLI'],
    ['webxni-security-sentinel', 'Reviews auth/audit signals with redaction.', 'security-sentinel', 'Hermes CLI'],
    ['webxni-client-research', 'Quota-limited active client research.', 'client-research', 'Hermes CLI'],
    ['webxni-strategist', 'Creates reviewable client strategy plans.', 'strategy', 'Hermes CLI'],
    ['webxni-social-copywriter', 'Drafts social copy without approval bypass.', 'social-copy', 'Hermes CLI'],
    ['webxni-blog-writer', 'Drafts SEO blogs without publishing.', 'blog-writer', 'Hermes CLI'],
    ['webxni-editorial-reviewer', 'Reviews drafts for quality and factual risk.', 'editorial-review', 'Hermes CLI'],
    ['webxni-gmb-rank', 'Drafts GMB posts engineered for local #1 ranking.', 'gmb-rank', 'Hermes CLI'],
  ].map(([name, purpose, agent_slug, backend]) => ({
    name,
    purpose,
    agent_slug,
    backend,
    last_used: null,
    status: 'available',
  }));
}

function harnessFlow() {
  return [
    ['Discord command or scheduled trigger', 'User intent starts at Discord, cron, or the protected dashboard.'],
    ['Protected backend endpoint', 'The Worker validates auth and maps the request to a fixed agent slug.'],
    ['approved_command_jobs', 'Only fixed command_name values are queued. No shell command comes from the user.'],
    ['Local Discord bot / PM2 runner', 'The bot claims one approved job and runs a fixed script from the whitelist.'],
    ['Whitelisted script', 'The script builds deterministic prompts and validates structured JSON.'],
    ['Hermes CLI / Gemini API / Claude/OpenAI fallback', 'Backend choice is agent-specific and budget controlled; Codex is not part of active agency routing.'],
    ['Database save', 'Outputs are saved as tasks, findings, research, strategy, or draft content.'],
    ['Discord notification', 'Concise status updates are sent without secrets.'],
    ['Frontend dashboard update', 'The AI Agency page reads task, run, finding, and coverage state.'],
    ['Human approval / designer gate', 'Marvin approval and designer asset delivery remain mandatory.'],
    ['Scheduling / posting', 'Existing automation posts only after the current gates pass.'],
  ].map(([title, summary], index) => ({ order: index + 1, title, summary }));
}

agencyRoutes.get('/overview', async (c) => c.json(await listAgencyOverview(c.env.DB)));
agencyRoutes.get('/agents', async (c) => c.json({ agents: await listAgentDefinitions(c.env.DB) }));
agencyRoutes.get('/runs', async (c) => c.json({ runs: await listAgentRuns(c.env.DB) }));
agencyRoutes.get('/tasks', async (c) => c.json({ tasks: await listAgentTasks(c.env.DB) }));
agencyRoutes.get('/tasks/:id', async (c) => {
  const task = await getAgentTask(c.env.DB, c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  return c.json({ task });
});
agencyRoutes.get('/findings', async (c) => c.json({ findings: await listAgentFindings(c.env.DB) }));
agencyRoutes.get('/client-coverage', async (c) => c.json({ clients: await getAgencyClientCoverage(c.env.DB) }));
agencyRoutes.get('/strategies', async (c) => c.json({ strategies: await listAgencyStrategyPlans(c.env.DB) }));

agencyRoutes.get('/editorial-readiness', async (c) => {
  const requestedMonth = c.req.query('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(requestedMonth)
    ? requestedMonth
    : new Date().toISOString().slice(0, 7);
  const clients = await listClientsByOwnerGroup(c.env.DB, LOCKSMITH_OWNER_GROUP);
  const collision = await getLocksmithPortfolioTopicCollision(c.env.DB, month);
  const rows = [];
  for (const client of clients) {
    const gate = await evaluateLocksmithGenerationGate(c.env.DB, client.id, month);
    const checks = gate.checks;
    const finalStatus = !checks.research_safe ? 'Blocked by research'
      : !checks.strategy_approved ? 'Blocked by strategy approval'
      : !checks.topic_plan_approved ? 'Blocked by topic plan'
      : (!checks.services_approved || !checks.locations_approved) ? 'Blocked by service cleanup'
      : !checks.keywords_approved ? 'Blocked by keyword cleanup'
      : !checks.destination_verified ? 'Blocked by destination mapping'
      : !checks.claims_safe ? 'Blocked by claim approval'
      : collision ? 'Blocked by owner confirmation'
      : 'Ready to generate';
    rows.push({
      brand: client.canonical_name,
      slug: client.slug,
      research_clean: checks.research_safe ? 'Ready to generate' : 'Blocked by research',
      strategy_approved: checks.strategy_approved ? 'Ready to generate' : 'Blocked by strategy approval',
      topics_approved: checks.topic_plan_approved ? 'Ready to generate' : 'Blocked by topic plan',
      services_clean: checks.services_approved && checks.locations_approved ? 'Ready to generate' : 'Blocked by service cleanup',
      keywords_curated: checks.keywords_approved ? 'Ready to generate' : 'Blocked by keyword cleanup',
      destination_verified: checks.destination_verified ? 'Ready to generate' : 'Blocked by destination mapping',
      claims_approved: checks.claims_safe ? 'Ready to generate' : 'Blocked by claim approval',
      cross_brand_check: collision ? 'Blocked by owner confirmation' : 'Ready to generate',
      ready_to_generate: finalStatus,
      reasons: gate.reasons,
    });
  }
  return c.json({ month, portfolio_collision: collision, rows });
});

agencyRoutes.post('/strategies/:id/approve', requirePermission('posts.approve'), async (c) => {
  const strategy = await approveAgencyStrategyPlan(c.env.DB, c.req.param('id') ?? '');
  if (!strategy) return c.json({ error: 'Strategy plan not found' }, 404);
  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'agency.strategy.approve',
    entity_type: 'client_strategy_plan',
    entity_id: strategy.id,
    new_value: { client_id: strategy.client_id, period_start: strategy.period_start, period_end: strategy.period_end },
    ip: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? undefined,
  });
  return c.json({ ok: true, strategy });
});

agencyRoutes.post('/content-reviews/:id/resolve', requirePermission('posts.approve'), async (c) => {
  const parsed = z.object({
    review_status: z.enum(['approved', 'rejected']),
    source_action: z.enum(['none', 'approve', 'reject', 'quarantine']).default('none'),
    finding_index: z.number().int().min(0).default(0),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const review = await resolveContentReviewFinding(
    c.env.DB,
    c.req.param('id') ?? '',
    c.get('user').userId,
    parsed.data.review_status,
    parsed.data.source_action,
    parsed.data.finding_index,
  );
  if (!review) return c.json({ error: 'Content review not found' }, 404);
  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'agency.content_review.resolve',
    entity_type: 'content_review_note',
    entity_id: review.id,
    new_value: parsed.data,
    ip: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? undefined,
  });
  return c.json({ ok: true, review });
});
agencyRoutes.get('/timeline', async (c) => c.json({ items: TIMELINE.map((item) => ({ ...item, status: timelineStatus(item.day) })) }));
agencyRoutes.get('/logs', async (c) => c.json({ logs: await getAgencyLogs(c.env.DB) }));
agencyRoutes.get('/skills', async (c) => c.json({ skills: agencySkills() }));
agencyRoutes.get('/harness-flow', async (c) => c.json({ steps: harnessFlow() }));
agencyRoutes.get('/health', async (c) => {
  const [agents, summary] = await Promise.all([
    listAgentDefinitions(c.env.DB),
    getAgentHealthSummary(c.env.DB),
  ]);
  const stale = agents.filter((a) => a.heartbeat_status === 'stale');
  const failed = agents.filter((a) => a.heartbeat_status === 'failed');
  const running = agents.filter((a) => a.heartbeat_status === 'running');
  return c.json({ summary, stale_agents: stale, failed_agents: failed, running_agents: running, agents });
});

const createTaskSchema = z.object({
  agent_slug: z.string().min(1),
  client_id: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  input_json: z.record(z.unknown()).nullable().optional(),
});

agencyRoutes.post('/tasks', async (c) => {
  const parsed = createTaskSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  if (!commandForAgent(parsed.data.agent_slug)) return c.json({ error: 'Unknown agent_slug' }, 400);
  const task = await createAgentTask(c.env.DB, {
    agent_slug: parsed.data.agent_slug,
    client_id: parsed.data.client_id ?? null,
    title: parsed.data.title,
    priority: parsed.data.priority ?? 'medium',
    input_json: parsed.data.input_json ? JSON.stringify(parsed.data.input_json) : null,
  });
  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'agency.task.create',
    entity_type: 'agent_task',
    entity_id: task.id,
    new_value: { agent_slug: task.agent_slug, title: task.title },
  });
  return c.json({ ok: true, task }, 201);
});

async function enqueueAgent(c: Context<{ Bindings: Env; Variables: { user: SessionData } }>, agentSlug: string, taskId?: string | null) {
  const commandName = commandForAgent(agentSlug);
  if (!commandName) return c.json({ error: 'Unknown agent_slug' }, 400);
  const agents = await listAgentDefinitions(c.env.DB);
  const agent = agents.find((item) => item.slug === agentSlug);
  if (!agent || agent.enabled !== 1) return c.json({ error: 'Agent is disabled or missing' }, 400);

  const task = taskId
    ? await getAgentTask(c.env.DB, taskId)
    : await createAgentTask(c.env.DB, {
      agent_slug: agentSlug,
      title: `Manual ${agent.name} run`,
      input_json: JSON.stringify({ requested_from: 'agency_dashboard' }),
    });
  if (!task) return c.json({ error: 'Task not found' }, 404);

  let taskInput: Record<string, unknown> = {};
  try {
    const parsedInput = JSON.parse(task.input_json ?? '{}') as unknown;
    if (parsedInput && typeof parsedInput === 'object' && !Array.isArray(parsedInput)) {
      taskInput = parsedInput as Record<string, unknown>;
    }
  } catch { /* retain empty task input */ }

  const job = await createApprovedCommandJob(c.env.DB, {
    generation_run_id: null,
    command_name: commandName,
    provider: agent.default_backend,
    requested_by: c.get('user').userId,
    args_json: JSON.stringify({
      ...taskInput,
      agent_slug: agentSlug,
      task_id: task.id,
      source: 'agency_dashboard',
      backend_priority: backendPriorityForAgent(agentSlug),
      safety: agencySafety(),
    }),
  });
  await updateAgentTask(c.env.DB, task.id, { approved_job_id: job.id, status: 'queued', progress: 0 });
  await appendAgencyLog(c.env.DB, {
    agent_slug: agentSlug,
    task_id: task.id,
    job_id: job.id,
    status: 'queued',
    step: 'enqueue',
    summary: `${agent.name} queued as approved command ${commandName}.`,
    backend: agent.default_backend,
  });
  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'agency.agent.enqueue',
    entity_type: 'agent_task',
    entity_id: task.id,
    new_value: { agent_slug: agentSlug, command_name: commandName, job_id: job.id },
  });
  return c.json({ ok: true, task_id: task.id, approved_job_id: job.id, command_name: commandName }, 202);
}

agencyRoutes.post('/agents/:slug/run', async (c) => enqueueAgent(c, c.req.param('slug')));
agencyRoutes.post('/tasks/:id/retry', async (c) => {
  const task = await getAgentTask(c.env.DB, c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  return enqueueAgent(c, task.agent_slug, task.id);
});
agencyRoutes.post('/tasks/:id/reviewed', async (c) => {
  const task = await updateAgentTask(c.env.DB, c.req.param('id'), { status: 'completed', progress: 100 });
  if (!task) return c.json({ error: 'Not found' }, 404);
  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'agency.task.reviewed',
    entity_type: 'agent_task',
    entity_id: task.id,
    new_value: { agent_slug: task.agent_slug },
  });
  return c.json({ ok: true, task });
});
agencyRoutes.post('/findings/:id/acknowledge', async (c) => {
  await updateAgentFinding(c.env.DB, c.req.param('id'), 'acknowledged');
  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'agency.finding.acknowledge',
    entity_type: 'agent_finding',
    entity_id: c.req.param('id'),
  });
  return c.json({ ok: true });
});

async function requireBotSecret(c: { req: { header(name: string): string | undefined }; env: Env }): Promise<boolean> {
  const authHeader = c.req.header('Authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  let botSecret = '';
  try {
    const raw = await c.env.KV_BINDING.get('settings:system');
    const settings = raw ? JSON.parse(raw) as Record<string, string> : {};
    botSecret = settings['discord_bot_secret'] || '';
  } catch { /* ignore */ }
  return !!botSecret && bearerToken === botSecret;
}

async function governedAgencyContentBlock(db: D1Database, clientId: string, targetDate?: string | null): Promise<string | null> {
  const client = await getClientById(db, clientId);
  if (!client || !isGovernedLocksmith(client)) return null;
  const day = targetDate?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  try {
    await assertLocksmithPortfolioGenerationReady(db, [client], day, day);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const internalUpdateSchema = z.object({
  agent_slug: z.string(),
  task_id: z.string().optional(),
  run_id: z.string().optional(),
  job_id: z.string().optional(),
  status: z.string(),
  progress: z.number().int().min(0).max(100).optional(),
  summary: z.string().optional(),
  output_json: z.record(z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  backend: z.string().optional(),
});

const internalFindingSchema = z.object({
  agent_slug: z.string(),
  task_id: z.string().optional(),
  client_id: z.string().nullable().optional(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'blocker', 'critical']),
  title: z.string().min(1).max(200),
  finding_json: z.record(z.unknown()).nullable().optional(),
});

const internalResearchSchema = z.object({
  agent_slug: z.string(),
  task_id: z.string().optional(),
  client_id: z.string(),
  source: z.string().min(1).max(80).optional(),
  freshness_date: z.string().min(8).max(20),
  brand_name: z.string().min(1).max(200),
  source_url: z.string().max(1000).nullable(),
  source_domain: z.string().max(300).nullable(),
  source_title: z.string().max(500).nullable(),
  entity_match: z.boolean(),
  geography_match: z.boolean(),
  service_match: z.boolean(),
  prohibited_service_detected: z.boolean(),
  confidence: z.enum(['low', 'medium', 'high']),
  review_status: z.literal('pending'),
  expires_at: z.string().max(20).nullable(),
  notes: z.string().max(2000).nullable(),
  research_json: z.record(z.unknown()),
});

const internalStrategySchema = z.object({
  agent_slug: z.string(),
  task_id: z.string().optional(),
  client_id: z.string(),
  period_start: z.string().min(8).max(20),
  period_end: z.string().min(8).max(20),
  status: z.enum(['draft', 'needs_review', 'approved', 'archived']).optional(),
  strategy_json: z.record(z.unknown()),
});

const internalReviewSchema = z.object({
  agent_slug: z.string(),
  task_id: z.string().optional(),
  post_id: z.string().nullable().optional(),
  blog_id: z.string().nullable().optional(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'blocker', 'critical']),
  notes_json: z.record(z.unknown()),
  disposition: z.enum(['reviewed', 'blocked']).optional(),
  finding_type: z.string().max(80).nullable().optional(),
  source_record_type: z.string().max(80).nullable().optional(),
  source_record_id: z.string().max(80).nullable().optional(),
  recommended_source_fix: z.string().max(2000).nullable().optional(),
});

const internalDraftPostSchema = z.object({
  agent_slug: z.string(),
  task_id: z.string().optional(),
  generation_run_id: z.string().min(32).max(64).nullable().optional(),
  client_id: z.string(),
  title: z.string().min(1).max(200),
  content_type: z.enum(['image', 'reel', 'video', 'blog']),
  platforms: z.array(z.string()).default([]),
  master_caption: z.string().nullable().optional(),
  platform_captions: z.record(z.string()).nullable().optional(),
  blog_content: z.string().nullable().optional(),
  blog_excerpt: z.string().nullable().optional(),
  seo_title: z.string().nullable().optional(),
  meta_description: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  target_keyword: z.string().nullable().optional(),
  target_locality: z.string().nullable().optional(),
  youtube_title: z.string().nullable().optional(),
  youtube_description: z.string().nullable().optional(),
  video_script: z.string().nullable().optional(),
  ai_image_prompt: z.string().nullable().optional(),
  ai_video_prompt: z.string().nullable().optional(),
  skarleth_notes: z.string().nullable().optional(),
  publish_date: z.string().nullable().optional(),
  automation_slot_key: z.string().min(8).max(240).nullable().optional(),
  merge_existing: z.boolean().optional(),
  require_existing_slot: z.boolean().optional(),
  // GMB structured fields (§2) — populated by the GMB Rank agent so posting via
  // upload-post can publish Offers/Updates/Events after the gates pass.
  gbp_topic_type: z.enum(['STANDARD', 'EVENT', 'OFFER']).nullable().optional(),
  gbp_cta_type: z.string().nullable().optional(),
  gbp_cta_url: z.string().nullable().optional(),
  gbp_coupon_code: z.string().nullable().optional(),
  gbp_redeem_url: z.string().nullable().optional(),
  gbp_terms: z.string().nullable().optional(),
  gbp_event_title: z.string().nullable().optional(),
  gbp_event_start_date: z.string().nullable().optional(),
  gbp_event_end_date: z.string().nullable().optional(),
  // Per-location captions for multi-location GBP clients (e.g. Elite Team
  // Builders LA/WA/OR). Keys are caption_field columns; whitelisted on save.
  location_captions: z.record(z.string()).nullable().optional(),
});

// Only these post columns may be set from location_captions — prevents arbitrary
// column names (which updatePost interpolates into SQL) from a payload.
const ALLOWED_LOCATION_CAPTION_FIELDS = new Set(['cap_gbp_la', 'cap_gbp_wa', 'cap_gbp_or', 'cap_google_business']);

function formatAgencyStatusText(overview: Awaited<ReturnType<typeof listAgencyOverview>>, agents: Awaited<ReturnType<typeof listAgentDefinitions>>): string {
  const today = agents
    .filter((agent) => ['running', 'failed', 'waiting'].includes(agent.status))
    .slice(0, 5)
    .map((agent) => `- ${agent.name}: ${agent.status}${agent.current_task ? `, ${agent.current_task}` : ''}`)
    .join('\n') || '- No active agent work right now.';

  return [
    'AI Agency Status',
    '',
    `Active agents: ${overview.active_agents}`,
    `Running tasks: ${overview.running_tasks}`,
    `Waiting for Marvin approval: ${overview.waiting_marvin_approval}`,
    `Waiting for designer assets: ${overview.waiting_designer_assets}`,
    `Failed agent jobs: ${overview.failed_agent_jobs}`,
    '',
    'Today:',
    today,
    '',
    'Next action:',
    overview.waiting_marvin_approval > 0
      ? 'Marvin approval queue needs attention.'
      : overview.waiting_designer_assets > 0
        ? 'Designer asset queue needs attention.'
        : 'Run the Agency Orchestrator to plan the next batch.',
  ].join('\n');
}

async function enqueueInternalAgencyJob(
  db: D1Database,
  agentSlug: string,
  requestedBy: string,
  source: string,
) {
  const commandName = commandForAgent(agentSlug);
  if (!commandName) return null;
  const agents = await listAgentDefinitions(db);
  const agent = agents.find((item) => item.slug === agentSlug);
  if (!agent || agent.enabled !== 1) return null;

  const task = await createAgentTask(db, {
    agent_slug: agentSlug,
    title: `${agent.name} requested from ${source}`,
    input_json: JSON.stringify({ requested_from: source }),
  });
  const job = await createApprovedCommandJob(db, {
    generation_run_id: null,
    command_name: commandName,
    provider: agent.default_backend,
    requested_by: requestedBy,
    args_json: JSON.stringify({
      agent_slug: agentSlug,
      task_id: task.id,
      source,
      backend_priority: backendPriorityForAgent(agentSlug),
      safety: agencySafety(),
    }),
  });
  await updateAgentTask(db, task.id, { approved_job_id: job.id, status: 'queued', progress: 0 });
  await appendAgencyLog(db, {
    agent_slug: agentSlug,
    task_id: task.id,
    job_id: job.id,
    status: 'queued',
    step: 'enqueue',
    summary: `${agent.name} queued as approved command ${commandName}.`,
    backend: agent.default_backend,
  });
  return { agent, task, job, command_name: commandName };
}

agencyInternalRoutes.post('/task-update', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  let runId: string | null = null;
  if (body.status === 'running') {
    const run = await createAgentRun(c.env.DB, {
      agent_slug: body.agent_slug,
      task_id: body.task_id ?? null,
      backend: body.backend ?? 'internal',
      created_by: 'discord-bot',
    });
    runId = run.id;
  }
  if (body.task_id) {
    await updateAgentTask(c.env.DB, body.task_id, {
      status: body.status,
      progress: body.progress,
      output_json: body.output_json ? JSON.stringify(body.output_json) : null,
      error: body.error ? redactSecrets(body.error) : null,
    });
  }
  if ((body.status === 'completed' || body.status === 'failed') && (body.run_id || body.task_id)) {
    const run = body.run_id
      ? { id: body.run_id }
      : (await listAgentRuns(c.env.DB, 5)).find((item) => item.agent_slug === body.agent_slug && item.task_id === (body.task_id ?? null));
    if (run) await updateAgentRun(c.env.DB, run.id, { status: body.status, summary_json: body.output_json ? JSON.stringify(body.output_json) : null, error: body.error ?? null });
  }
  await appendAgencyLog(c.env.DB, {
    agent_slug: body.agent_slug,
    task_id: body.task_id ?? null,
    run_id: runId,
    job_id: body.job_id ?? null,
    status: body.status,
    step: 'runner',
    summary: body.summary ?? `Agent ${body.agent_slug} ${body.status}`,
    error: body.error ?? null,
    backend: body.backend ?? null,
  });
  return c.json({ ok: true, run_id: runId });
});

agencyInternalRoutes.post('/status', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const overview = await listAgencyOverview(c.env.DB);
  const agents = await listAgentDefinitions(c.env.DB);
  return c.json({ ok: true, overview, agents, content: formatAgencyStatusText(overview, agents) });
});

agencyInternalRoutes.post('/enqueue', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let body: { agent_slug?: string; requested_by?: string; source?: string } = {};
  try { body = await c.req.json(); } catch { /* optional */ }
  const queued = await enqueueInternalAgencyJob(
    c.env.DB,
    body.agent_slug ?? '',
    body.requested_by ?? 'discord-bot',
    body.source ?? 'discord',
  );
  if (!queued) return c.json({ error: 'Unknown or disabled agent_slug' }, 400);
  return c.json({
    ok: true,
    content: `Queued ${queued.agent.name} through approved command \`${queued.command_name}\`.\nTask ID: \`${queued.task.id}\`\nJob ID: \`${queued.job.id}\``,
    task_id: queued.task.id,
    approved_job_id: queued.job.id,
    command_name: queued.command_name,
  }, 202);
});

agencyInternalRoutes.post('/snapshot', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const [overview, agents, tasks, findings, coverage, logs, approved_jobs, system_health, backend_health] = await Promise.all([
    listAgencyOverview(c.env.DB),
    listAgentDefinitions(c.env.DB),
    listAgentTasks(c.env.DB, 50),
    listAgentFindings(c.env.DB, 50),
    getAgencyClientCoverage(c.env.DB),
    getAgencyLogs(c.env.DB, 40),
    listApprovedCommandJobs(c.env.DB, 30),
    getAgentSystemHealthSnapshot(c.env.DB, { lookbackHours: 168 }),
    listAgencyBackendHealth(c.env.DB),
  ]);
  return c.json({
    ok: true,
    snapshot: {
      generated_at: new Date().toISOString(),
      overview,
      agents,
      tasks,
      findings,
      coverage,
      logs,
      approved_jobs: approved_jobs
        .filter((job) => job.command_name.startsWith('agency_') || job.command_name.includes('terminal'))
        .map((job) => ({
          id: job.id,
          command_name: job.command_name,
          provider: job.provider,
          status: job.status,
          progress_message: job.progress_message,
          created_at: job.created_at,
          updated_at: job.updated_at,
          error_log: job.error_log ? redactSecrets(job.error_log) : null,
        })),
      system_health,
      backend_health,
    },
  });
});

agencyInternalRoutes.post('/finding', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalFindingSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const finding = await createAgentFinding(c.env.DB, {
    agent_slug: parsed.data.agent_slug,
    task_id: parsed.data.task_id ?? null,
    client_id: parsed.data.client_id ?? null,
    severity: parsed.data.severity,
    title: parsed.data.title,
    finding_json: parsed.data.finding_json ? JSON.stringify(parsed.data.finding_json) : null,
  });
  await appendAgencyLog(c.env.DB, {
    agent_slug: parsed.data.agent_slug,
    task_id: parsed.data.task_id ?? null,
    status: 'finding',
    step: 'finding',
    summary: `${parsed.data.severity.toUpperCase()} finding created: ${parsed.data.title}`,
  });

  // Report findings to Discord per the "milestones + every finding" policy.
  // medium/high/critical get an immediate alert; info/low stay dashboard-only.
  // Only alert for a NEWLY created finding — if createAgentFinding deduped to an
  // already-open one (created earlier), don't re-spam Discord every daily run.
  const isNew = (finding.created_at ?? 0) >= Math.floor(Date.now() / 1000) - 10;
  const SEV_COLOR: Record<string, number> = { low: 0x22c55e, medium: 0xf59e0b, high: 0xef4444, critical: 0xdc2626 };
  const color = isNew ? SEV_COLOR[parsed.data.severity] : undefined;
  if (color) {
    const channelId = c.env.AGENCY_NOTIFY_CHANNEL_ID || c.env.DISCORD_CHANNEL_ID;
    const token = c.env.DISCORD_BOT_TOKEN;
    if (channelId && token) {
      const fj = parsed.data.finding_json as Record<string, unknown> | undefined;
      const desc = fj && typeof fj.description === 'string' ? fj.description : '';
      const action = fj && typeof fj.recommended_action === 'string' ? fj.recommended_action : '';
      await discordSend({
        channelId, token,
        embeds: [{
          title: `${parsed.data.severity.toUpperCase()} · ${parsed.data.title}`.slice(0, 240),
          description: [desc, action ? `**Action:** ${action}` : ''].filter(Boolean).join('\n\n').slice(0, 1800),
          color,
          footer: { text: `Agent: ${parsed.data.agent_slug}` },
          timestamp: new Date().toISOString(),
        }],
      }).catch(() => { /* non-critical */ });
    }
  }
  return c.json({ ok: true, finding });
});

agencyInternalRoutes.post('/research-note', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalResearchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  await saveClientResearch(
    c.env.DB,
    parsed.data.client_id,
    parsed.data.source ?? parsed.data.agent_slug,
    JSON.stringify(parsed.data.research_json),
    parsed.data.freshness_date,
    {
      brand_name: parsed.data.brand_name,
      source_url: parsed.data.source_url,
      source_domain: parsed.data.source_domain,
      source_title: parsed.data.source_title,
      entity_match: parsed.data.entity_match ? 1 : 0,
      geography_match: parsed.data.geography_match ? 1 : 0,
      service_match: parsed.data.service_match ? 1 : 0,
      prohibited_service_detected: parsed.data.prohibited_service_detected ? 1 : 0,
      confidence: parsed.data.confidence,
      review_status: 'pending',
      expires_at: parsed.data.expires_at,
      notes: parsed.data.notes,
    },
  );
  await appendAgencyLog(c.env.DB, {
    agent_slug: parsed.data.agent_slug,
    task_id: parsed.data.task_id ?? null,
    status: 'saved',
    step: 'research-note',
    summary: 'Client research note saved.',
  });
  return c.json({ ok: true });
});

agencyInternalRoutes.post('/strategy-plan', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalStrategySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  await saveClientStrategy(
    c.env.DB,
    parsed.data.client_id,
    parsed.data.period_start,
    parsed.data.period_end,
    JSON.stringify(parsed.data.strategy_json),
    parsed.data.status ?? 'draft',
  );
  await appendAgencyLog(c.env.DB, {
    agent_slug: parsed.data.agent_slug,
    task_id: parsed.data.task_id ?? null,
    status: 'saved',
    step: 'strategy-plan',
    summary: 'Client strategy plan saved as draft.',
  });
  return c.json({ ok: true });
});

// Create/finalize a provenance run for a supervised content batch without
// queueing a second autonomous generator. Both routes remain bot-secret gated.
agencyInternalRoutes.post('/generation-run', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = z.object({
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    triggered_by: z.string().min(1).max(80).default('supervisor-content-qa'),
    client_ids: z.array(z.string().min(1)).max(100).default([]),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const run = await createGenerationRun(c.env.DB, {
    triggered_by: parsed.data.triggered_by,
    date_range: `${parsed.data.period_start}:${parsed.data.period_end}`,
    client_filter: parsed.data.client_ids.length ? JSON.stringify(parsed.data.client_ids) : null,
    overwrite_existing: false,
  });
  return c.json({ ok: true, generation_run_id: run.id, status: run.status }, 201);
});

agencyInternalRoutes.post('/generation-run/:id/finalize', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const run = await getGenerationRunById(c.env.DB, c.req.param('id'));
  if (!run) return c.json({ error: 'Generation run not found' }, 404);
  const parsed = z.object({
    status: z.enum(['completed', 'completed_with_errors', 'failed']),
    posts_created: z.number().int().min(0),
    error_log: z.string().max(8000).nullable().optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  await finalizeGenerationRun(
    c.env.DB,
    run.id,
    parsed.data.status,
    parsed.data.posts_created,
    parsed.data.error_log ?? null,
  );
  return c.json({ ok: true, generation_run_id: run.id, status: parsed.data.status });
});

agencyInternalRoutes.get('/review-queue', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '8'), 1), 25);
  const forceReviewBefore = Math.max(0, Number(c.req.query('force_before') ?? 0) || 0);
  const candidates = await listAgencyReviewQueueCandidates(c.env.DB, 150);
  const items: Array<Record<string, unknown>> = [];
  const clientBriefs = new Map<string, Awaited<ReturnType<typeof getAgencyClientContentBrief>>>();
  const clientRecentTopics = new Map<string, Awaited<ReturnType<typeof getClientGenerationTopicHistory>>>();
  for (const post of candidates) {
    const contentHash = await buildPostContentHash(post);
    const hasCurrentReview = post.latest_review_hash === contentHash;
    const reviewIsNewEnough = (post.latest_review_created_at ?? 0) >= forceReviewBefore;
    if (hasCurrentReview && (forceReviewBefore === 0 || reviewIsNewEnough)) continue;
    let clientBrief = clientBriefs.get(post.client_id);
    if (!clientBrief) {
      clientBrief = await getAgencyClientContentBrief(c.env.DB, post.client_id, { includeRecentTopics: false });
      clientBriefs.set(post.client_id, clientBrief);
    }
    let recentTopics = clientRecentTopics.get(post.client_id);
    if (!recentTopics) {
      recentTopics = await getClientGenerationTopicHistory(c.env.DB, post.client_id, 60);
      clientRecentTopics.set(post.client_id, recentTopics);
    }
    items.push({
      id: post.id,
      client_slug: post.client_slug,
      client_name: post.client_name,
      content_brief: clientBrief.brief,
      recent_topics: recentTopics.filter((topic) => topic.id !== post.id).slice(0, 24),
      package: post.package,
      package_violation: post.package_violation,
      content_type: post.content_type,
      title: post.title,
      platforms: post.platforms,
      publish_date: post.publish_date,
      status: post.status,
      target_keyword: post.target_keyword,
      target_locality: post.target_locality,
      blog_excerpt: post.blog_excerpt,
      master_caption: post.master_caption,
      cap_facebook: post.cap_facebook,
      cap_instagram: post.cap_instagram,
      cap_google_business: post.cap_google_business,
      cap_linkedin: post.cap_linkedin,
      cap_x: post.cap_x,
      cap_threads: post.cap_threads,
      cap_tiktok: post.cap_tiktok,
      cap_pinterest: post.cap_pinterest,
      cap_bluesky: post.cap_bluesky,
      caption_lengths: {
        x: post.cap_x?.length ?? 0,
        threads: post.cap_threads?.length ?? 0,
        tiktok: post.cap_tiktok?.length ?? 0,
        pinterest: post.cap_pinterest?.length ?? 0,
        bluesky: post.cap_bluesky?.length ?? 0,
      },
      youtube_title: post.youtube_title,
      youtube_description: post.youtube_description,
      video_script: post.video_script,
      ai_image_prompt: post.ai_image_prompt,
      ai_video_prompt: post.ai_video_prompt,
      blog_content: post.blog_content?.slice(0, 40000) ?? null,
      content_hash: contentHash,
      post_updated_at: post.updated_at,
    });
    if (items.length >= limit) break;
  }
  return c.json({ items });
});

agencyInternalRoutes.get('/editorial-gate/:clientId', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const clientId = c.req.param('clientId');
  const [gate, platforms, research, keywords] = await Promise.all([
    evaluateLocksmithGenerationGate(c.env.DB, clientId, month),
    c.env.DB.prepare(`SELECT id, platform, username, profile_url, connection_status,
                             verification_status, verified_business_name, verified_phone,
                             verified_market, verified_at, verification_notes, paused, paused_reason
                      FROM client_platforms WHERE client_id = ? ORDER BY platform`)
      .bind(clientId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT id, source, freshness_date, brand_name, source_url, source_domain,
                             source_title, entity_match, geography_match, service_match,
                             prohibited_service_detected, confidence, review_status, expires_at,
                             notes, research_json, created_at, updated_at
                      FROM client_research_notes WHERE client_id = ? ORDER BY created_at DESC LIMIT 20`)
      .bind(clientId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT id, keyword, kw_type, search_intent, locality, source, confidence,
                             status, approval_status, approved_by, approved_at
                      FROM client_keywords WHERE client_id = ? ORDER BY keyword`)
      .bind(clientId).all<Record<string, unknown>>(),
  ]);
  return c.json({
    ...gate,
    diagnostics: {
      platforms: platforms.results,
      research: research.results,
      keywords: keywords.results,
    },
  });
});

// Exact-date QA export for the supervising content reviewer. This route is
// intentionally read-only and bot-secret protected; it exposes the stored
// content and readiness evidence needed to audit a batch without relying on a
// paginated dashboard queue.
agencyInternalRoutes.get('/content-batch', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const date = c.req.query('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  const posts = await c.env.DB.prepare(`
    SELECT p.*, c.slug AS client_slug, c.canonical_name AS client_name,
           c.phone AS client_phone, c.cta_text AS client_cta,
           c.upload_post_profile
    FROM posts p
    JOIN clients c ON c.id = p.client_id
    WHERE substr(COALESCE(p.publish_date, ''), 1, 10) = ?
      AND COALESCE(p.status, '') != 'cancelled'
    ORDER BY c.canonical_name, p.publish_date, p.content_type, p.created_at
  `).bind(date).all<Record<string, unknown>>();

  const items = [];
  for (const post of posts.results) {
    const postId = String(post.id ?? '');
    const [platforms, assets, reviews] = await Promise.all([
      c.env.DB.prepare(`SELECT platform, status, error_message, attempted_at, idempotency_key,
                               attempt_count, published_at, real_url
                        FROM post_platforms WHERE post_id = ? ORDER BY platform`)
        .bind(postId).all<Record<string, unknown>>(),
      c.env.DB.prepare(`SELECT id, r2_key, r2_bucket, filename, content_type, size_bytes,
                               source, sort_order, created_at
                        FROM assets WHERE post_id = ? ORDER BY sort_order, created_at`)
        .bind(postId).all<Record<string, unknown>>(),
      c.env.DB.prepare(`SELECT id, severity, notes_json, disposition, finding_type,
                               source_record_type, source_record_id, recommended_source_fix,
                               review_status, reviewed_by, created_at, resolved_at
                        FROM content_review_notes WHERE post_id = ? OR blog_id = ?
                        ORDER BY created_at DESC`)
        .bind(postId, postId).all<Record<string, unknown>>(),
    ]);
    items.push({ ...post, platform_rows: platforms.results, assets: assets.results, reviews: reviews.results });
  }
  return c.json({ ok: true, date, count: items.length, items });
});

agencyInternalRoutes.post('/research-review/:id', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = z.object({
    review_status: z.enum(['approved', 'rejected', 'quarantined']),
    reviewed_by: z.string().min(1).max(100),
    reason: z.string().min(1).max(1000),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const note = await c.env.DB.prepare(`SELECT id, client_id, entity_match, geography_match,
                                             service_match, prohibited_service_detected, confidence,
                                             review_status
                                      FROM client_research_notes WHERE id = ?`)
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!note) return c.json({ error: 'Research note not found' }, 404);
  if (note.review_status !== 'pending') return c.json({ error: 'Only pending research can be reviewed' }, 409);
  if (parsed.data.review_status === 'approved') {
    const safe = note.entity_match === 1 && note.geography_match === 1 && note.service_match === 1
      && note.prohibited_service_detected === 0 && note.confidence === 'high';
    if (!safe) return c.json({ error: 'Research does not meet the approval evidence requirements' }, 409);
  }
  await c.env.DB.prepare(`UPDATE client_research_notes
                          SET review_status = ?, reviewed_by = ?, reviewed_at = unixepoch(),
                              notes = trim(COALESCE(notes, '') || '\n' || ?), updated_at = unixepoch()
                          WHERE id = ? AND review_status = 'pending'`)
    .bind(parsed.data.review_status, parsed.data.reviewed_by, parsed.data.reason, c.req.param('id')).run();
  await appendAgencyLog(c.env.DB, {
    agent_slug: 'supervisor-content-qa',
    status: 'saved',
    step: 'research-review',
    summary: `Research ${c.req.param('id')} marked ${parsed.data.review_status}: ${parsed.data.reason}`,
  });
  return c.json({ ok: true, id: c.req.param('id'), review_status: parsed.data.review_status });
});

agencyInternalRoutes.post('/keywords/approve', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = z.object({
    client_id: z.string().min(1),
    keywords: z.array(z.string().min(1).max(160)).min(1).max(20),
    approved_by: z.string().min(1).max(100),
    reason: z.string().min(1).max(1000),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const client = await getClientById(c.env.DB, parsed.data.client_id);
  if (!client || !isGovernedLocksmith(client)) return c.json({ error: 'Governed locksmith client not found' }, 404);
  const keywords = [...new Set(parsed.data.keywords.map((keyword) => keyword.trim()).filter(Boolean))];
  const prohibited = keywords.map((keyword) => ({ keyword, issue: findProhibitedLocksmithService(keyword) }))
    .filter((row) => row.issue);
  if (prohibited.length > 0) return c.json({ error: 'Prohibited locksmith keyword', prohibited }, 409);
  const placeholders = keywords.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(`SELECT id, keyword, status FROM client_keywords
                                       WHERE client_id = ? AND keyword IN (${placeholders})`)
    .bind(client.id, ...keywords).all<{ id: string; keyword: string; status: string }>();
  const found = new Map(rows.results.map((row) => [row.keyword, row]));
  const missing = keywords.filter((keyword) => !found.has(keyword));
  if (missing.length > 0) return c.json({ error: 'Keywords must be created and classified before approval', missing }, 409);
  const inactive = rows.results.filter((row) => row.status !== 'active').map((row) => row.keyword);
  if (inactive.length > 0) return c.json({ error: 'Only active classified keywords can be approved', inactive }, 409);
  await c.env.DB.prepare(`UPDATE client_keywords
                          SET approval_status = 'approved', approved_by = ?, approved_at = unixepoch(),
                              editorial_notes = ?, updated_at = unixepoch()
                          WHERE client_id = ? AND keyword IN (${placeholders}) AND status = 'active'`)
    .bind(parsed.data.approved_by, parsed.data.reason, client.id, ...keywords).run();
  await appendAgencyLog(c.env.DB, {
    agent_slug: 'supervisor-content-qa', status: 'saved', step: 'keyword-approval',
    summary: `Approved ${keywords.length} evidence-backed keywords for ${client.slug}.`,
  });
  return c.json({ ok: true, approved: keywords.length, keywords });
});

agencyInternalRoutes.post('/draft-post/:id/revise', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalDraftPostSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const existing = await getPostById(c.env.DB, c.req.param('id'));
  if (!existing) return c.json({ error: 'Post not found' }, 404);
  if (!['draft', 'pending_approval'].includes(existing.status ?? '')) return c.json({ error: 'Only draft or pending-review posts can be revised' }, 409);
  if (existing.client_id !== parsed.data.client_id || existing.content_type !== parsed.data.content_type) {
    return c.json({ error: 'Client and content type cannot change during revision' }, 409);
  }
  if (parsed.data.publish_date?.slice(0, 10) !== existing.publish_date?.slice(0, 10)
      || parsed.data.automation_slot_key !== existing.automation_slot_key) {
    return c.json({ error: 'Publish day and automation slot cannot change during revision' }, 409);
  }
  const client = await getClientById(c.env.DB, existing.client_id);
  if (!client) return c.json({ error: 'Client not found' }, 404);
  if (isGovernedLocksmith(client)) {
    await assertLocksmithContentReady(
      c.env.DB, client, existing.publish_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10), parsed.data.platforms,
    );
  }
  const captions = parsed.data.platform_captions ?? {};
  const updates: Partial<typeof existing> = {
    title: parsed.data.title,
    status: 'draft',
    automation_status: null,
    platforms: JSON.stringify(parsed.data.platforms),
    master_caption: parsed.data.master_caption ?? null,
    cap_facebook: captions.facebook ?? null,
    cap_instagram: captions.instagram ?? null,
    cap_linkedin: captions.linkedin ?? null,
    cap_x: captions.x ?? null,
    cap_threads: captions.threads ?? null,
    cap_tiktok: captions.tiktok ?? null,
    cap_pinterest: captions.pinterest ?? null,
    cap_bluesky: captions.bluesky ?? null,
    cap_google_business: captions.google_business ?? null,
    blog_content: parsed.data.blog_content ?? null,
    blog_excerpt: parsed.data.blog_excerpt ?? null,
    seo_title: parsed.data.seo_title ?? null,
    meta_description: parsed.data.meta_description ?? null,
    slug: parsed.data.slug ?? null,
    target_keyword: parsed.data.target_keyword ?? null,
    target_locality: parsed.data.target_locality ?? null,
    youtube_title: parsed.data.youtube_title ?? null,
    youtube_description: parsed.data.youtube_description ?? null,
    video_script: parsed.data.video_script ?? null,
    ai_image_prompt: parsed.data.ai_image_prompt ?? null,
    ai_video_prompt: parsed.data.ai_video_prompt ?? null,
    skarleth_notes: parsed.data.skarleth_notes ?? null,
    ready_for_automation: 0,
    asset_delivered: 0,
    asset_rights_confirmed: 0,
    generation_run_id: parsed.data.generation_run_id ?? existing.generation_run_id,
    created_by: parsed.data.agent_slug,
    topic_fingerprint: buildTopicFingerprint({
      title: parsed.data.title, contentType: parsed.data.content_type, targetKeyword: parsed.data.target_keyword ?? null,
    }),
  };
  const governanceIssues = await validateLocksmithGeneratedContent(c.env.DB, client, updates);
  if (governanceIssues.length > 0) return c.json({ error: `Editorial gate failed: ${governanceIssues.join('; ')}` }, 409);
  const duplicateConflict = await findRecentTopicConflict(c.env.DB, {
    clientId: existing.client_id,
    candidateTitle: parsed.data.title,
    candidateKeyword: parsed.data.target_keyword ?? null,
    candidateCaption: parsed.data.master_caption ?? null,
    candidateLocality: parsed.data.target_locality ?? null,
    contentType: parsed.data.content_type,
    topicFingerprint: updates.topic_fingerprint ?? null,
    publishDate: existing.publish_date,
    excludePostId: existing.id,
  });
  if (duplicateConflict) return c.json({
    error: `Duplicate content blocked: ${duplicateConflict.reason}`,
    code: 'DUPLICATE_CONTENT', nearest_post_id: duplicateConflict.post.id,
  }, 409);
  await updatePost(c.env.DB, existing.id, updates);
  await appendAgencyLog(c.env.DB, {
    agent_slug: parsed.data.agent_slug, task_id: parsed.data.task_id ?? null,
    status: 'saved', step: 'draft-revision', summary: `Revised draft ${existing.id}; approval and asset gates reset.`,
  });
  return c.json({ ok: true, post_id: existing.id, revised: true });
});

agencyInternalRoutes.post('/content-review', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalReviewSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const post = parsed.data.post_id ? await getPostById(c.env.DB, parsed.data.post_id) : null;
  if (parsed.data.post_id && !post) return c.json({ error: 'Post not found' }, 404);
  const contentHash = post ? await buildPostContentHash(post) : null;
  const disposition = parsed.data.disposition
    ?? (['high', 'blocker', 'critical'].includes(parsed.data.severity) ? 'blocked' : 'reviewed');
  const normalizedNotes = normalizeContentReviewFindings({ ...parsed.data.notes_json });
  if (Array.isArray(normalizedNotes.findings)) {
    normalizedNotes.findings = normalizedNotes.findings.map((finding) => {
      if (!finding || typeof finding !== 'object') return finding;
      return {
        ...finding,
        brand_id: post?.client_id ?? null,
        content_id: post?.id ?? null,
        review_status: 'pending',
        reviewed_by: null,
        resolved_at: null,
      };
    });
  }
  await saveContentReview(c.env.DB, {
    post_id: parsed.data.post_id ?? null,
    blog_id: parsed.data.blog_id ?? null,
    agent_task_id: parsed.data.task_id ?? null,
    severity: parsed.data.severity,
    notes_json: JSON.stringify(normalizedNotes),
    post_updated_at: post?.updated_at ?? null,
    content_hash: contentHash,
    disposition,
    client_id: post?.client_id ?? null,
    finding_type: parsed.data.finding_type === 'clean_pass' ? null : parsed.data.finding_type ?? null,
    source_record_type: parsed.data.source_record_type ?? null,
    source_record_id: parsed.data.source_record_id ?? null,
    recommended_source_fix: parsed.data.recommended_source_fix ?? null,
    review_status: 'pending',
  });
  if (post && disposition === 'blocked' && ['approved', 'ready', 'scheduled'].includes(post.status ?? '')) {
    await updatePost(c.env.DB, post.id, { status: 'pending_approval', ready_for_automation: 0 });
  }
  await appendAgencyLog(c.env.DB, {
    agent_slug: parsed.data.agent_slug,
    task_id: parsed.data.task_id ?? null,
    status: 'saved',
    step: 'content-review',
    summary: `${parsed.data.severity.toUpperCase()} content review note saved${post && disposition === 'blocked' ? '; automation approval blocked' : ''}.`,
  });
  return c.json({ ok: true });
});

agencyInternalRoutes.post('/draft-post', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalDraftPostSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const client = await getClientById(c.env.DB, parsed.data.client_id);
  if (!client) return c.json({ error: 'Client not found' }, 404);
  if (isGovernedLocksmith(client)) {
    const publishDay = parsed.data.publish_date?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    try {
      await assertLocksmithContentReady(c.env.DB, client, publishDay, parsed.data.platforms);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  }

  let existing = null;
  if (parsed.data.publish_date) {
    const datePrefix = parsed.data.publish_date.slice(0, 10);
    existing = await getPostByAutomationSlot(
      c.env.DB,
      parsed.data.client_id,
      parsed.data.automation_slot_key ?? '',
      datePrefix,
      parsed.data.content_type,
    );
    if (existing && !parsed.data.merge_existing) {
      await appendAgencyLog(c.env.DB, {
        agent_slug: parsed.data.agent_slug,
        task_id: parsed.data.task_id ?? null,
        status: 'skipped',
        step: 'draft-post',
        summary: `Draft skipped (slot already filled): ${parsed.data.content_type} on ${datePrefix} for client ${parsed.data.client_id}`,
      });
      return c.json({ ok: true, post_id: existing.id, skipped: true });
    }
  }

  const captions = parsed.data.platform_captions ?? {};

  // Empty-content guard: never persist a contentless draft. A blog needs body
  // text; any other content type needs a master caption or at least one platform
  // caption. This is what stops "generated posts with no content" from appearing.
  const isBlog = parsed.data.content_type === 'blog';
  const hasCaption = Boolean(
    (parsed.data.master_caption ?? '').trim() ||
    Object.values(captions).some((v) => typeof v === 'string' && v.trim()),
  );
  const hasContent = isBlog ? Boolean((parsed.data.blog_content ?? '').trim()) : hasCaption;
  if (!hasContent) {
    await appendAgencyLog(c.env.DB, {
      agent_slug: parsed.data.agent_slug,
      task_id: parsed.data.task_id ?? null,
      status: 'skipped',
      step: 'draft-post',
      summary: `Draft skipped (empty content): ${parsed.data.content_type} for client ${parsed.data.client_id}`,
    });
    return c.json({ ok: true, skipped: true, reason: 'empty_content' });
  }
  if (parsed.data.require_existing_slot && !existing) {
    return c.json({ ok: true, skipped: true, reason: 'package_slot_not_generated' });
  }

  const postData = {
    client_id: parsed.data.client_id,
    title: parsed.data.title,
    status: 'draft',
    content_type: parsed.data.content_type,
    platforms: JSON.stringify(parsed.data.platforms),
    master_caption: parsed.data.master_caption ?? null,
    cap_facebook: captions.facebook ?? null,
    cap_instagram: captions.instagram ?? null,
    cap_linkedin: captions.linkedin ?? null,
    cap_x: captions.x ?? null,
    cap_threads: captions.threads ?? null,
    cap_tiktok: captions.tiktok ?? null,
    cap_pinterest: captions.pinterest ?? null,
    cap_bluesky: captions.bluesky ?? null,
    cap_google_business: captions.google_business ?? null,
    blog_content: parsed.data.blog_content ?? null,
    blog_excerpt: parsed.data.blog_excerpt ?? null,
    seo_title: parsed.data.seo_title ?? null,
    meta_description: parsed.data.meta_description ?? null,
    slug: parsed.data.slug ?? null,
    target_keyword: parsed.data.target_keyword ?? null,
    target_locality: parsed.data.target_locality ?? null,
    youtube_title: parsed.data.youtube_title ?? null,
    youtube_description: parsed.data.youtube_description ?? null,
    video_script: parsed.data.video_script ?? null,
    ai_image_prompt: parsed.data.ai_image_prompt ?? null,
    ai_video_prompt: parsed.data.ai_video_prompt ?? null,
    skarleth_notes: parsed.data.skarleth_notes ?? null,
    publish_date: parsed.data.publish_date ?? null,
    ready_for_automation: 0,
    asset_delivered: 0,
    scheduled_by_automation: 1,
    automation_slot_key: parsed.data.automation_slot_key ?? null,
    generation_run_id: parsed.data.generation_run_id ?? null,
    created_by: parsed.data.agent_slug,
    topic_fingerprint: buildTopicFingerprint({
      title: parsed.data.title,
      contentType: parsed.data.content_type,
      targetKeyword: parsed.data.target_keyword ?? null,
    }),
  };
  const governanceIssues = await validateLocksmithGeneratedContent(c.env.DB, client, postData);
  if (governanceIssues.length > 0) {
    return c.json({ error: `Editorial gate failed: ${governanceIssues.join('; ')}` }, 409);
  }
  let duplicateConflict;
  try {
    duplicateConflict = await findRecentTopicConflict(c.env.DB, {
      clientId: client.id,
      candidateTitle: postData.title,
      candidateKeyword: postData.target_keyword,
      candidateCaption: postData.master_caption,
      candidateLocality: postData.target_locality,
      contentType: postData.content_type,
      topicFingerprint: postData.topic_fingerprint,
      publishDate: postData.publish_date,
      excludePostId: existing?.id ?? null,
    });
  } catch (error) {
    const detail = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 600);
    await appendAgencyLog(c.env.DB, {
      agent_slug: parsed.data.agent_slug,
      task_id: parsed.data.task_id ?? null,
      status: 'error',
      step: 'duplicate-validation',
      summary: `Duplicate validation failed before draft persistence: ${detail}`,
    }).catch(() => undefined);
    return c.json({ error: 'Duplicate validation failed', code: 'DUPLICATE_VALIDATION_ERROR', detail }, 500);
  }
  if (duplicateConflict) {
    await appendAgencyLog(c.env.DB, {
      agent_slug: parsed.data.agent_slug,
      task_id: parsed.data.task_id ?? null,
      status: 'skipped',
      step: 'draft-post',
      summary: `Draft blocked as duplicate of ${duplicateConflict.post.id}: ${duplicateConflict.reason}`,
    });
    return c.json({
      error: `Duplicate content blocked: ${duplicateConflict.reason}`,
      code: 'DUPLICATE_CONTENT',
      nearest_post_id: duplicateConflict.post.id,
      nearest_client_id: duplicateConflict.post.client_id,
      reason: duplicateConflict.reason,
    }, 409);
  }

  if (existing && parsed.data.merge_existing) {
    let existingPlatforms: string[] = [];
    try { existingPlatforms = JSON.parse(existing.platforms ?? '[]') as string[]; } catch { existingPlatforms = []; }
    const mergedPlatforms = [...new Set([...existingPlatforms, ...parsed.data.platforms])];
    const mergeUpdates: Record<string, unknown> = {
      platforms: JSON.stringify(mergedPlatforms),
      cap_google_business: captions.google_business ?? existing.cap_google_business,
      target_keyword: existing.target_keyword ?? parsed.data.target_keyword ?? null,
      target_locality: existing.target_locality ?? parsed.data.target_locality ?? null,
      automation_slot_key: existing.automation_slot_key ?? parsed.data.automation_slot_key ?? null,
      generation_run_id: existing.generation_run_id ?? parsed.data.generation_run_id ?? null,
      created_by: existing.created_by ?? parsed.data.agent_slug,
      topic_fingerprint: existing.topic_fingerprint ?? postData.topic_fingerprint,
    };
    if (existing.status === 'approved' || existing.status === 'ready' || existing.status === 'scheduled') {
      mergeUpdates.status = 'pending_approval';
      mergeUpdates.ready_for_automation = 0;
    }
    const structuredUpdates: Record<string, string | null> = {};
    if (parsed.data.gbp_topic_type) structuredUpdates.gbp_topic_type = parsed.data.gbp_topic_type;
    if (parsed.data.gbp_cta_type) structuredUpdates.gbp_cta_type = parsed.data.gbp_cta_type;
    if (parsed.data.gbp_cta_url) structuredUpdates.gbp_cta_url = parsed.data.gbp_cta_url;
    if (parsed.data.gbp_coupon_code) structuredUpdates.gbp_coupon_code = parsed.data.gbp_coupon_code;
    if (parsed.data.gbp_redeem_url) structuredUpdates.gbp_redeem_url = parsed.data.gbp_redeem_url;
    if (parsed.data.gbp_terms) structuredUpdates.gbp_terms = parsed.data.gbp_terms;
    if (parsed.data.gbp_event_title) structuredUpdates.gbp_event_title = parsed.data.gbp_event_title;
    if (parsed.data.gbp_event_start_date) structuredUpdates.gbp_event_start_date = parsed.data.gbp_event_start_date;
    if (parsed.data.gbp_event_end_date) structuredUpdates.gbp_event_end_date = parsed.data.gbp_event_end_date;
    if (parsed.data.location_captions) {
      for (const [field, value] of Object.entries(parsed.data.location_captions)) {
        if (ALLOWED_LOCATION_CAPTION_FIELDS.has(field) && value.trim()) structuredUpdates[field] = value;
      }
    }
    await updatePost(c.env.DB, existing.id, { ...mergeUpdates, ...structuredUpdates });
    await appendAgencyLog(c.env.DB, {
      agent_slug: parsed.data.agent_slug,
      task_id: parsed.data.task_id ?? null,
      status: 'saved',
      step: 'draft-post',
      summary: `Merged ${parsed.data.content_type} channel content into package slot ${parsed.data.automation_slot_key ?? existing.id}.`,
    });
    return c.json({ ok: true, post_id: existing.id, merged: true });
  }

  let post;
  try {
    post = await createPost(c.env.DB, postData);
  } catch (error) {
    const detail = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 600);
    await appendAgencyLog(c.env.DB, {
      agent_slug: parsed.data.agent_slug,
      task_id: parsed.data.task_id ?? null,
      status: 'error',
      step: 'draft-persistence',
      summary: `Draft persistence failed: ${detail}`,
    }).catch(() => undefined);
    return c.json({ error: 'Draft persistence failed', code: 'DRAFT_PERSISTENCE_ERROR', detail }, 500);
  }

  // GMB structured fields + per-location captions are set via updatePost (keeps
  // createPost's column list untouched). Never changes gates: status stays draft,
  // ready_for_automation/asset_delivered remain 0.
  const gbpUpdates: Record<string, string | null> = {};
  if (parsed.data.gbp_topic_type) gbpUpdates.gbp_topic_type = parsed.data.gbp_topic_type;
  if (parsed.data.gbp_cta_type) gbpUpdates.gbp_cta_type = parsed.data.gbp_cta_type;
  if (parsed.data.gbp_cta_url) gbpUpdates.gbp_cta_url = parsed.data.gbp_cta_url;
  if (parsed.data.gbp_coupon_code) gbpUpdates.gbp_coupon_code = parsed.data.gbp_coupon_code;
  if (parsed.data.gbp_redeem_url) gbpUpdates.gbp_redeem_url = parsed.data.gbp_redeem_url;
  if (parsed.data.gbp_terms) gbpUpdates.gbp_terms = parsed.data.gbp_terms;
  if (parsed.data.gbp_event_title) gbpUpdates.gbp_event_title = parsed.data.gbp_event_title;
  if (parsed.data.gbp_event_start_date) gbpUpdates.gbp_event_start_date = parsed.data.gbp_event_start_date;
  if (parsed.data.gbp_event_end_date) gbpUpdates.gbp_event_end_date = parsed.data.gbp_event_end_date;
  if (parsed.data.location_captions) {
    for (const [field, text] of Object.entries(parsed.data.location_captions)) {
      if (ALLOWED_LOCATION_CAPTION_FIELDS.has(field) && typeof text === 'string' && text.trim()) {
        gbpUpdates[field] = text;
      }
    }
  }
  if (Object.keys(gbpUpdates).length > 0) {
    await updatePost(c.env.DB, post.id, gbpUpdates as Partial<typeof post>);
  }
  await updatePost(c.env.DB, post.id, { topic_fingerprint: postData.topic_fingerprint });

  await appendAgencyLog(c.env.DB, {
    agent_slug: parsed.data.agent_slug,
    task_id: parsed.data.task_id ?? null,
    status: 'saved',
    step: 'draft-post',
    summary: `Draft ${post.content_type} post created for review: ${post.title}`,
  });
  return c.json({ ok: true, post_id: post.id });
});

agencyInternalRoutes.get('/backend-health', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ backends: await listAgencyBackendHealth(c.env.DB), now: Math.floor(Date.now() / 1000) });
});

agencyInternalRoutes.post('/backend-health', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = z.object({
    backend: z.string().min(1).max(40),
    status: z.enum(['completed', 'failed']),
    error: z.string().nullable().optional(),
    cooldown_seconds: z.number().int().min(60).max(86400).optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  await recordAgencyBackendHealth(c.env.DB, {
    backend: parsed.data.backend,
    status: parsed.data.status,
    error: parsed.data.error,
    cooldownSeconds: parsed.data.cooldown_seconds,
  });
  return c.json({ ok: true });
});

agencyInternalRoutes.get('/client-brief/:clientId', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const brief = await getAgencyClientContentBrief(c.env.DB, c.req.param('clientId'));
  return c.json(brief);
});

agencyInternalRoutes.get('/ai-config', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let openaiKey = '';
  let openaiModel = 'gpt-4o-mini';
  let provider = 'openai';
  try {
    const raw = await c.env.KV_BINDING.get('settings:system');
    const s: Record<string, string> = raw ? JSON.parse(raw) as Record<string, string> : {};
    provider = s['ai_provider'] || 'openai';
    // Use provider-specific key first, fall back to shared ai_api_key
    openaiKey =
      s['ai_openai_api_key'] ||
      (provider === 'openai' ? s['ai_api_key'] || '' : '') ||
      '';
    openaiModel =
      s['ai_openai_model'] ||
      (provider === 'openai' ? s['ai_model'] || 'gpt-4o-mini' : 'gpt-4o-mini');
  } catch { /* ignore */ }
  return c.json({ ok: true, openai_api_key: openaiKey, openai_model: openaiModel, ai_provider: provider });
});

agencyInternalRoutes.get('/blog-template/:client_id', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const clientId = c.req.param('client_id');
  try {
    const client = await c.env.DB.prepare('SELECT slug, canonical_name, industry, state, wp_template_key, brand_json, cta_text FROM clients WHERE id = ?').bind(clientId).first<Pick<ClientRow, 'slug' | 'canonical_name' | 'industry' | 'state' | 'wp_template_key' | 'brand_json' | 'cta_text'> & { brand_primary_color?: string | null }>();
    if (!client) return c.json({ error: 'Client not found' }, 404);
    const template = resolveBlogTemplateConfig(client);
    return c.json({ ok: true, template });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Template resolution failed' }, 500);
  }
});

const VALID_HEARTBEAT_STATUSES = new Set([
  'healthy', 'idle', 'running', 'waiting_for_approval', 'waiting_for_designer',
  'warning', 'stale', 'failed', 'paused',
]);

const internalHeartbeatSchema = z.object({
  agent_slug: z.string().min(1),
  status: z.string().refine((s) => VALID_HEARTBEAT_STATUSES.has(s), { message: 'Invalid heartbeat status' }),
  message: z.string().max(500).nullable().optional(),
  error: z.string().max(2000).nullable().optional(),
  task_id: z.string().optional(),
});

agencyInternalRoutes.post('/heartbeat', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalHeartbeatSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const { agent_slug, status, message, error, task_id } = parsed.data;
  const safeError = error ? redactSecrets(error) : null;
  await updateAgentHeartbeat(c.env.DB, agent_slug, status, message ?? null, safeError);
  await appendAgencyLog(c.env.DB, {
    agent_slug,
    task_id: task_id ?? null,
    status: 'heartbeat',
    step: 'heartbeat',
    summary: `Heartbeat ${status}${message ? ` — ${message}` : ''}`,
    error: safeError,
  });
  return c.json({ ok: true });
});

agencyInternalRoutes.post('/stale-check', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const staleAgents = await checkStaleAgents(c.env.DB);
  const marked: string[] = [];
  for (const agent of staleAgents) {
    const msg = `Missed heartbeat window (${agent.stale_after_minutes}m)`;
    await markAgentStale(c.env.DB, agent.slug, msg);
    await createAgentFinding(c.env.DB, {
      agent_slug: agent.slug,
      task_id: null,
      client_id: null,
      severity: 'medium',
      title: `${agent.name} is stale`,
      finding_json: JSON.stringify({
        last_heartbeat_at: agent.last_heartbeat_at,
        stale_after_minutes: agent.stale_after_minutes,
        previous_status: agent.heartbeat_status,
      }),
    });
    await appendAgencyLog(c.env.DB, {
      agent_slug: agent.slug,
      task_id: null,
      status: 'stale',
      step: 'stale_check',
      summary: `${agent.name} marked stale — ${msg}`,
    });
    marked.push(agent.slug);
  }
  const [agents, summary] = await Promise.all([
    listAgentDefinitions(c.env.DB),
    getAgentHealthSummary(c.env.DB),
  ]);
  const staleCount = summary['stale'] ?? 0;
  const failedCount = summary['failed'] ?? 0;
  const content = staleCount === 0 && failedCount === 0
    ? 'All agents healthy — no stale or failed heartbeats.'
    : `⚠️ Agent health alert\nStale: ${staleCount} | Failed: ${failedCount}\n${marked.map((s) => `• ${s} — stale`).join('\n')}`;
  return c.json({ ok: true, marked, stale_count: staleCount, failed_count: failedCount, content, agents, summary });
});

agencyInternalRoutes.post('/ping', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let body: { agent_slug?: string } = {};
  try { body = await c.req.json(); } catch { /* optional */ }
  const slug = body.agent_slug ?? '';
  const agents = await listAgentDefinitions(c.env.DB);
  const agent = agents.find((a) => a.slug === slug);
  if (!agent) return c.json({ error: 'Unknown agent_slug' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const nextHb = agent.next_expected_heartbeat_at;
  const sinceHb = agent.last_heartbeat_at ? now - agent.last_heartbeat_at : null;
  return c.json({
    ok: true,
    content: [
      `**${agent.name}** — \`${agent.slug}\``,
      `Heartbeat: **${agent.heartbeat_status}**`,
      agent.heartbeat_message ? `Message: ${agent.heartbeat_message}` : null,
      sinceHb !== null ? `Last heartbeat: ${Math.floor(sinceHb / 60)}m ago` : 'Last heartbeat: never',
      nextHb ? `Next expected: <t:${nextHb}:R>` : 'Next expected: —',
      agent.last_error ? `Last error: ${redactSecrets(agent.last_error).slice(0, 200)}` : null,
    ].filter(Boolean).join('\n'),
    agent: {
      slug: agent.slug,
      name: agent.name,
      heartbeat_status: agent.heartbeat_status,
      heartbeat_message: agent.heartbeat_message,
      last_heartbeat_at: agent.last_heartbeat_at,
      next_expected_heartbeat_at: agent.next_expected_heartbeat_at,
      last_error: agent.last_error ? redactSecrets(agent.last_error) : null,
      stale_after_minutes: agent.stale_after_minutes,
    },
  });
});

// §2: agent-proposed GBP Offer — saved INACTIVE for Marvin to review + activate.
agencyInternalRoutes.post('/gbp-offer', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const b = await c.req.json().catch(() => ({})) as Record<string, string | null>;
  if (!b.client_id || !b.title) return c.json({ error: 'client_id and title required' }, 400);
  const generationBlock = await governedAgencyContentBlock(c.env.DB, b.client_id, b.valid_until);
  if (generationBlock) return c.json({ error: generationBlock }, 409);
  // Don't pile up: skip if the client already has a pending (inactive) offer
  // awaiting Marvin's review/activation.
  const pending = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM client_offers WHERE client_id = ? AND active = 0').bind(b.client_id).first<{ n: number }>();
  if ((pending?.n ?? 0) > 0) return c.json({ ok: true, skipped: true, reason: 'pending_offer_exists' });
  const id = await createClientOfferDraft(c.env.DB, {
    client_id: String(b.client_id), title: String(b.title),
    description: b.description ?? null, cta_text: b.cta_text ?? null,
    gbp_cta_type: (b.gbp_cta_type && b.gbp_cta_type !== 'NONE') ? b.gbp_cta_type : null,
    gbp_cta_url: b.gbp_cta_url ?? null, gbp_coupon_code: b.gbp_coupon_code ?? null,
    gbp_redeem_url: b.gbp_redeem_url ?? null, gbp_terms: b.gbp_terms ?? null,
    valid_until: b.valid_until ?? null, gbp_location_id: b.gbp_location_id ?? null,
    ai_image_prompt: b.ai_image_prompt ?? null,
  });
  await appendAgencyLog(c.env.DB, { agent_slug: b.agent_slug ?? 'gmb-rank', status: 'saved', step: 'gbp-offer', summary: `GBP offer proposal saved (inactive): ${b.title}` });
  return c.json({ ok: true, offer_id: id });
});

// §2: agent-proposed GBP Event — saved INACTIVE for Marvin to review + activate.
agencyInternalRoutes.post('/gbp-event', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const b = await c.req.json().catch(() => ({})) as Record<string, string | null>;
  if (!b.client_id || !b.title) return c.json({ error: 'client_id and title required' }, 400);
  const generationBlock = await governedAgencyContentBlock(c.env.DB, b.client_id, b.gbp_event_start_date);
  if (generationBlock) return c.json({ error: generationBlock }, 409);
  const pending = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM client_events WHERE client_id = ? AND active = 0').bind(b.client_id).first<{ n: number }>();
  if ((pending?.n ?? 0) > 0) return c.json({ ok: true, skipped: true, reason: 'pending_event_exists' });
  const id = await createClientEventDraft(c.env.DB, {
    client_id: String(b.client_id), title: String(b.title),
    description: b.description ?? null, gbp_event_title: b.gbp_event_title ?? null,
    gbp_event_start_date: b.gbp_event_start_date ?? null, gbp_event_end_date: b.gbp_event_end_date ?? null,
    gbp_cta_type: (b.gbp_cta_type && b.gbp_cta_type !== 'NONE') ? b.gbp_cta_type : null,
    gbp_cta_url: b.gbp_cta_url ?? null, gbp_location_id: b.gbp_location_id ?? null,
    ai_image_prompt: b.ai_image_prompt ?? null,
  });
  await appendAgencyLog(c.env.DB, { agent_slug: b.agent_slug ?? 'gmb-rank', status: 'saved', step: 'gbp-event', summary: `GBP event proposal saved (inactive): ${b.title}` });
  return c.json({ ok: true, event_id: id });
});

// Read-only: list the Google Business locations connected to an upload-post
// profile (id + name), straight from upload-post. Used to wire multi-location
// clients with real data instead of guessing.
agencyInternalRoutes.get('/gbp-profile-locations', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const profile = c.req.query('profile');
  if (!profile) return c.json({ error: 'profile required' }, 400);
  try {
    const up = new UploadPostClient(c.env.UPLOAD_POST_API_KEY);
    const payload = await up.getGbpLocations(profile) as { locations?: Array<Record<string, unknown>> };
    const locations = (payload.locations ?? []).map((l) => ({
      location_id: String(l.location_id ?? l.id ?? ''),
      name: String(l.name ?? l.title ?? l.label ?? ''),
      address: (l.address ?? l.storefront_address ?? null) as unknown,
    }));
    return c.json({ ok: true, profile, locations });
  } catch (err) {
    return c.json({ ok: false, profile, error: err instanceof Error ? err.message : String(err) });
  }
});

agencyInternalRoutes.post('/sync-client-platforms', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);

  let body: { client_slug?: string; dry_run?: boolean } = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  const result = await syncUploadPostClientPlatforms(c.env, body);
  for (const item of result.synced.filter((row) => row.action !== 'skipped')) {
    await appendAgencyLog(c.env.DB, {
      agent_slug: 'agency-orchestrator',
      task_id: null,
      status: 'saved',
      step: 'platform-sync',
      summary: `${item.action === 'created' ? 'Created' : 'Updated'} client_platforms: ${item.client} / ${item.platform}${item.username ? ` (@${item.username})` : ''}`,
    });
  }
  return c.json(result);
});

const internalNotifySchema = z.object({
  title:       z.string().max(200),
  body:        z.string().max(3800),
  color:       z.number().int().optional(),
  fields:      z.array(z.object({ name: z.string(), value: z.string(), inline: z.boolean().optional() })).optional(),
  agent_slug:  z.string().optional(),
});

// Record backend spend for an agent call (cost_usd may be null when unknown).
agencyInternalRoutes.post('/cost', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({})) as {
    agent_slug?: string; backend?: string; mode?: string; cost_usd?: number; run_id?: string; task_id?: string; executor_reason?: string;
  };
  if (!body.agent_slug || !body.backend) return c.json({ error: 'agent_slug and backend required' }, 400);
  await recordAgencyCost(c.env.DB, {
    agent_slug: body.agent_slug,
    backend: body.backend,
    mode: body.mode ?? null,
    cost_usd: typeof body.cost_usd === 'number' ? body.cost_usd : null,
    run_id: body.run_id ?? null,
    task_id: body.task_id ?? null,
    executor_reason: body.executor_reason ?? null,
  });
  const spend_today = await getAgentSpendToday(c.env.DB, body.agent_slug);
  return c.json({ ok: true, spend_today });
});

// §3: persist the research agent's keyword set into the shared client_keywords
// table. Additive upsert — never deletes curated/manual keywords.
agencyInternalRoutes.post('/keywords', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({})) as {
    client_id?: string;
    keywords?: Array<{ keyword?: string; kw_type?: string; search_intent?: string | null; difficulty?: string | null; opportunity_notes?: string | null; locality?: string | null; source?: string | null; confidence?: string | null }>;
  };
  if (!body.client_id) return c.json({ error: 'client_id required' }, 400);
  const rows = (Array.isArray(body.keywords) ? body.keywords : [])
    .filter((k) => k && typeof k.keyword === 'string' && k.keyword.trim())
    .map((k) => ({ ...k, keyword: String(k.keyword).trim() }));
  const result = await upsertClientKeywords(c.env.DB, body.client_id, rows);
  return c.json({ ok: true, ...result });
});

// §5: persist profile gaps (needs_info) and recorded assumptions for a client.
// Additive upsert keyed by (client_id, field). The runner separately posts the
// questions to Discord; this marks them asked.
agencyInternalRoutes.post('/profile-gaps', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({})) as {
    client_id?: string;
    gaps?: Array<{ field?: string; question?: string | null; confidence?: string | null }>;
    assumptions?: string[];
    asked_in_discord?: boolean;
  };
  if (!body.client_id) return c.json({ error: 'client_id required' }, 400);
  const askedAt = body.asked_in_discord ? Math.floor(Date.now() / 1000) : null;
  let savedGaps = 0;
  for (const g of (Array.isArray(body.gaps) ? body.gaps : [])) {
    if (!g || !g.field || !String(g.field).trim()) continue;
    await upsertClientProfileGap(c.env.DB, {
      client_id: body.client_id,
      field: String(g.field).trim(),
      question: g.question ?? null,
      status: 'needs_info',
      asked_in_discord_at: askedAt,
    });
    savedGaps++;
  }
  // Assumptions are recorded as their own gap rows (status 'assumed') so a human
  // can see and correct them. Keyed by a stable field name per assumption index.
  let savedAssumptions = 0;
  const assumptions = Array.isArray(body.assumptions) ? body.assumptions : [];
  for (let i = 0; i < assumptions.length; i++) {
    const a = String(assumptions[i] ?? '').trim();
    if (!a) continue;
    await upsertClientProfileGap(c.env.DB, {
      client_id: body.client_id,
      field: `assumption_${i + 1}`,
      status: 'assumed',
      assumption: a,
    });
    savedAssumptions++;
  }
  return c.json({ ok: true, saved_gaps: savedGaps, saved_assumptions: savedAssumptions });
});

// Today's known spend for an agent, plus whether it has hit its daily cap.
agencyInternalRoutes.get('/agent-spend/:slug', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const slug = c.req.param('slug');
  const spend_today = await getAgentSpendToday(c.env.DB, slug);
  const budget = Number(c.env.AGENCY_AGENT_DAILY_BUDGET_USD || 0);
  return c.json({ ok: true, spend_today, budget, over_budget: budget > 0 && spend_today >= budget });
});

agencyInternalRoutes.post('/notify-discord', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalNotifySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);

  // Use agency-specific channel if configured, else fall back to the main Discord channel
  const channelId = c.env.AGENCY_NOTIFY_CHANNEL_ID || c.env.DISCORD_CHANNEL_ID;
  const token = c.env.DISCORD_BOT_TOKEN;
  if (!channelId || !token) return c.json({ ok: false, reason: 'No Discord channel or token configured' });

  const { title, body, color, fields, agent_slug } = parsed.data;
  try {
    await discordSend({
      channelId,
      token,
      embeds: [{
        title,
        description: body,
        color: color ?? 0x6366f1,
        fields: fields ?? [],
        footer: { text: agent_slug ? `Agent: ${agent_slug}` : 'WebXni AI Agency' },
        timestamp: new Date().toISOString(),
      }],
    });
    await appendAgencyLog(c.env.DB, {
      agent_slug: agent_slug ?? 'agency',
      task_id: null,
      status: 'notified',
      step: 'discord-notify',
      summary: `Discord notification sent: ${title}`,
    });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: redactSecrets(err instanceof Error ? err.message : String(err)) });
  }
});

agencyInternalRoutes.get('/jobs/:id/context', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const job = await getApprovedCommandJobById(c.env.DB, c.req.param('id'));
  if (!job || !job.command_name.startsWith('agency_')) return c.json({ error: 'Not found' }, 404);
  return c.json({
    ok: true,
    job: {
      id: job.id,
      command_name: job.command_name,
      provider: job.provider,
      args_json: redactSecrets(job.args_json),
    },
  });
});
