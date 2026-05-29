import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import {
  appendAgencyLog,
  createAgentFinding,
  createAgentRun,
  createAgentTask,
  createApprovedCommandJob,
  createPost,
  getAgencyClientCoverage,
  getAgencyLogs,
  getApprovedCommandJobById,
  getAgentSystemHealthSnapshot,
  getAgentTask,
  saveClientResearch,
  saveClientStrategy,
  saveContentReview,
  listAgencyOverview,
  listAgentDefinitions,
  listAgentFindings,
  listAgentRuns,
  listAgentTasks,
  listApprovedCommandJobs,
  updateAgentFinding,
  updateAgentRun,
  updateAgentTask,
  writeAuditLog,
} from '../db/queries';
import { redactSecrets } from '../modules/redaction';

export const agencyRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();
export const agencyInternalRoutes = new Hono<{ Bindings: Env; Variables: Record<string, unknown> }>();

const AGENT_COMMANDS: Record<string, string> = {
  'agency-orchestrator': 'agency_orchestrator',
  'system-reliability': 'agency_system_review',
  'security-sentinel': 'agency_security_review',
  'client-research': 'agency_client_research',
  strategy: 'agency_strategy',
  'social-copy': 'agency_social_generation',
  'blog-writer': 'agency_blog_generation',
  'editorial-review': 'agency_editorial_review',
};

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
    ['webxni-agency-orchestrator', 'Coordinates safe weekly agency work.', 'agency-orchestrator', 'Claude Code'],
    ['webxni-system-reliability', 'Reviews platform and job health defensively.', 'system-reliability', 'Claude Code'],
    ['webxni-security-sentinel', 'Reviews auth/audit signals with redaction.', 'security-sentinel', 'Claude Code'],
    ['webxni-client-research', 'Quota-limited active client research.', 'client-research', 'Gemini CLI'],
    ['webxni-strategist', 'Creates reviewable client strategy plans.', 'strategy', 'Claude Code'],
    ['webxni-social-copywriter', 'Drafts social copy without approval bypass.', 'social-copy', 'Claude Code'],
    ['webxni-blog-writer', 'Drafts SEO blogs without publishing.', 'blog-writer', 'Claude Code'],
    ['webxni-editorial-reviewer', 'Reviews drafts for quality and factual risk.', 'editorial-review', 'Claude Code'],
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
    ['Claude Code / Gemini CLI / Codex', 'Backend choice is agent-specific and budget controlled.'],
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
agencyRoutes.get('/timeline', async (c) => c.json({ items: TIMELINE.map((item) => ({ ...item, status: timelineStatus(item.day) })) }));
agencyRoutes.get('/logs', async (c) => c.json({ logs: await getAgencyLogs(c.env.DB) }));
agencyRoutes.get('/skills', async (c) => c.json({ skills: agencySkills() }));
agencyRoutes.get('/harness-flow', async (c) => c.json({ steps: harnessFlow() }));

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
  if (!AGENT_COMMANDS[parsed.data.agent_slug]) return c.json({ error: 'Unknown agent_slug' }, 400);
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
  const commandName = AGENT_COMMANDS[agentSlug];
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

  const job = await createApprovedCommandJob(c.env.DB, {
    generation_run_id: null,
    command_name: commandName,
    provider: agent.default_backend,
    requested_by: c.get('user').userId,
    args_json: JSON.stringify({
      agent_slug: agentSlug,
      task_id: task.id,
      source: 'agency_dashboard',
      safety: {
        no_arbitrary_shell: true,
        preserve_marvin_approval: true,
        preserve_designer_gate: true,
      },
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
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  title: z.string().min(1).max(200),
  finding_json: z.record(z.unknown()).nullable().optional(),
});

const internalResearchSchema = z.object({
  agent_slug: z.string(),
  task_id: z.string().optional(),
  client_id: z.string(),
  source: z.string().min(1).max(80).optional(),
  freshness_date: z.string().min(8).max(20),
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
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  notes_json: z.record(z.unknown()),
});

const internalDraftPostSchema = z.object({
  agent_slug: z.string(),
  task_id: z.string().optional(),
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
  ai_image_prompt: z.string().nullable().optional(),
  ai_video_prompt: z.string().nullable().optional(),
  skarleth_notes: z.string().nullable().optional(),
});

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
  const commandName = AGENT_COMMANDS[agentSlug];
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
      safety: {
        no_arbitrary_shell: true,
        preserve_marvin_approval: true,
        preserve_designer_gate: true,
      },
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
  const [overview, agents, tasks, findings, coverage, logs, approved_jobs, system_health] = await Promise.all([
    listAgencyOverview(c.env.DB),
    listAgentDefinitions(c.env.DB),
    listAgentTasks(c.env.DB, 50),
    listAgentFindings(c.env.DB, 50),
    getAgencyClientCoverage(c.env.DB),
    getAgencyLogs(c.env.DB, 40),
    listApprovedCommandJobs(c.env.DB, 30),
    getAgentSystemHealthSnapshot(c.env.DB, { lookbackHours: 168 }),
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

agencyInternalRoutes.post('/content-review', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalReviewSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  await saveContentReview(c.env.DB, {
    post_id: parsed.data.post_id ?? null,
    blog_id: parsed.data.blog_id ?? null,
    agent_task_id: parsed.data.task_id ?? null,
    severity: parsed.data.severity,
    notes_json: JSON.stringify(parsed.data.notes_json),
  });
  await appendAgencyLog(c.env.DB, {
    agent_slug: parsed.data.agent_slug,
    task_id: parsed.data.task_id ?? null,
    status: 'saved',
    step: 'content-review',
    summary: `${parsed.data.severity.toUpperCase()} content review note saved.`,
  });
  return c.json({ ok: true });
});

agencyInternalRoutes.post('/draft-post', async (c) => {
  if (!(await requireBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = internalDraftPostSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const captions = parsed.data.platform_captions ?? {};
  const post = await createPost(c.env.DB, {
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
    ai_image_prompt: parsed.data.ai_image_prompt ?? null,
    ai_video_prompt: parsed.data.ai_video_prompt ?? null,
    skarleth_notes: parsed.data.skarleth_notes ?? null,
    ready_for_automation: 0,
    asset_delivered: 0,
    scheduled_by_automation: 1,
  });
  await appendAgencyLog(c.env.DB, {
    agent_slug: parsed.data.agent_slug,
    task_id: parsed.data.task_id ?? null,
    status: 'saved',
    step: 'draft-post',
    summary: `Draft ${post.content_type} post created for review: ${post.title}`,
  });
  return c.json({ ok: true, post_id: post.id });
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
