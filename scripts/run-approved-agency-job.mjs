#!/usr/bin/env node
import { redactSecrets } from './lib/agency-redaction.mjs';
import { AGENCY_SCHEMAS, buildAgencyPrompt } from './lib/agency-agent-prompts.mjs';
import { runTerminalJsonAgent } from './lib/terminal-json-agent.mjs';

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

const jobId = arg('--job-id');
const apiBaseUrl = arg('--api-base-url') || process.env.API_BASE_URL || 'https://marketing.webxni.com';
const botSecret = arg('--bot-secret') || process.env.DISCORD_BOT_SECRET || '';
const EXECUTE_AI = process.env.AGENCY_EXECUTE_AI === '1';
const ALLOW_DRAFT_POSTS = process.env.AGENCY_ALLOW_DRAFT_POSTS === '1';

if (!jobId) {
  console.error('Missing --job-id');
  process.exit(2);
}
if (!botSecret) {
  console.error('Missing --bot-secret or DISCORD_BOT_SECRET');
  process.exit(2);
}

async function loadAiConfig() {
  try {
    const res = await fetch(`${apiBaseUrl}/internal/agency/ai-config`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botSecret}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.openai_api_key && !process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = data.openai_api_key;
      console.log(`[agency] OpenAI key loaded from KV settings (model: ${data.openai_model})`);
    }
    if (data.openai_model && !process.env.OPENAI_MODEL) {
      process.env.OPENAI_MODEL = data.openai_model;
    }
  } catch { /* non-fatal — OpenAI remains unavailable if fetch fails */ }
}

