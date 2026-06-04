<script lang="ts">
  import { onMount } from 'svelte';
  import { agencyApi } from '$lib/api';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { toast } from '$lib/stores/ui';
  import { timeAgo } from '$lib/utils';
  import type {
    AgencyClientCoverage,
    AgencyLog,
    AgencyOverview,
    AgencySkill,
    AgencyTimelineItem,
    AgentDefinition,
    AgentFinding,
    AgentHealthSummary,
    AgentTask,
    HarnessFlowStep,
  } from '$lib/types';

  let overview: AgencyOverview | null = null;
  let agents: AgentDefinition[] = [];
  let health: AgentHealthSummary | null = null;
  let tasks: AgentTask[] = [];
  let findings: AgentFinding[] = [];
  let clients: AgencyClientCoverage[] = [];
  let timeline: AgencyTimelineItem[] = [];
  let logs: AgencyLog[] = [];
  let skills: AgencySkill[] = [];
  let flow: HarnessFlowStep[] = [];
  let loading = true;
  let error = '';
  let runningSlug = '';

  const boardColumns = [
    ['queued', 'Queued'],
    ['running', 'Running'],
    ['needs_review', 'Needs Review'],
    ['waiting_marvin', 'Waiting for Marvin'],
    ['waiting_designer', 'Waiting for Designer'],
    ['ready_for_automation', 'Ready for Automation'],
    ['completed', 'Completed'],
    ['failed', 'Failed'],
  ];

  onMount(loadAgency);

  async function loadAgency() {
    loading = true;
    error = '';
    try {
      const [overviewRes, agentsRes, healthRes, tasksRes, findingsRes, clientsRes, timelineRes, logsRes, skillsRes, flowRes] = await Promise.all([
        agencyApi.overview(),
        agencyApi.agents(),
        agencyApi.health(),
        agencyApi.tasks(),
        agencyApi.findings(),
        agencyApi.clientCoverage(),
        agencyApi.timeline(),
        agencyApi.logs(),
        agencyApi.skills(),
        agencyApi.harnessFlow(),
      ]);
      overview = overviewRes;
      agents = agentsRes.agents;
      health = healthRes;
      tasks = tasksRes.tasks;
      findings = findingsRes.findings;
      clients = clientsRes.clients;
      timeline = timelineRes.items;
      logs = logsRes.logs;
      skills = skillsRes.skills;
      flow = flowRes.steps;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function runAgent(slug: string) {
    runningSlug = slug;
    try {
      const result = await agencyApi.runAgent(slug);
      toast.success(`Queued ${result.command_name}`);
      await loadAgency();
    } catch (e) {
      toast.error(`Failed to queue agent: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      runningSlug = '';
    }
  }

  async function acknowledge(id: string) {
    try {
      await agencyApi.acknowledgeFinding(id);
      findings = findings.map((finding) => finding.id === id ? { ...finding, status: 'acknowledged' } : finding);
      toast.success('Finding acknowledged');
    } catch (e) {
      toast.error(`Failed to acknowledge: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function taskColumn(status: string) {
    if (status === 'reviewed') return 'completed';
    if (status === 'pending_approval') return 'waiting_marvin';
    return status;
  }

  function tasksFor(status: string) {
    return tasks.filter((task) => taskColumn(task.status) === status).slice(0, 8);
  }

  function pipelineSteps() {
    const p = overview?.approval_pipeline;
    if (!p) return [];
    const clientTotal = p.active_clients;
    return [
      {
        label: 'Research complete',
        count: p.research_complete_clients,
        total: clientTotal,
        detail: `${p.research_complete_clients}/${clientTotal} active clients`,
        status: p.research_complete_clients === clientTotal && clientTotal > 0 ? 'completed' : 'waiting',
        href: '#coverage',
      },
      {
        label: 'Strategy complete',
        count: p.strategy_complete_clients,
        total: clientTotal,
        detail: `${p.strategy_complete_clients}/${clientTotal} active clients`,
        status: p.strategy_complete_clients === clientTotal && clientTotal > 0 ? 'completed' : 'waiting',
        href: '#coverage',
      },
      {
        label: 'Copy generated',
        count: p.generated_drafts,
        detail: `${p.generated_drafts} generated draft${p.generated_drafts === 1 ? '' : 's'}`,
        status: p.generated_drafts > 0 ? 'running' : 'idle',
        href: '/posts?status=draft',
      },
      {
        label: 'Editorial reviewed',
        count: p.editorial_reviews_this_week,
        detail: `${p.editorial_reviews_this_week} review note${p.editorial_reviews_this_week === 1 ? '' : 's'} this week`,
        status: p.editorial_reviews_this_week > 0 ? 'completed' : 'idle',
        href: '#tasks',
      },
      {
        label: 'Waiting for Marvin approval',
        count: p.waiting_marvin_approval,
        detail: `${p.waiting_marvin_approval} post${p.waiting_marvin_approval === 1 ? '' : 's'} pending approval`,
        status: p.waiting_marvin_approval > 0 ? 'waiting' : 'idle',
        href: '/approvals',
      },
      {
        label: 'Waiting for designer asset',
        count: p.waiting_designer_assets,
        detail: `${p.waiting_designer_assets} approved post${p.waiting_designer_assets === 1 ? '' : 's'} missing assets`,
        status: p.waiting_designer_assets > 0 ? 'waiting' : 'idle',
        href: '/posts?status=approved',
      },
      {
        label: 'Ready for automation',
        count: p.ready_for_automation,
        detail: `${p.ready_for_automation} post${p.ready_for_automation === 1 ? '' : 's'} ready`,
        status: p.ready_for_automation > 0 ? 'completed' : 'idle',
        href: '/posts?status=ready',
      },
      {
        label: 'Scheduled / Posted',
        count: p.scheduled_or_posted_this_week,
        detail: `${p.scheduled_or_posted_this_week} scheduled or posted this week`,
        status: p.scheduled_or_posted_this_week > 0 ? 'completed' : 'idle',
        href: '/posts?status=scheduled',
      },
    ];
  }

  function statusClass(status: string) {
    if (status === 'running') return 'badge-running';
    if (status === 'completed') return 'badge-completed';
    if (status === 'failed' || status === 'critical' || status === 'high') return 'badge-failed';
    if (status === 'waiting' || status === 'queued' || status === 'medium') return 'badge-pending';
    if (status === 'upcoming' || status === 'idle') return 'badge-draft';
    return 'badge-approved';
  }

  function progressWidth(value: number) {
    return `width: ${Math.max(0, Math.min(100, value))}%`;
  }

  function heartbeatDotClass(hs: string): string {
    if (hs === 'healthy' || hs === 'running') return 'hb-dot-green';
    if (hs === 'idle' || hs === 'paused') return 'hb-dot-gray';
    if (hs === 'waiting_for_approval' || hs === 'waiting_for_designer' || hs === 'warning') return 'hb-dot-yellow';
    if (hs === 'stale' || hs === 'failed') return 'hb-dot-red';
    return 'hb-dot-gray';
  }

  function heartbeatLabel(hs: string): string {
    return hs.replace(/_/g, ' ');
  }

  function fmtHbTime(ts: number | null): string {
    if (!ts) return 'Never';
    return timeAgo(ts);
  }

  function fmtNextHb(ts: number | null): string {
    if (!ts) return '—';
    const nowSec = Math.floor(Date.now() / 1000);
    const diffMin = Math.floor((ts - nowSec) / 60);
    if (diffMin < 0) return 'Overdue';
    if (diffMin < 60) return `in ${diffMin}m`;
    return `in ${Math.floor(diffMin / 60)}h`;
  }

  $: staleCount = health ? (health.summary['stale'] ?? 0) : 0;
  $: failedHbCount = health ? (health.summary['failed'] ?? 0) : 0;
  $: runningCount = health ? (health.summary['running'] ?? 0) : 0;
  $: healthyCount = health ? (health.summary['healthy'] ?? 0) : 0;
</script>

<svelte:head><title>AI Agency — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">AI Agency</h1>
    <p class="page-subtitle">Autonomous marketing operations with Marvin approval and designer asset gates</p>
  </div>
  <div class="flex gap-2 shrink-0">
    <button class="btn-secondary btn-sm" on:click={loadAgency}>Refresh</button>
    <button class="btn-primary btn-sm" disabled={runningSlug !== ''} on:click={() => runAgent('agency-orchestrator')}>
      {runningSlug === 'agency-orchestrator' ? 'Queuing...' : 'Run Orchestrator'}
    </button>
  </div>
</div>

{#if loading}
  <div class="flex flex-col items-center justify-center py-24 gap-3">
    <Spinner size="lg" />
    <p class="text-sm text-muted">Loading agency dashboard...</p>
  </div>
{:else if error}
  <div class="alert-error rounded-lg mb-6">{error}</div>
{:else}
  {#if staleCount > 0 || failedHbCount > 0}
    <div class="alert-error mb-4 flex items-center gap-3">
      <span class="font-semibold">⚠️ Agent health alert</span>
      <span>{staleCount} stale{failedHbCount > 0 ? `, ${failedHbCount} failed heartbeat` : ''} — check the Agent Health section below.</span>
    </div>
  {:else if overview && (overview.failed_agent_jobs > 0 || overview.waiting_marvin_approval > 0 || overview.waiting_designer_assets > 0)}
    <div class="alert-warning mb-5">
      <span class="font-semibold">Agency attention needed</span>
      <span>{overview.failed_agent_jobs} failed jobs, {overview.waiting_marvin_approval} approvals, {overview.waiting_designer_assets} designer assets.</span>
    </div>
  {/if}

  {#if health}
    <section id="agent-health" class="card mb-5">
      <div class="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 class="section-title">Agent Health</h2>
        <span class="text-xs text-muted">Heartbeat monitoring</span>
      </div>
      <div class="p-4">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div class="rounded-lg bg-surface/50 border border-border p-3 text-center">
            <div class="text-lg font-bold text-green-400">{healthyCount}</div>
            <div class="text-xs text-muted mt-1">Healthy</div>
          </div>
          <div class="rounded-lg bg-surface/50 border border-border p-3 text-center">
            <div class="text-lg font-bold text-blue-400">{runningCount}</div>
            <div class="text-xs text-muted mt-1">Running</div>
          </div>
          <div class="rounded-lg bg-surface/50 border border-border p-3 text-center">
            <div class="text-lg font-bold {staleCount > 0 ? 'text-red-400' : 'text-muted'}">{staleCount}</div>
            <div class="text-xs text-muted mt-1">Stale</div>
          </div>
          <div class="rounded-lg bg-surface/50 border border-border p-3 text-center">
            <div class="text-lg font-bold {failedHbCount > 0 ? 'text-red-400' : 'text-muted'}">{failedHbCount}</div>
            <div class="text-xs text-muted mt-1">Failed</div>
          </div>
        </div>
        {#if health.stale_agents.length > 0}
          <div class="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
            <div class="text-xs font-semibold text-red-400 mb-2">Stale agents — missed heartbeat window</div>
            <div class="space-y-1">
              {#each health.stale_agents as sa}
                <div class="flex items-center justify-between text-xs">
                  <span class="text-white">{sa.name}</span>
                  <span class="text-muted">Last: {fmtHbTime(sa.last_heartbeat_at)} · Window: {sa.stale_after_minutes}m</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </section>
  {/if}

  {#if overview}
    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-3 mb-5">
      <a href="#agents" class="metric-card"><div class="metric-value">{overview.active_agents}</div><div class="metric-label">Active Agents</div></a>
      <a href="#tasks" class="metric-card"><div class="metric-value">{overview.running_tasks}</div><div class="metric-label">Running Tasks</div></a>
      <a href="/approvals" class="metric-card"><div class="metric-value">{overview.waiting_marvin_approval}</div><div class="metric-label">Marvin Approval</div></a>
      <a href="/posts" class="metric-card"><div class="metric-value">{overview.waiting_designer_assets}</div><div class="metric-label">Designer Assets</div></a>
      <a href="#findings" class="metric-card"><div class="metric-value">{overview.failed_agent_jobs}</div><div class="metric-label">Failed Jobs</div></a>
      <a href="#tasks" class="metric-card"><div class="metric-value">{overview.completed_this_week}</div><div class="metric-label">Done This Week</div></a>
      <a href="#coverage" class="metric-card"><div class="metric-value">{overview.research_completed_this_week}</div><div class="metric-label">Research</div></a>
      <a href="/posts" class="metric-card"><div class="metric-value">{overview.posts_generated_this_week}</div><div class="metric-label">Posts Generated</div></a>
      <a href="/posts?content_type=blog" class="metric-card"><div class="metric-value">{overview.blogs_generated_this_week}</div><div class="metric-label">Blogs Generated</div></a>
    </div>
  {/if}

  <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)] gap-5">
    <div class="space-y-5">
      <section id="agents" class="card">
        <div class="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 class="section-title">Agent Status</h2>
          <span class="text-xs text-muted">{agents.length} agents</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
          {#each agents as agent}
            {@const hbStatus = agent.heartbeat_status ?? 'idle'}
            <div class="border border-border rounded-lg p-4 bg-surface/40 {hbStatus === 'stale' || hbStatus === 'failed' ? 'border-red-500/40' : ''}">
              <div class="flex items-start justify-between gap-3 mb-2">
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-white truncate">{agent.name}</h3>
                  <p class="text-xs text-muted mt-1 line-clamp-2">{agent.purpose}</p>
                </div>
                <div class="flex flex-col items-end gap-1 shrink-0">
                  <span class={statusClass(agent.status)}>{agent.status}</span>
                  <span class="hb-badge">
                    <span class="hb-dot {heartbeatDotClass(hbStatus)}"></span>
                    {heartbeatLabel(hbStatus)}
                  </span>
                </div>
              </div>
              <div class="space-y-2 text-xs text-muted">
                <div class="flex justify-between gap-3"><span>Backend</span><span class="text-white">{agent.default_backend.replace(/_/g, ' ')}</span></div>
                <div class="flex justify-between gap-3"><span>Current task</span><span class="text-white truncate">{agent.current_task ?? 'Idle'}</span></div>
                <div class="flex justify-between gap-3"><span>Last run</span><span class="text-white">{agent.last_run_at ? timeAgo(agent.last_run_at) : 'Never'}</span></div>
                <div class="flex justify-between gap-3"><span>Last heartbeat</span><span class="text-white">{fmtHbTime(agent.last_heartbeat_at)}</span></div>
                <div class="flex justify-between gap-3"><span>Next expected</span><span class="text-white">{fmtNextHb(agent.next_expected_heartbeat_at)}</span></div>
              </div>
              {#if agent.heartbeat_message}
                <div class="mt-2 text-xs text-muted truncate" title={agent.heartbeat_message}>{agent.heartbeat_message}</div>
              {/if}
              <div class="h-1.5 bg-bg rounded-full overflow-hidden mt-3">
                <div class="h-full bg-accent" style={progressWidth(agent.progress)}></div>
              </div>
              <div class="flex gap-2 mt-3">
                <button class="btn-secondary btn-sm flex-1 justify-center" on:click={() => runAgent(agent.slug)} disabled={runningSlug !== ''}>
                  {runningSlug === agent.slug ? 'Queuing...' : 'Run Now'}
                </button>
                <a class="btn-ghost btn-sm" href="#logs">Logs</a>
              </div>
            </div>
          {/each}
        </div>
      </section>

      <section class="card">
        <div class="px-5 py-4 border-b border-border">
          <h2 class="section-title">Weekly Agency Timeline</h2>
        </div>
        <div class="divide-y divide-border">
          {#each timeline as item}
            <div class="px-5 py-3 flex items-center gap-3">
              <div class="w-20 text-xs font-medium text-white shrink-0">{item.day}</div>
              <div class="min-w-0 flex-1">
                <div class="text-sm text-white">{item.title}</div>
                <div class="text-xs text-muted">{item.summary}</div>
              </div>
              <span class={statusClass(item.status)}>{item.status}</span>
            </div>
          {/each}
        </div>
      </section>

      <section id="tasks" class="card">
        <div class="px-5 py-4 border-b border-border">
          <h2 class="section-title">Agent Task Board</h2>
        </div>
        <div class="overflow-x-auto p-3">
          <div class="grid grid-cols-8 gap-3 min-w-[1180px]">
            {#each boardColumns as column}
              <div class="bg-surface/45 border border-border rounded-lg min-h-56">
                <div class="px-3 py-2 border-b border-border text-xs font-semibold text-muted uppercase">{column[1]}</div>
                <div class="p-2 space-y-2">
                  {#each tasksFor(column[0]) as task}
                    <div class="rounded-md bg-card border border-border p-3">
                      <div class="text-xs font-medium text-white line-clamp-2">{task.title}</div>
                      <div class="text-[11px] text-muted mt-1">{task.agent_name ?? task.agent_slug}</div>
                      {#if task.client_name}<div class="text-[11px] text-muted">{task.client_name}</div>{/if}
                      <div class="flex items-center justify-between mt-2">
                        <span class={statusClass(task.priority)}>{task.priority}</span>
                        <span class="text-[11px] text-muted">{task.progress}%</span>
                      </div>
                    </div>
                  {:else}
                    <div class="text-xs text-muted p-2">No tasks.</div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      </section>

      <section id="coverage" class="card">
        <div class="px-5 py-4 border-b border-border">
          <h2 class="section-title">Client Coverage</h2>
        </div>
        <div class="table-wrapper border-0 rounded-none">
          <table class="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Research</th>
                <th>Strategy</th>
                <th>Posts</th>
                <th>Approvals</th>
                <th>Designer</th>
                <th>Blogs</th>
                <th>Next Action</th>
              </tr>
            </thead>
            <tbody>
              {#each clients as client}
                <tr>
                  <td>
                    <div class="font-medium text-white">{client.client_name}</div>
                    <div class="text-xs text-muted">{client.package ?? 'No package'}</div>
                  </td>
                  <td>{client.last_research_date ?? 'None'}</td>
                  <td>{client.current_strategy_status}</td>
                  <td>{client.posts_generated}/{client.posts_planned}</td>
                  <td>{client.posts_waiting_approval}</td>
                  <td>{client.posts_waiting_designer}</td>
                  <td>{client.blogs_drafted}/{client.blogs_planned}</td>
                  <td>{client.next_agent_action}</td>
                </tr>
              {:else}
                <tr><td colspan="8" class="text-center text-muted py-10">No active client coverage yet.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div class="space-y-5">
      <section class="card">
        <div class="px-5 py-4 border-b border-border"><h2 class="section-title">Approval Pipeline</h2></div>
        <div class="p-4 space-y-3">
          {#each pipelineSteps() as step, index}
            <div class="flex items-center gap-3">
              <div class="w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-semibold shrink-0">{index + 1}</div>
              <a href={step.href} class="min-w-0 flex-1 hover:text-white">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-sm text-white truncate">{step.label}</div>
                  <span class={statusClass(step.status)}>{step.count}</span>
                </div>
                <div class="text-xs text-muted mt-0.5 truncate">{step.detail}</div>
              </a>
            </div>
          {:else}
            <p class="text-sm text-muted">Pipeline counts are unavailable.</p>
          {/each}
        </div>
      </section>

      <section id="findings" class="card">
        <div class="px-5 py-4 border-b border-border"><h2 class="section-title">Agent Findings</h2></div>
        <div class="divide-y divide-border">
          {#each findings.slice(0, 8) as finding}
            <div class="px-5 py-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm text-white">{finding.title}</div>
                  <div class="text-xs text-muted">{finding.agent_name ?? finding.agent_slug}{finding.client_name ? ` · ${finding.client_name}` : ''}</div>
                </div>
                <span class={statusClass(finding.severity)}>{finding.severity}</span>
              </div>
              {#if finding.status === 'open'}
                <button class="btn-ghost btn-sm mt-2" on:click={() => acknowledge(finding.id)}>Acknowledge</button>
              {/if}
            </div>
          {:else}
            <p class="px-5 py-10 text-center text-sm text-muted">No findings.</p>
          {/each}
        </div>
      </section>

      <section class="card">
        <div class="px-5 py-4 border-b border-border"><h2 class="section-title">Claude Skills</h2></div>
        <div class="p-3 grid grid-cols-1 gap-2">
          {#each skills as skill}
            <div class="border border-border rounded-lg p-3 bg-surface/40">
              <div class="flex justify-between gap-3">
                <div class="text-sm font-medium text-white truncate">{skill.name}</div>
                <span class={statusClass(skill.status)}>{skill.status}</span>
              </div>
              <div class="text-xs text-muted mt-1">{skill.purpose}</div>
              <div class="text-xs text-muted mt-2">Backend: {skill.backend}</div>
            </div>
          {/each}
        </div>
      </section>

      <section class="card">
        <div class="px-5 py-4 border-b border-border"><h2 class="section-title">Harness Flow</h2></div>
        <div class="p-4 space-y-3">
          {#each flow as step}
            <div class="flex gap-3">
              <div class="text-xs text-accent font-semibold w-6 shrink-0">{step.order}</div>
              <div>
                <div class="text-sm text-white">{step.title}</div>
                <div class="text-xs text-muted">{step.summary}</div>
              </div>
            </div>
          {/each}
        </div>
      </section>

      <section id="logs" class="card">
        <div class="px-5 py-4 border-b border-border"><h2 class="section-title">Recent Agent Logs</h2></div>
        <div class="divide-y divide-border">
          {#each logs.slice(0, 10) as log}
            <div class="px-5 py-3">
              <div class="flex items-center justify-between gap-3">
                <div class="text-sm text-white">{log.agent_name ?? log.agent_slug ?? 'Agency'}</div>
                <span class={statusClass(log.status)}>{log.status}</span>
              </div>
              <div class="text-xs text-muted mt-1">{log.summary}</div>
              <div class="text-[11px] text-muted mt-1">{timeAgo(log.created_at)}</div>
            </div>
          {:else}
            <p class="px-5 py-10 text-center text-sm text-muted">No agent logs yet.</p>
          {/each}
        </div>
      </section>
    </div>
  </div>
{/if}

<style>
  .hb-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-muted, #6b7280);
    white-space: nowrap;
  }
  .hb-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .hb-dot-green  { background: #4ade80; box-shadow: 0 0 4px #4ade8080; }
  .hb-dot-gray   { background: #6b7280; }
  .hb-dot-yellow { background: #facc15; box-shadow: 0 0 4px #facc1580; }
  .hb-dot-red    { background: #f87171; box-shadow: 0 0 4px #f8717180; }
</style>
