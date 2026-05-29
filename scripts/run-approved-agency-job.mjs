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
    const candidates = snapshot.coverage
      .filter((client) => !client.last_research_date)
      .slice(0, Number(process.env.AGENCY_DAILY_RESEARCH_CLIENT_LIMIT || process.env.GEMINI_DAILY_CLIENT_LIMIT || 2));
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
        ? ['Wire Gemini CLI research execution with source capture and daily quotas.']
        : ['All active clients have at least one research note recorded.'],
      safety,
    };
  }

  if (agentSlug === 'strategy') {
    const candidates = snapshot.coverage
      .filter((client) => client.current_strategy_status === 'none')
      .slice(0, Number(process.env.AGENCY_DAILY_STRATEGY_CLIENT_LIMIT || 3));
    return {
      summary: `Strategy planning identified ${candidates.length} client(s) needing strategy records.`,
      agent_slug: agentSlug,
      command_name: commandName,
      planned_clients: candidates.map((client) => ({
        client_id: client.client_id,
        client_name: client.client_name,
        last_research_date: client.last_research_date,
      })),
      next_actions: ['Wire Claude Code strategy prompt to save client_strategy_plans as draft only.'],
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
      next_actions: ['Wire Claude Code social draft generation so new posts stay pending approval and asset_delivered remains false.'],
      safety,
    };
  }

  if (agentSlug === 'blog-writer') {
    return {
      summary: `Blog review completed: ${overview.blogs_generated_this_week} blog draft(s) generated this week.`,
      agent_slug: agentSlug,
      command_name: commandName,
      blogs_generated_this_week: overview.blogs_generated_this_week,
      next_actions: ['Wire Claude Code blog drafting to save drafts only and never publish WordPress automatically.'],
      safety,
    };
  }

  if (agentSlug === 'editorial-review') {
    const reviewCandidates = snapshot.tasks
      .filter((task) => ['needs_review', 'queued', 'completed'].includes(task.status))
      .slice(0, 10);
    return {
      summary: `Editorial review scan found ${reviewCandidates.length} task candidate(s) for future review workflow.`,
      agent_slug: agentSlug,
      command_name: commandName,
      review_candidates: reviewCandidates.map((task) => ({
        task_id: task.id,
        title: task.title,
        status: task.status,
        agent_slug: task.agent_slug,
      })),
      next_actions: ['Wire editorial checks to content_review_notes without approving as Marvin.'],
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
  const started = await post('/internal/agency/task-update', {
    agent_slug: agentSlug,
    task_id: taskId,
    job_id: jobId,
    status: 'running',
    progress: 10,
    summary: `Started ${agentSlug} through the approved agency harness.`,
    backend,
  });

  const snapshotResponse = await post('/internal/agency/snapshot', {});
  const result = buildResult(agentSlug, job.command_name, snapshotResponse.snapshot);
  await createFindingsForResult(agentSlug, taskId, result);

  await post('/internal/agency/task-update', {
    agent_slug: agentSlug,
    task_id: taskId,
    run_id: started.run_id || undefined,
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