async function request(pathname, options = {}) {
  const res = await fetch(`${apiBaseUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${botSecret}`,
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${pathname} ${res.status}: ${redactSecrets(text).slice(0, 500)}`);
  return body;
}

async function post(pathname, body) {
  return request(pathname, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

function topCoverageGaps(coverage) {
  return [...coverage]
    .sort((a, b) => {
      const aScore = (a.last_research_date ? 0 : 3) + (a.current_strategy_status === 'none' ? 2 : 0) + a.posts_waiting_approval + a.posts_waiting_designer;
      const bScore = (b.last_research_date ? 0 : 3) + (b.current_strategy_status === 'none' ? 2 : 0) + b.posts_waiting_approval + b.posts_waiting_designer;
      return bScore - aScore;
    })
    .slice(0, 5);
}

function summarizeSnapshot(snapshot) {
  const overview = snapshot.overview;
  const failedJobs = snapshot.approved_jobs.filter((job) => job.status === 'failed');
  const runningJobs = snapshot.approved_jobs.filter((job) => job.status === 'running' || job.status === 'claimed');
  const openFindings = snapshot.findings.filter((finding) => finding.status === 'open');
  const coverageGaps = topCoverageGaps(snapshot.coverage);

  return {
    overview,
    failed_jobs: failedJobs.length,
    running_jobs: runningJobs.length,
    open_findings: openFindings.length,
    top_coverage_gaps: coverageGaps.map((client) => ({
      client_id: client.client_id,
      client_name: client.client_name,
      next_agent_action: client.next_agent_action,
      posts_waiting_approval: client.posts_waiting_approval,
      posts_waiting_designer: client.posts_waiting_designer,
      last_research_date: client.last_research_date,
      strategy_status: client.current_strategy_status,
    })),
  };
}

function clientWorkScore(client) {
  const researchAge = client.last_research_date ? Date.parse(client.last_research_date) || 0 : 0;
  const needsStrategy = client.current_strategy_status === 'none' ? 3 : client.current_strategy_status === 'draft' ? 1 : 0;
  return {
    missingResearch: client.last_research_date ? 0 : 5,
    researchAge,
    needsStrategy,
    queuePressure: (client.posts_waiting_approval || 0) + (client.posts_waiting_designer || 0),
  };
}

function selectResearchClients(coverage, limit) {
  return [...coverage]
    .sort((a, b) => {
      const aScore = clientWorkScore(a);
      const bScore = clientWorkScore(b);
      return (bScore.missingResearch - aScore.missingResearch)
        || (aScore.researchAge - bScore.researchAge)
        || (bScore.queuePressure - aScore.queuePressure);
    })
    .slice(0, limit);
}

function selectStrategyClients(coverage, limit) {
  return [...coverage]
    .filter((client) => client.current_strategy_status !== 'approved')
    .sort((a, b) => {
      const aScore = clientWorkScore(a);
      const bScore = clientWorkScore(b);
      return (bScore.needsStrategy - aScore.needsStrategy)
        || (aScore.researchAge - bScore.researchAge)
        || (bScore.queuePressure - aScore.queuePressure);
    })
    .slice(0, limit);
}

function selectEditorialTarget(tasks) {
  const completed = tasks.filter((task) => task.status === 'completed');
  const generatedContent = completed.find((task) => ['blog-writer', 'social-copy'].includes(task.agent_slug));
  if (generatedContent) return generatedContent;
  return completed[0] || tasks.find((task) => task.status === 'needs_review') || tasks[0] || null;
}

function buildResult(agentSlug, commandName, snapshot) {
  const summary = summarizeSnapshot(snapshot);
  const overview = snapshot.overview;
  const systemHealth = snapshot.system_health || {};
  const coverageGaps = summary.top_coverage_gaps;
  const safety = {
    no_arbitrary_shell: true,
    preserve_marvin_approval: true,
    preserve_designer_gate: true,
    no_auto_publish: true,
  };

  if (agentSlug === 'system-reliability') {
    const recentFailures = systemHealth.recent_generation_failures || [];
    const failedRecent = systemHealth.approved_jobs?.failed_recent || 0;
    const riskLevel = recentFailures.length || failedRecent ? 'medium' : 'low';
    return {
      summary: `System review completed: ${recentFailures.length} recent generation issue(s), ${failedRecent} recent approved-job failure(s).`,
      agent_slug: agentSlug,
      command_name: commandName,
      risk_level: riskLevel,
      findings: [
        ...recentFailures.slice(0, 5).map((run) => ({
          severity: 'medium',
          title: `Generation run ${run.id} ended as ${run.status}`,
          description: redactSecrets(run.error_log || 'No error log captured.'),
          recommended_action: 'Review generation run logs before retrying.',
        })),
      ],
      jobs_reviewed: {
        queued_approved_jobs: systemHealth.approved_jobs?.queued || 0,
        running_approved_jobs: systemHealth.approved_jobs?.running || 0,
        failed_recent: failedRecent,
      },
      recommended_actions: failedRecent || recentFailures.length
        ? ['Review failed runs in Automation before queueing more terminal generation.']
        : ['No reliability action required right now.'],
      safety,
    };
  }

  if (agentSlug === 'security-sentinel') {
    const authFailures = systemHealth.auth_failures_recent || [];
    const riskLevel = authFailures.some((item) => item.attempts >= 10) ? 'medium' : 'low';
    return {
      summary: `Security review completed: ${authFailures.length} failed-login cluster(s) in the review window.`,
      agent_slug: agentSlug,
      command_name: commandName,
      risk_level: riskLevel,
      findings: authFailures.slice(0, 5).map((item) => ({
        severity: item.attempts >= 10 ? 'medium' : 'info',
        title: `Failed login activity for ${redactSecrets(item.email)}`,
        description: `${item.attempts} failed attempt(s), IP ${redactSecrets(item.ip || 'unknown')}, reason ${redactSecrets(item.fail_reason || 'unknown')}.`,
        recommended_action: 'Review account activity and rate-limit behavior if attempts continue.',
        redacted: true,
      })),
      logs_reviewed: ['login_audit', 'audit_logs', 'approved_command_jobs'],
      requires_human_attention: riskLevel !== 'low',
      safety,
    };
  }

  if (agentSlug === 'client-research') {
    const candidates = selectResearchClients(
      snapshot.coverage,
      Number(process.env.AGENCY_DAILY_RESEARCH_CLIENT_LIMIT || process.env.GEMINI_DAILY_CLIENT_LIMIT || 2),
    );
    return {
      summary: `Research batch planned for ${candidates.length} client(s). No external research call was made in this safe runner pass.`,
      agent_slug: agentSlug,
      command_name: commandName,
      planned_clients: candidates.map((client) => ({
        client_id: client.client_id,
        client_name: client.client_name,
        next_agent_action: client.next_agent_action,
      })),
      next_actions: candidates.length
        ? ['Refresh the oldest or missing client research with source capture and daily quotas.']
        : ['No active clients are available for research.'],
      safety,
    };
  }

  if (agentSlug === 'strategy') {
    const candidates = selectStrategyClients(snapshot.coverage, Number(process.env.AGENCY_DAILY_STRATEGY_CLIENT_LIMIT || 3));
    return {
      summary: `Strategy planning identified ${candidates.length} client(s) needing draft strategy work.`,
      agent_slug: agentSlug,
      command_name: commandName,
      planned_clients: candidates.map((client) => ({
        client_id: client.client_id,
        client_name: client.client_name,
        last_research_date: client.last_research_date,
      })),
      next_actions: ['Save strategy updates as draft only; do not approve or publish automatically.'],
      safety,
    };
  }

  if (agentSlug === 'social-copy') {
    return {
      summary: `Social queue review completed: ${overview.waiting_marvin_approval} post(s) wait for Marvin and ${overview.waiting_designer_assets} wait for designer assets.`,
      agent_slug: agentSlug,
      command_name: commandName,
      approval_status: {
        waiting_marvin_approval: overview.waiting_marvin_approval,
        waiting_designer_assets: overview.waiting_designer_assets,
      },
      next_actions: ['Wire Hermes social draft generation so new posts stay pending approval and asset_delivered remains false.'],
      safety,
    };
  }

  if (agentSlug === 'blog-writer') {
    return {
      summary: `Blog review completed: ${overview.blogs_generated_this_week} blog draft(s) generated this week.`,
      agent_slug: agentSlug,
      command_name: commandName,
      blogs_generated_this_week: overview.blogs_generated_this_week,
      next_actions: ['Wire Hermes blog drafting to save drafts only and never publish WordPress automatically.'],
      safety,
    };
  }

  if (agentSlug === 'editorial-review') {
    const reviewCandidates = snapshot.tasks
      .filter((task) => ['needs_review', 'queued', 'completed'].includes(task.status))
      .slice(0, 10);
    const target = selectEditorialTarget(snapshot.tasks);
    return {
      summary: `Editorial review scan found ${reviewCandidates.length} task candidate(s); preferred target is ${target?.title || 'none'}.`,
      agent_slug: agentSlug,
      command_name: commandName,
      review_candidates: reviewCandidates.map((task) => ({
        task_id: task.id,
        title: task.title,
        status: task.status,
        agent_slug: task.agent_slug,
      })),
      preferred_target_task_id: target?.id ?? null,
      next_actions: ['Wire editorial checks to content_review_notes without approving as Marvin.'],
      safety,
    };
  }

  if (agentSlug === 'client-onboarding') {
    const noConnections = snapshot.coverage.filter((c) => !c.last_research_date);
    return {
      summary: `Onboarding scan: ${noConnections.length} client(s) need platform connections and/or research. Enable AGENCY_EXECUTE_AI=1 to run the full onboarding.`,
      agent_slug: agentSlug,
      command_name: commandName,
      clients_needing_onboarding: noConnections.map((c) => ({ client_name: c.client_name, client_id: c.client_id })),
      next_actions: ['Run the client-onboarding agent with AGENCY_EXECUTE_AI=1 to sync Upload-Post connections and build intelligence profiles.'],
      safety,
    };
  }

  return {
    summary: `Agency orchestration completed: ${overview.waiting_marvin_approval} approval item(s), ${overview.waiting_designer_assets} designer item(s), ${summary.failed_jobs} failed agency job(s).`,
    agent_slug: agentSlug,
    command_name: commandName,
    week_start: new Date().toISOString().slice(0, 10),
    bottlenecks: [
      overview.waiting_marvin_approval > 0 ? {
        type: 'approval',
        severity: 'medium',
        title: 'Marvin approval queue has pending posts',
        summary: `${overview.waiting_marvin_approval} post(s) are waiting for approval.`,
      } : null,
      overview.waiting_designer_assets > 0 ? {
        type: 'designer',
        severity: 'low',
        title: 'Designer asset queue has pending posts',
        summary: `${overview.waiting_designer_assets} post(s) are waiting for designer assets.`,
      } : null,
      summary.failed_jobs > 0 ? {
        type: 'system',
        severity: 'medium',
        title: 'Failed agency or terminal jobs found',
        summary: `${summary.failed_jobs} failed job(s) were found in the current snapshot.`,
      } : null,
    ].filter(Boolean),
    top_coverage_gaps: coverageGaps,
    next_actions: [
      overview.waiting_marvin_approval > 0 ? 'Review Marvin approval queue.' : null,
      overview.waiting_designer_assets > 0 ? 'Ask designer to upload pending assets.' : null,
      coverageGaps.length ? `Review next action for ${coverageGaps[0].client_name}.` : null,
      'Continue wiring agent-specific Claude/Gemini structured execution.',
    ].filter(Boolean),
    safety,
  };
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function nextScheduledDate(dayName) {
  const dayIdx = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
  const now = new Date();
  const utcDay = now.getUTCDay();
  const daysToMonday = utcDay === 0 ? 1 : (8 - utcDay) % 7 || 7;
  const offset = dayIdx[String(dayName).toLowerCase()] ?? 0;
  const date = new Date(now);
  date.setUTCDate(now.getUTCDate() + daysToMonday + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Returns publish_date strings for the upcoming Mon–Sat in Nicaragua time (CST = UTC-6).
 * Spreads totalClients evenly across 6 days at staggered times for natural variety.
 */
function upcomingWeekSchedule(totalClients) {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun … 6=Sat
  const daysToMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
  // Good posting times in Nicaragua time (stored as-is, no UTC conversion needed)
  const times = ['09:00', '12:00', '15:00', '18:00'];
  const slotsPerDay = Math.max(1, Math.ceil(totalClients / 6));
  const schedule = [];
  for (let i = 0; i < totalClients; i++) {
    const dayIndex  = Math.floor(i / slotsPerDay);
    const slotIndex = i % slotsPerDay;
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + daysToMonday + Math.min(dayIndex, 5));
    const dateStr = d.toISOString().slice(0, 10);
    const time    = times[slotIndex % times.length];
    schedule.push(`${dateStr}T${time}`);
  }
  return schedule;
}

// Per-agent backend priority chains.
// Each array is tried in order; the first available backend wins.
// Claude-backed agency agents use Codex as the terminal fallback Marvin requested,
// then OpenAI if terminal backends are unavailable or fail.
const AGENT_HERMES_SKILLS = {
  'agency-orchestrator': 'webxni-agency-orchestrator',
  'system-reliability': 'webxni-system-reliability',
  'security-sentinel': 'webxni-security-sentinel',
  'client-research': 'webxni-client-research',
  'strategy': 'webxni-strategist',
  'social-copy': 'webxni-social-copywriter',
  'blog-writer': 'webxni-blog-writer',
  'editorial-review': 'webxni-editorial-reviewer',
  'client-onboarding': 'webxni-agency-orchestrator',
};

const AGENT_BACKEND_PRIORITY = {
  'agency-orchestrator': ['hermes', 'claude', 'codex', 'openai'],
  'system-reliability':  ['hermes', 'claude', 'codex', 'openai'],
  'security-sentinel':   ['hermes', 'claude', 'codex', 'openai'],
  'editorial-review':    ['hermes', 'claude', 'codex', 'openai'],
  'strategy':            ['hermes', 'claude', 'codex', 'openai'],
  'social-copy':         ['hermes', 'claude', 'codex', 'openai'],
  'blog-writer':         ['hermes', 'claude', 'codex', 'openai'],
  'client-research':     ['hermes', 'gemini', 'openai'],
  'client-onboarding':   ['hermes', 'claude', 'codex', 'openai'],
};

function parseBackendPriority(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : null;
  } catch {
    return null;
  }
}

function preferredBackend(agentSlug, fallback, taskInput = {}) {
  const envOverride = process.env.AGENCY_TERMINAL_AGENT;
  if (envOverride && envOverride !== 'auto') return [envOverride];

  const chain = [
    'hermes',
    ...(parseBackendPriority(taskInput.backend_priority) ?? []),
    ...(fallback && fallback !== 'internal' ? [fallback] : []),
    ...(AGENT_BACKEND_PRIORITY[agentSlug] ?? ['claude', 'openai']),
  ];

  return [...new Set(chain.filter(Boolean))];
}

async function runStructuredAgent(kind, agentSlug, backend, client, snapshot, task, modeOverride) {
  const prompt = buildAgencyPrompt(kind, { client, snapshot, task });
  const schema = AGENCY_SCHEMAS[kind];
  const mode = modeOverride ?? (kind === 'blogDraft' ? 'blog' : 'default');
  const result = await runTerminalJsonAgent({
    prompt,
    schema,
    preferredBackend: preferredBackend(agentSlug, backend, task),
    skills: AGENT_HERMES_SKILLS[agentSlug] ? [AGENT_HERMES_SKILLS[agentSlug]] : [],
    mode,
  });
  if (result.fallback_used) {
    await post('/internal/agency/notify-discord', {
      title: 'Agency backend fallback used',
      body: `${agentSlug} primary backend failed; completed with ${result.backend}.`,
      color: 0xf59e0b,
      fields: (result.attempts ?? []).slice(0, 4).map((a) => ({
        name: a.backend,
        value: a.status === 'completed' ? 'completed' : `failed: ${String(a.error || '').slice(0, 120)}`,
        inline: false,
      })),
      agent_slug: agentSlug,
    }).catch(() => {});
  }
  return result;
}

async function runAiPhase(agentSlug, commandName, backend, taskId, snapshot, taskInput) {
  if (!EXECUTE_AI) {
    return {
      ...buildResult(agentSlug, commandName, snapshot),
      ai_execution_enabled: false,
    };
  }

  if (agentSlug === 'client-onboarding') {
    // Step 1: sync platform connections from Upload-Post for all clients
    const syncResult = await post('/internal/agency/sync-client-platforms', {});
    const created = syncResult.created ?? 0;
    const syncErrors = syncResult.errors ?? [];

    // Step 2: for each client with no intelligence profile, run AI to build one
    const candidates = snapshot.coverage.filter((c) => !c.last_research_date).slice(0, 3);
    const profiled = [];
    for (const client of candidates) {
      try {
        const result = await runStructuredAgent('research', agentSlug, backend, client, snapshot, taskInput);
        await post('/internal/agency/research-note', {
          agent_slug: agentSlug,
          task_id: taskId,
          client_id: client.client_id,
          source: result.backend,
          freshness_date: isoDate(),
          research_json: result.output,
        });
        profiled.push({ client_name: client.client_name, backend: result.backend });
      } catch { /* skip failed clients */ }
    }

    return {
      summary: `Onboarding: ${created} platform connection(s) synced from Upload-Post. ${profiled.length} client profile(s) built.`,
      agent_slug: agentSlug,
      command_name: commandName,
      platforms_created: created,
      sync_errors: syncErrors.slice(0, 5),
      profiles_built: profiled,
      safety: { no_arbitrary_shell: true, preserve_marvin_approval: true, preserve_designer_gate: true },
    };
  }

  if (agentSlug === 'system-reliability' || agentSlug === 'security-sentinel') {
    const result = await runStructuredAgent('operationalReview', agentSlug, backend, snapshot.system_health || snapshot.overview, snapshot, taskInput);
    return {
      summary: result.output.summary,
      agent_slug: agentSlug,
      command_name: commandName,
      risk_level: result.output.severity,
      findings: result.output.findings,
      recommended_actions: result.output.recommended_actions,
      backend: result.backend,
      safety: { no_arbitrary_shell: true, preserve_marvin_approval: true, preserve_designer_gate: true, no_auto_publish: true },
    };
  }

  if (agentSlug === 'agency-orchestrator') {
    const result = await runStructuredAgent('operationalReview', agentSlug, backend, snapshot.system_health || snapshot.overview, snapshot, taskInput);
    const out = result.output;

    // Build Discord report from today's findings + orchestrator output
    const todayFindings = snapshot.findings.filter((f) => {
      const created = f.created_at * 1000;
      const dayAgo = Date.now() - 86400000;
      return created > dayAgo && f.status === 'open';
    });

    const riskEmoji = { low: '🟢', medium: '🟡', high: '🔴', critical: '🚨', info: '⚪' };
    const findingLines = todayFindings.slice(0, 8).map((f) => {
      const emoji = riskEmoji[f.severity] ?? '⚪';
      return `${emoji} **${f.agent_slug}** — ${f.title}`;
    });

    const overview = snapshot.overview;
    const fields = [
      { name: 'Risk', value: String(out.severity ?? 'low'), inline: true },
      { name: 'Backend', value: result.backend, inline: true },
      { name: 'Approval Queue', value: String(overview.waiting_marvin_approval), inline: true },
      { name: 'Designer Queue', value: String(overview.waiting_designer_assets), inline: true },
      { name: 'Failed Jobs', value: String(overview.failed_agent_jobs), inline: true },
      { name: 'Posts This Week', value: String(overview.posts_generated_this_week), inline: true },
    ];

    const bodyLines = [
      out.summary ?? '',
      '',
      findingLines.length ? `**Today's findings (${findingLines.length}):**\n${findingLines.join('\n')}` : '',
      '',
      (out.recommended_actions ?? []).slice(0, 3).map((a) => `→ ${a}`).join('\n'),
    ].filter(Boolean);

    const colorMap = { low: 0x22c55e, medium: 0xf59e0b, high: 0xef4444, critical: 0xdc2626, info: 0x6366f1 };
    const color = colorMap[out.severity] ?? 0x6366f1;

    await post('/internal/agency/notify-discord', {
      title: `🤖 Agency Daily Report — ${new Date().toISOString().slice(0, 10)}`,
      body: bodyLines.join('\n').slice(0, 3800),
      color,
      fields,
      agent_slug: 'agency-orchestrator',
    }).catch((err) => console.warn('[agency] Discord notify failed (non-fatal):', err.message));

    return {
      summary: out.summary,
      agent_slug: agentSlug,
      command_name: commandName,
      risk_level: out.severity,
      findings: out.findings,
      recommended_actions: out.recommended_actions,
      backend: result.backend,
      discord_notified: true,
      safety: { no_arbitrary_shell: true, preserve_marvin_approval: true, preserve_designer_gate: true, no_auto_publish: true },
    };
  }

  if (agentSlug === 'client-research') {
    const candidates = selectResearchClients(
      snapshot.coverage,
      Number(process.env.AGENCY_DAILY_RESEARCH_CLIENT_LIMIT || process.env.GEMINI_DAILY_CLIENT_LIMIT || 2),
    );
    const saved = [];
    for (const client of candidates) {
      const result = await runStructuredAgent('research', agentSlug, backend, client, snapshot, taskInput);
      await post('/internal/agency/research-note', {
        agent_slug: agentSlug,
        task_id: taskId,
        client_id: client.client_id,
        source: result.backend,
        freshness_date: isoDate(),
        research_json: result.output,
      });
      saved.push({ client_id: client.client_id, client_name: client.client_name, backend: result.backend });
    }
    return {
      summary: `Client research completed for ${saved.length} client(s).`,
      agent_slug: agentSlug,
      command_name: commandName,
      saved_research: saved,
      safety: { no_arbitrary_shell: true, preserve_marvin_approval: true, preserve_designer_gate: true, no_auto_publish: true },
    };
  }

  if (agentSlug === 'strategy') {
    const candidates = selectStrategyClients(snapshot.coverage, Number(process.env.AGENCY_DAILY_STRATEGY_CLIENT_LIMIT || 3));
    const saved = [];
    for (const client of candidates) {
      const result = await runStructuredAgent('strategy', agentSlug, backend, client, snapshot, taskInput);
      await post('/internal/agency/strategy-plan', {
        agent_slug: agentSlug,
        task_id: taskId,
        client_id: client.client_id,
        period_start: isoDate(),
        period_end: isoDate(30),
        status: 'draft',
        strategy_json: result.output,
      });
      saved.push({ client_id: client.client_id, client_name: client.client_name, backend: result.backend });
    }
    return {
      summary: `Strategy draft saved for ${saved.length} client(s).`,
      agent_slug: agentSlug,
      command_name: commandName,
      saved_strategies: saved,
      safety: { no_arbitrary_shell: true, preserve_marvin_approval: true, preserve_designer_gate: true, no_auto_publish: true },
    };
  }

  if (agentSlug === 'social-copy') {
    if (!ALLOW_DRAFT_POSTS) {
      return {
        ...buildResult(agentSlug, commandName, snapshot),
        ai_execution_enabled: true,
        draft_creation_enabled: false,
      };
    }
    const socialLimit = Number(process.env.AGENCY_DAILY_SOCIAL_CLIENT_LIMIT || 3);
    const clients = [...snapshot.coverage]
      .sort((a, b) => {
        const score = (c) => (c.last_research_date ? 0 : 3) + (c.current_strategy_status === 'none' ? 2 : 0);
        return score(b) - score(a);
      })
      .slice(0, socialLimit);
    if (!clients.length) return buildResult(agentSlug, commandName, snapshot);

    const savedDrafts = [];
    const errors = [];
    for (const client of clients) {
      try {
        // Parse package weekly_schedule from coverage
        let weeklySchedule = {};
        try { weeklySchedule = JSON.parse(client.weekly_schedule || '{}'); } catch { /* ignore */ }

        // Collect social (non-blog) slots
        const socialSlots = [];
        for (const [day, types] of Object.entries(weeklySchedule)) {
          for (const type of (Array.isArray(types) ? types : [])) {
            if (type !== 'blog') socialSlots.push({ day, type });
          }
        }

        // Fallback: Mon/Wed/Fri image if no schedule found
        if (!socialSlots.length) {
          socialSlots.push({ day: 'monday', type: 'image' }, { day: 'wednesday', type: 'image' }, { day: 'friday', type: 'image' });
        }

        const scheduleText = socialSlots.map((s) => `${s.day}: ${s.type}`).join('\n');

        // Pull the client's content brief (brand voice, services, areas, restrictions)
        // so drafts use the per-client "template" instead of generic copy.
        let brief = { brief: '', hasBrief: false };
        try { brief = await request(`/internal/agency/client-brief/${client.client_id}`); } catch { /* fall back to no brief */ }
        if (!brief.hasBrief) {
          console.warn(`[social-copy] ${client.client_name} skipped — no brand brief (run client research/strategy first)`);
          errors.push({ client: client.client_name, error: 'No brand brief — needs client research/intelligence before drafting.' });
          continue;
        }
        const clientWithSchedule = { ...client, weekly_schedule_text: scheduleText, content_brief: brief.brief };

        // Re-check OpenAI availability (key may need refresh between clients)
        if (!process.env.OPENAI_API_KEY) await loadAiConfig();

        // One AI call generates ALL posts for this client's week (batch mode = 4096 token budget)
        const result = await runStructuredAgent('socialWeeklyBatch', agentSlug, backend, clientWithSchedule, snapshot, taskInput, 'batch');
        const posts = Array.isArray(result.output?.posts) ? result.output.posts : [];

        for (const draft of posts) {
          // Skip empty AI output so we never persist a contentless draft.
          const draftHasContent = Boolean(
            (draft.master_caption || '').trim() ||
            Object.values(draft.platform_captions || {}).some((v) => typeof v === 'string' && v.trim()),
          );
          if (!draftHasContent) continue;

          const matchedSlot = socialSlots.find(
            (s) => s.day.toLowerCase() === (draft.day_of_week || '').toLowerCase() && s.type === draft.content_type,
          ) || socialSlots.find((s) => s.day.toLowerCase() === (draft.day_of_week || '').toLowerCase())
            || { day: draft.day_of_week || 'monday', type: draft.content_type || 'image' };

          const publishDate = `${nextScheduledDate(matchedSlot.day)}T09:00`;
          const saved = await post('/internal/agency/draft-post', {
            agent_slug: agentSlug,
            task_id: taskId,
            client_id: client.client_id,
            title: draft.title,
            content_type: draft.content_type || 'image',
            platforms: ['facebook', 'instagram'],
            master_caption: draft.master_caption,
            platform_captions: draft.platform_captions,
            ai_image_prompt: draft.content_type === 'image' ? draft.designer_prompt_es : null,
            ai_video_prompt: draft.content_type !== 'image' ? draft.designer_prompt_es : null,
            skarleth_notes: draft.review_notes?.join('\n') || null,
            publish_date: publishDate,
          });
          if (!saved.post_id) continue; // server skipped (empty/dedupe) — nothing persisted
          savedDrafts.push({
            client_name: client.client_name,
            post_id: saved.post_id,
            content_type: draft.content_type,
            day: matchedSlot.day,
            publish_date: publishDate,
            backend: result.backend,
          });
        }
      } catch (clientErr) {
        const msg = redactSecrets(clientErr instanceof Error ? clientErr.message : String(clientErr)).slice(0, 200);
        console.warn(`[social-copy] ${client.client_name} failed (skipping): ${msg}`);
        errors.push({ client: client.client_name, error: msg });
      }
    }

    const clientNames = [...new Set(savedDrafts.map((s) => s.client_name))];
    const summary = savedDrafts.length
      ? `${savedDrafts.length} post(s) for ${clientNames.length} client(s)${errors.length ? ` (${errors.length} skipped)` : ''}.`
      : `No drafts created${errors.length ? ` — ${errors.length} client(s) failed` : ''}.`;
    if (!savedDrafts.length && errors.length) {
      throw new Error(`${summary}; first error: ${errors[0].error}`);
    }
    return {
      summary,
      agent_slug: agentSlug,
      command_name: commandName,
      saved_drafts: savedDrafts,
      client_errors: errors,
      safety: { status: 'draft', ready_for_automation: 0, asset_delivered: 0, no_auto_publish: true },
    };
  }

  if (agentSlug === 'blog-writer') {
    if (!ALLOW_DRAFT_POSTS) {
      return {
        ...buildResult(agentSlug, commandName, snapshot),
        ai_execution_enabled: true,
        draft_creation_enabled: false,
      };
    }
    const blogLimit = Number(process.env.AGENCY_DAILY_BLOG_LIMIT || 3);
    const clients = [...snapshot.coverage]
      .sort((a, b) => {
        const score = (c) => (c.last_research_date ? 0 : 3) + (c.current_strategy_status === 'none' ? 2 : 0);
        return score(b) - score(a);
      })
      .slice(0, blogLimit);
    if (!clients.length) return buildResult(agentSlug, commandName, snapshot);

    const savedBlogs = [];
    const blogErrors = [];
    for (const client of clients) {
      try {
        // Parse blog slots from package weekly_schedule
        let weeklySchedule = {};
        try { weeklySchedule = JSON.parse(client.weekly_schedule || '{}'); } catch { /* ignore */ }
        const blogSlots = [];
        for (const [day, types] of Object.entries(weeklySchedule)) {
          if (Array.isArray(types) && types.includes('blog')) blogSlots.push(day);
        }
        if (!blogSlots.length) blogSlots.push('thursday'); // fallback

        const blogScheduleText = blogSlots.map((d) => `${d}: blog`).join('\n');

        // Same per-client brief (brand voice / services / areas) the social path uses.
        let brief = { brief: '', hasBrief: false };
        try { brief = await request(`/internal/agency/client-brief/${client.client_id}`); } catch { /* fall back to no brief */ }
        if (!brief.hasBrief) {
          console.warn(`[blog-writer] ${client.client_name} skipped — no brand brief (run client research/strategy first)`);
          blogErrors.push({ client: client.client_name, error: 'No brand brief — needs client research/intelligence before drafting.' });
          continue;
        }
        const clientWithSchedule = { ...client, blog_schedule_text: blogScheduleText, content_brief: brief.brief };

        if (!process.env.OPENAI_API_KEY) await loadAiConfig();
        const result = await runStructuredAgent('blogWeeklyBatch', agentSlug, backend, clientWithSchedule, snapshot, taskInput, 'batch');
        const blogs = Array.isArray(result.output?.blogs) ? result.output.blogs : [];

        for (const draft of blogs) {
          if (!(draft.html || '').trim()) continue; // skip empty blog output
          const blogDay = String(draft.day_of_week || blogSlots[0] || 'thursday');
          const publishDate = `${nextScheduledDate(blogDay)}T09:00`;
          const saved = await post('/internal/agency/draft-post', {
            agent_slug: agentSlug,
            task_id: taskId,
            client_id: client.client_id,
            title: draft.title,
            content_type: 'blog',
            platforms: ['website_blog'],
            blog_content: draft.html,
            blog_excerpt: draft.excerpt,
            seo_title: draft.seo_title,
            meta_description: draft.meta_description,
            slug: draft.slug,
            target_keyword: draft.target_keyword,
            skarleth_notes: draft.review_notes?.join('\n') || null,
            publish_date: publishDate,
          });
          if (!saved.skipped) {
            savedBlogs.push({ client_name: client.client_name, post_id: saved.post_id, day: blogDay, publish_date: publishDate, backend: result.backend });
          }
        }
      } catch (err) {
        const msg = redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 200);
        console.warn(`[blog-writer] ${client.client_name} failed: ${msg}`);
        blogErrors.push({ client: client.client_name, error: msg });
      }
    }
    const clientNames = [...new Set(savedBlogs.map((s) => s.client_name))];
    const summary = `${savedBlogs.length} blog draft(s) for ${clientNames.length} client(s)${blogErrors.length ? ` (${blogErrors.length} skipped)` : ''}.`;
    if (!savedBlogs.length && blogErrors.length) {
      throw new Error(`${summary}; first error: ${blogErrors[0].error}`);
    }
    return {
      summary,
      agent_slug: agentSlug,
      command_name: commandName,
      saved_blogs: savedBlogs,
      client_errors: blogErrors,
      safety: { status: 'draft', wordpress_published: false, no_auto_publish: true },
    };
  }

  if (agentSlug === 'editorial-review') {
    const target = taskInput.review_target
      ? {
        id: taskInput.post_id ?? taskId,
        title: `Post review: ${taskInput.review_target.title ?? taskInput.post_id ?? 'new draft'}`,
        status: 'pending_approval',
        agent_slug: 'autonomous-content',
        post_id: taskInput.post_id ?? null,
        content: taskInput.review_target,
      }
      : selectEditorialTarget(snapshot.tasks);
    const result = await runStructuredAgent('editorialReview', agentSlug, backend, target, snapshot, taskInput);
    await post('/internal/agency/content-review', {
      agent_slug: agentSlug,
      task_id: taskId,
      post_id: taskInput.post_id ?? null,
      severity: result.output.severity,
      notes_json: result.output,
    });
    return {
      summary: `Editorial review note saved with ${result.output.severity} severity.`,
      agent_slug: agentSlug,
      command_name: commandName,
      reviewed_task_id: target?.id ?? null,
      backend: result.backend,
      safety: { approval_status_changed: false, no_auto_publish: true },
    };
  }

  return buildResult(agentSlug, commandName, snapshot);
}

