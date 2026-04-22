<script lang="ts">
  import { onMount } from 'svelte';
  import { reportsApi, runApi } from '$lib/api';
  import MetricCard from '$lib/components/ui/MetricCard.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { toast } from '$lib/stores/ui';
  import { formatDate, parseStats, timeAgo } from '$lib/utils';
  import type { OverviewStats, PostingJob } from '$lib/types';

  let stats:     OverviewStats | null = null;
  let loading    = true;
  let error      = '';
  let triggering = false;

  onMount(async () => {
    try {
      stats = await reportsApi.overview();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error = msg.includes('401') ? 'Session expired — please log in again.' : `Failed to load dashboard: ${msg}`;
      console.error('[Dashboard] overview fetch failed:', e);
    } finally {
      loading = false;
    }
  });

  async function triggerPosting(dryRun: boolean) {
    triggering = true;
    try {
      const { job_id, mode } = await runApi.triggerPosting({ dry_run: dryRun });
      toast.success(`Job started (${mode}) — ID: ${job_id.slice(0, 8)}…`);
    } catch (e) { toast.error(`Failed to start job: ${e}`); }
    finally { triggering = false; }
  }

  function jobStats(job: PostingJob) {
    const s = parseStats(job.stats_json);
    return `${s.posted} posted · ${s.failed} failed · ${s.skipped} skipped`;
  }

  function jobStatusColor(job: PostingJob): string {
    if (job.status === 'completed') return 'text-emerald-400';
    if (job.status === 'failed') return 'text-red-400';
    if (job.status === 'running') return 'text-blue-400';
    return 'text-muted';
  }
</script>

<svelte:head><title>Dashboard — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Dashboard</h1>
    <p class="page-subtitle">Marketing automation overview</p>
  </div>
  <div class="flex gap-2 shrink-0">
    <button
      class="btn-secondary btn-sm"
      disabled={triggering}
      title="Validates posts and simulates posting without publishing anything. Safe to run anytime."
      on:click={() => triggerPosting(true)}
    >{triggering ? 'Starting…' : 'Dry Run'}</button>
    <button
      class="btn-primary btn-sm"
      disabled={triggering}
      title="Picks up all Ready posts and submits them to Upload-Post and WordPress."
      on:click={() => triggerPosting(false)}
    >{triggering ? 'Starting…' : 'Run Posting'}</button>
  </div>
</div>

