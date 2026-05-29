import type { Env } from '../types';
import {
  appendAgencyLog,
  createAgentTask,
  createApprovedCommandJob,
  getLatestAuditMarker,
  listAgentDefinitions,
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
};

const DAILY_AGENTS = ['security-sentinel', 'system-reliability', 'client-research'];
const WEEKLY_AGENTS = ['strategy', 'blog-writer', 'social-copy', 'editorial-review', 'agency-orchestrator'];

export interface AgencySchedulerStats {
  enabled: boolean;
  requested: string[];
  queued: number;
  skipped: number;
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
  const today = now.getUTCDay();
  if (today === 0) return [...DAILY_AGENTS, ...WEEKLY_AGENTS];
  return DAILY_AGENTS;
}

export async function runAgencyScheduler(env: Env, now = new Date()): Promise<AgencySchedulerStats> {
  const requested = requestedAgents(now);
  const enabled = await agencySchedulerEnabled(env);
  if (!enabled) return { enabled, requested, queued: 0, skipped: requested.length };

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

  return { enabled, requested, queued, skipped };
}