async function createFindingsForResult(agentSlug, taskId, result) {
  const findings = Array.isArray(result.findings) ? result.findings : Array.isArray(result.bottlenecks) ? result.bottlenecks : [];
  for (const finding of findings.slice(0, 5)) {
    if (!finding || typeof finding !== 'object') continue;
    const severity = ['info', 'low', 'medium', 'high', 'critical'].includes(finding.severity) ? finding.severity : 'info';
    await post('/internal/agency/finding', {
      agent_slug: agentSlug,
      task_id: taskId,
      severity,
      title: String(finding.title || 'Agency finding').slice(0, 200),
      finding_json: finding,
    });
  }
}

let _agentSlug = 'unknown';
let _taskId = '';
let _runId = '';
let _backend = 'internal';
try {
  await loadAiConfig();
  const context = await request(`/internal/agency/jobs/${jobId}/context`);
  const job = context.job;
  const args = JSON.parse(job.args_json || '{}');
  const agentSlug = args.agent_slug;
  _agentSlug = agentSlug || 'unknown';
  const taskId = args.task_id;
  _taskId = taskId || '';
  const backend = job.provider || 'internal';
  _backend = backend;

  if (!agentSlug || !taskId) {
    throw new Error('Agency job context is missing agent_slug or task_id');
  }

  await post(`/internal/discord/approved-jobs/${jobId}/log`, {
    level: 'START',
    message: `Agency job started: ${agentSlug}`,
  });

  // Heartbeat: mark agent as running
  await post('/internal/agency/heartbeat', {
    agent_slug: agentSlug,
    task_id: taskId,
    status: 'running',
    message: `${agentSlug} job claimed and running`,
  }).catch(() => {});

  const started = await post('/internal/agency/task-update', {
    agent_slug: agentSlug,
    task_id: taskId,
    job_id: jobId,
    status: 'running',
    progress: 10,
    summary: `Started ${agentSlug} through the approved agency harness.`,
    backend,
  });
  _runId = started.run_id || '';

  const snapshotResponse = await post('/internal/agency/snapshot', {});
  const result = await runAiPhase(agentSlug, job.command_name, backend, taskId, snapshotResponse.snapshot, args);
  if (result.fallback_used) {
    await post(`/internal/discord/approved-jobs/${jobId}/log`, {
      level: 'WARN',
      message: `Fallback backend used: ${result.primary_backend} -> ${result.backend}`,
    });
  }
  await createFindingsForResult(agentSlug, taskId, result);

  // Heartbeat: mark agent as healthy after successful run
  await post('/internal/agency/heartbeat', {
    agent_slug: agentSlug,
    task_id: taskId,
    status: 'healthy',
    message: result.summary?.slice(0, 200) || `${agentSlug} completed successfully`,
  }).catch(() => {});

  await post('/internal/agency/task-update', {
    agent_slug: agentSlug,
    task_id: taskId,
    run_id: started.run_id || undefined,
    job_id: jobId,
    status: 'completed',
    progress: 100,
    summary: result.summary,
    output_json: result,
    backend: result.backend || backend,
  });
  await post(`/internal/discord/approved-jobs/${jobId}/complete`, { result_json: result });
  console.log(`[agency-job] completed ${job.command_name} for ${agentSlug}`);
} catch (err) {
  const message = redactSecrets(err instanceof Error ? err.stack || err.message : String(err));
  console.error(message);
  try {
    await post('/internal/agency/heartbeat', {
      agent_slug: _agentSlug,
      task_id: _taskId || undefined,
      status: 'failed',
      message: message.slice(0, 200),
      error: message.slice(0, 500),
    });
  } catch { /* ignore */ }
  try {
    if (_taskId) {
      await post('/internal/agency/task-update', {
        agent_slug: _agentSlug,
        task_id: _taskId,
        run_id: _runId || undefined,
        job_id: jobId,
        status: 'failed',
        progress: 100,
        summary: `${_agentSlug} failed in approved agency harness.`,
        error: message.slice(0, 2000),
        backend: _backend,
      });
    }
  } catch (taskErr) {
    console.error(redactSecrets(taskErr instanceof Error ? taskErr.message : String(taskErr)));
  }
  try {
    await post(`/internal/discord/approved-jobs/${jobId}/fail`, { error: message });
  } catch (failErr) {
    console.error(redactSecrets(failErr instanceof Error ? failErr.message : String(failErr)));
  }
  process.exit(1);
}