{#if loading}
  <div class="flex flex-col items-center justify-center py-24 gap-3">
    <Spinner size="lg" />
    <p class="text-sm text-muted">Loading dashboard…</p>
  </div>
{:else if error}
  <div class="alert-error rounded-lg mb-6">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="shrink-0">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span>{error}</span>
  </div>
{:else if stats}
  <!-- Pending approvals banner -->
  {#if stats.pending_approvals > 0}
  <div class="alert-warning rounded-lg mb-5">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="shrink-0">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    <span class="font-semibold">{stats.pending_approvals}</span>
    <span>post{stats.pending_approvals !== 1 ? 's' : ''} waiting for approval</span>
    <a href="/approvals" class="ml-auto text-xs font-medium underline hover:no-underline shrink-0">Review now →</a>
  </div>
  {/if}

  <!-- Metrics — two rows of 4 for better readability -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
    <MetricCard label="Active Clients"  value={stats.clients}           href="/clients" />
    <MetricCard label="Total Posts"     value={stats.total_posts}       href="/posts" />
    <MetricCard label="Posted"          value={stats.posted}            color="success" href="/reports" />
    <MetricCard label="Failed"          value={stats.failed}            href="/posts?status=failed" color={stats.failed > 0 ? 'error' : 'default'} />
  </div>
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
    <MetricCard label="Scheduled"       value={stats.scheduled ?? 0}   href="/posts?status=scheduled" />
    <MetricCard label="Ready"           value={stats.ready ?? 0}        href="/posts?status=ready" />
    <MetricCard label="Pending Review"  value={stats.pending_approvals} color={stats.pending_approvals > 0 ? 'warning' : 'default'} href="/approvals" />
    <MetricCard label="Drafts"          value={stats.drafts ?? 0}       href="/posts?status=draft" />
  </div>

  <!-- Two columns -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
    <!-- Recent Jobs -->
    <div class="card">
      <div class="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 class="section-title">Recent Jobs</h2>
        <a href="/automation" class="text-xs text-accent hover:underline">View all →</a>
      </div>
      {#if stats.recent_jobs.length === 0}
        <p class="px-5 py-10 text-center text-sm text-muted">No jobs yet — trigger a run above.</p>
      {:else}
        <div class="divide-y divide-border">
          {#each stats.recent_jobs as job}
            <div class="px-5 py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors">
              <div class="min-w-0">
                <div class="flex items-center gap-2 mb-0.5 flex-wrap">
                  <Badge status={job.status} />
                  <span class="text-xs {job.mode === 'dry_run' ? 'text-amber-400' : 'text-muted'} capitalize">
                    {job.mode.replace(/_/g, ' ')}
                  </span>
                  {#if job.client_filter}
                    <span class="text-xs text-muted truncate">· {job.client_filter}</span>
                  {/if}
                </div>
                <div class="text-xs text-muted">{jobStats(job)}</div>
              </div>
              <span class="text-xs text-muted shrink-0">{timeAgo(job.created_at)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Quick Actions -->
    <div class="card">
      <div class="px-5 py-4 border-b border-border">
        <h2 class="section-title">Quick Actions</h2>
      </div>
      <div class="p-3 space-y-1.5">
        <a href="/posts/new" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface transition-colors group">
          <span class="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-sm shrink-0 group-hover:bg-accent/20 transition-colors">✦</span>
          <div class="min-w-0">
            <div class="text-sm font-medium text-white">Create Post</div>
            <div class="text-xs text-muted">Draft new content for any platform</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="ml-auto text-muted/40 group-hover:text-muted transition-colors shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
        </a>
        <a href="/approvals" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface transition-colors group">
          <span class="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-400 text-sm shrink-0 group-hover:bg-sky-500/20 transition-colors">✓</span>
          <div class="min-w-0">
            <div class="text-sm font-medium text-white">Review Approvals</div>
            <div class="text-xs text-muted">
              {stats.pending_approvals > 0 ? `${stats.pending_approvals} posts waiting` : 'All clear'}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="ml-auto text-muted/40 group-hover:text-muted transition-colors shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
        </a>
        <a href="/calendar" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface transition-colors group">
          <span class="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-400 text-sm shrink-0 group-hover:bg-teal-500/20 transition-colors">◫</span>
          <div class="min-w-0">
            <div class="text-sm font-medium text-white">Content Calendar</div>
            <div class="text-xs text-muted">View scheduled posts by date</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="ml-auto text-muted/40 group-hover:text-muted transition-colors shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
        </a>
        <a href="/reports" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface transition-colors group">
          <span class="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 text-sm shrink-0 group-hover:bg-violet-500/20 transition-colors">▣</span>
          <div class="min-w-0">
            <div class="text-sm font-medium text-white">Reports</div>
            <div class="text-xs text-muted">Per-client and platform analytics</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="ml-auto text-muted/40 group-hover:text-muted transition-colors shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
        </a>
        <a href="/clients" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface transition-colors group">
          <span class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-sm shrink-0 group-hover:bg-emerald-500/20 transition-colors">◉</span>
          <div class="min-w-0">
            <div class="text-sm font-medium text-white">Manage Clients</div>
            <div class="text-xs text-muted">{stats.clients} active clients</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="ml-auto text-muted/40 group-hover:text-muted transition-colors shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
        </a>
      </div>
    </div>
  </div>
{/if}
