import type { Env } from '../types';
import {
  appendAgencyLog,
  checkStaleAgents,
  createAgentFinding,
  createAgentTask,
  createApprovedCommandJob,
  getAgentHealthSummary,
  getLatestAuditMarker,
  listAgentDefinitions,
  markAgentStale,
  updateAgentTask,
  writeAuditLog,
} from '../db/queries';

const AGENT_COMMANDS: Record<string, string> = {
  'agency-orchestrator': 'agency_orchestrator',
  'system-reliability': 'agency_system_review',
  'security-sentinel': 'agency_security_review',
  'client-research': 'agency_client_research',
  strategy: 'agency_strategy',
  'social-copy': 'agency_social_generation',
  'blog-writer': 'agency_blog_generation',
  'editorial-review': 'agency_editorial_review',
  'client-onboarding': 'agency_client_onboarding',
};

// Complex agents lead with Claude (Hermes is gpt-5.4-mini — too small for
// long-form/strategy/editorial/self-review work). Simpler agents lead with
// Hermes. Hermes always remains in the chain as a fallback.
const AGENT_BACKEND_PRIORITY: Record<string, string[]> = {
  'agency-orchestrator': ['hermes', 'claude_code', 'codex', 'openai'],
  'system-reliability': ['claude_code', 'hermes', 'codex', 'openai'],
  'security-sentinel': ['hermes', 'claude_code', 'codex', 'openai'],
  'client-research': ['hermes', 'gemini_cli', 'openai'],
  strategy: ['claude_code', 'hermes', 'codex', 'openai'],
  'social-copy': ['hermes', 'claude_code', 'codex', 'openai'],
  'blog-writer': ['claude_code', 'hermes', 'codex', 'openai'],
  'editorial-review': ['claude_code', 'hermes', 'codex', 'openai'],
  'client-onboarding': ['hermes', 'claude_code', 'codex', 'openai'],
};

// Weekend schedule — tasks run Friday night through Sunday.
// Mon–Thu: stale detection only, no job enqueueing.
// Orchestrator always runs daily after review agents so it can compile findings and notify Discord.
const DAILY_REVIEW_AGENTS = ['security-sentinel', 'system-reliability', 'agency-orchestrator'];

const SCHEDULE: Record<string, string[]> = {
  // Friday 10PM UTC — kick off the weekend sequence
  'fri-night':  [...DAILY_REVIEW_AGENTS, 'client-research'],
  // Saturday morning (UTC midnight–1PM) — research + strategy
  'sat-morning': ['client-research', 'strategy'],
  // Saturday afternoon (UTC 14+) — blog drafts + editorial
  'sat-afternoon': ['blog-writer', 'editorial-review'],
  // Sunday morning (UTC midnight–1PM) — social copy + editorial
  'sun-morning': ['social-copy', 'editorial-review'],
  // Sunday afternoon (UTC 14+) — orchestrator wrap-up
  'sun-afternoon': ['agency-orchestrator'],
};

export interface AgencySchedulerStats {
  enabled: boolean;
  requested: string[];
  queued: number;
  skipped: number;
  stale_marked: string[];
  health_summary: Record<string, number>;
}

async function agencySchedulerEnabled(env: Env): Promise<boolean> {
  if (env.AGENCY_SCHEDULER_ENABLED === 'true') return true;
  try {
    const raw = await env.KV_BINDING.get('settings:system');
    const settings = raw ? JSON.parse(raw) as Record<string, string> : {};
    return settings['agency_scheduler_enabled'] === 'true';
  } catch {
    return false;
  }
}

function requestedAgents(now: Date): string[] {
  const day  = now.getUTCDay();   // 0=Sun 1=Mon … 5=Fri 6=Sat
  const hour = now.getUTCHours();

  if (day === 5 && hour >= 20) return SCHEDULE['fri-night']!;      // Fri 8PM+
  if (day === 6 && hour < 14)  return SCHEDULE['sat-morning']!;    // Sat AM
  if (day === 6 && hour >= 14) return SCHEDULE['sat-afternoon']!;  // Sat PM
  if (day === 0 && hour < 14)  return SCHEDULE['sun-morning']!;    // Sun AM
  if (day === 0 && hour >= 14) return SCHEDULE['sun-afternoon']!;  // Sun PM

  // Mon–Thu: security + system review + orchestrator report runs daily
  return DAILY_REVIEW_AGENTS;
}

