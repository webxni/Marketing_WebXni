#!/usr/bin/env node
import { redactSecrets } from './lib/agency-redaction.mjs';

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

const jobId = arg('--job-id');
const apiBaseUrl = arg('--api-base-url') || process.env.API_BASE_URL || 'https://marketing.webxni.com';
const botSecret = arg('--bot-secret') || process.env.DISCORD_BOT_SECRET || '';

if (!jobId) {
  console.error('Missing --job-id');
  process.exit(2);
}
if (!botSecret) {
  console.error('Missing --bot-secret or DISCORD_BOT_SECRET');
  process.exit(2);
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

try {
  const context = await request(`/internal/agency/jobs/${jobId}/context`);
  const job = context.job;
  const args = JSON.parse(job.args_json || '{}');
  const agentSlug = args.agent_slug;
  const taskId = args.task_id;
  const backend = job.provider || 'internal';

  if (!agentSlug || !taskId) {
    throw new Error('Agency job context is missing agent_slug or task_id');
  }

  await post(`/internal/discord/approved-jobs/${jobId}/log`, {
    level: 'START',
    message: `Agency job started: ${agentSlug}`,
  });
  await post('/internal/agency/task-update', {
    agent_slug: agentSlug,
    task_id: taskId,
    job_id: jobId,
    status: 'running',
    progress: 10,
    summary: `Started ${agentSlug} through the approved agency harness.`,
    backend,
  });

  const result = {
    summary: 'Approved agency harness foundation executed. Full AI backend prompts are intentionally deferred until the agent-specific runner phase.',
    command_name: job.command_name,
    agent_slug: agentSlug,
    safety: {
      no_arbitrary_shell: true,
      preserve_marvin_approval: true,
      preserve_designer_gate: true,
      no_auto_publish: true,
    },
    next_actions: [
      'Wire this command to the agent-specific prompt and JSON schema.',
      'Keep output in reviewable task/finding/research records before any content workflow changes.',
    ],
  };

  await post('/internal/agency/task-update', {
    agent_slug: agentSlug,
    task_id: taskId,
    job_id: jobId,
    status: 'completed',
    progress: 100,
    summary: result.summary,
    output_json: result,
    backend,
  });
  await post(`/internal/discord/approved-jobs/${jobId}/complete`, { result_json: result });
  console.log(`[agency-job] completed ${job.command_name} for ${agentSlug}`);
} catch (err) {
  const message = redactSecrets(err instanceof Error ? err.stack || err.message : String(err));
  console.error(message);
  try {
    await post(`/internal/discord/approved-jobs/${jobId}/fail`, { error: message });
  } catch (failErr) {
    console.error(redactSecrets(failErr instanceof Error ? failErr.message : String(failErr)));
  }
  process.exit(1);
}