/**
 * Detect agents whose heartbeat window has elapsed, mark them stale, record a
 * finding + log line, and return the slugs marked. Centralized so both the
 * weekend scheduler and the per-minute cron use identical logic.
 */
export async function runAgentStaleSweep(env: Env): Promise<string[]> {
  const staleAgents = await checkStaleAgents(env.DB);
  const stale_marked: string[] = [];
  for (const agent of staleAgents) {
    const msg = `Missed heartbeat window (${agent.stale_after_minutes}m)`;
    await markAgentStale(env.DB, agent.slug, msg);
    await createAgentFinding(env.DB, {
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
    await appendAgencyLog(env.DB, {
      agent_slug: agent.slug,
      task_id: null,
      status: 'stale',
      step: 'stale_check',
      summary: `${agent.name} marked stale — ${msg}`,
    });
    stale_marked.push(agent.slug);
  }
  return stale_marked;
}

export async function runAgencyScheduler(env: Env, now = new Date()): Promise<AgencySchedulerStats> {
  const requested = requestedAgents(now);
  const enabled = await agencySchedulerEnabled(env);
  if (!enabled) {
    const stale_marked = await runAgentStaleSweep(env);
    const health_summary = await getAgentHealthSummary(env.DB);
    return { enabled, requested, queued: 0, skipped: requested.length, stale_marked, health_summary };
  }

  const agents = await listAgentDefinitions(env.DB);
  let queued = 0;
  let skipped = 0;
  const dayKey = now.toISOString().slice(0, 10);

  for (const agentSlug of requested) {
    const agent = agents.find((item) => item.slug === agentSlug);
    const commandName = AGENT_COMMANDS[agentSlug];
    if (!agent || agent.enabled !== 1 || !commandName) {
      skipped++;
      continue;
    }

    const dedupeKey = `${dayKey}:${agentSlug}`;
    const previous = await getLatestAuditMarker(env.DB, 'agency.scheduler.enqueue', 'agent_schedule', dedupeKey);
    if (previous) {
      skipped++;
      continue;
    }

    const task = await createAgentTask(env.DB, {
      agent_slug: agentSlug,
      title: `Scheduled ${agent.name} run`,
      input_json: JSON.stringify({ requested_from: 'agency_scheduler', day_key: dayKey }),
    });
    const job = await createApprovedCommandJob(env.DB, {
      generation_run_id: null,
      command_name: commandName,
      provider: agent.default_backend,
      requested_by: 'agency_scheduler',
      args_json: JSON.stringify({
        agent_slug: agentSlug,
        task_id: task.id,
        source: 'agency_scheduler',
        day_key: dayKey,
        backend_priority: AGENT_BACKEND_PRIORITY[agentSlug] ?? ['hermes', 'openai'],
        safety: {
          no_arbitrary_shell: true,
          preserve_marvin_approval: true,
          preserve_designer_gate: true,
        },
      }),
    });
    await updateAgentTask(env.DB, task.id, { approved_job_id: job.id, status: 'queued', progress: 0 });
    await appendAgencyLog(env.DB, {
      agent_slug: agentSlug,
      task_id: task.id,
      job_id: job.id,
      status: 'queued',
      step: 'scheduler',
      summary: `${agent.name} queued by agency scheduler.`,
      backend: agent.default_backend,
    });
    await writeAuditLog(env.DB, {
      action: 'agency.scheduler.enqueue',
      entity_type: 'agent_schedule',
      entity_id: dedupeKey,
      new_value: { agent_slug: agentSlug, command_name: commandName, job_id: job.id },
    });
    queued++;
  }

  // Stale detection — runs every cron tick regardless of scheduler enabled flag
  const stale_marked = await runAgentStaleSweep(env);

  const health_summary = await getAgentHealthSummary(env.DB);

  return { enabled, requested, queued, skipped, stale_marked, health_summary };
}
