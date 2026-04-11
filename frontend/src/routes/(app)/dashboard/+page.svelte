<script lang="ts">
  import { onMount } from 'svelte';
  import { reportsApi, runApi } from '$lib/api';
  import MetricCard from '$lib/components/ui/MetricCard.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { toast } from '$lib/stores/ui';
  import { formatDate, parseStats, timeAgo } from '$lib/utils';
  import type { OverviewStats, PostingJob } from '$lib/types';

  let stats:   OverviewStats | null = null;
  let loading = true;
  let error   = '';
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
</script>

<svelte:head><title>Dashboard — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Dashboard</h1>
    <p class="page-subtitle">Marketing automation overview</p>
  </div>
  <div class="flex gap-2">
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
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if error}
  <div class="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
{:else if stats}
  <!-- Metrics row -->
  <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
    <MetricCard label="Active Clients"  value={stats.clients}              href="/clients" />
    <MetricCard label="Total Posts"     value={stats.total_posts}          href="/posts" />
    <MetricCard label="Posted"          value={stats.posted}               color="success" href="/posts?status=posted" />
    <MetricCard label="Scheduled"       value={stats.scheduled ?? 0}       color="default" href="/posts?status=scheduled" />
    <MetricCard label="Ready"           value={stats.ready ?? 0}           color="default" href="/posts?status=ready" />
    <MetricCard label="Pending Review"  value={stats.pending_approvals}    color={stats.pending_approvals > 0 ? 'warning' : 'default'} href="/approvals" />
    <MetricCard label="Drafts"          value={stats.drafts ?? 0}          color="default" href="/posts?status=draft" />
    <MetricCard label="Failed"          value={stats.failed}               href="/posts?status=failed" color={stats.failed > 0 ? 'error' : 'default'} />
  </div>

  <!-- Pending approvals banner -->
  {#if stats.pending_approvals > 0}
  <div class="mb-5 flex items-center gap-3 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm text-yellow-400">
    <span class="font-semibold">{stats.pending_approvals}</span>
    <span>post{stats.pending_approvals !== 1 ? 's' : ''} waiting for approval</span>
    <a href="/approvals" class="ml-auto text-xs underline hover:no-underline">Review now →</a>
  </div>
  {/if}

  <!-- Two columns -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <!-- Recent Jobs -->
    <div class="card">
      <div class="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 class="font-medium text-white text-sm">Recent Jobs</h2>
        <a href="/automation" class="text-xs text-accent hover:underline">View all →</a>
      </div>
      {#if stats.recent_jobs.length === 0}
        <p class="px-5 py-8 text-center text-sm text-muted">No jobs yet — trigger a run above.</p>
      {:else}
        <div class="divide-y divide-border">
          {#each stats.recent_jobs as job}
            <div class="px-5 py-3 flex items-center justify-between">
              <div>
                <div class="flex items-center gap-2 mb-0.5">
                  <Badge status={job.status} />
                  <span class="text-xs {job.mode === 'dry_run' ? 'text-yellow-400' : 'text-muted'} capitalize">
                    {job.mode.replace(/_/g, ' ')}
                  </span>
                  {#if job.client_filter}
                    <span class="text-xs text-muted">· {job.client_filter}</span>
                  {/if}
                </div>
                <div class="text-xs text-muted">{jobStats(job)}</div>
              </div>
              <span class="text-xs text-muted">{timeAgo(job.created_at)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Quick Actions -->
    <div class="card">
      <div class="px-5 py-4 border-b border-border">
        <h2 class="font-medium text-white text-sm">Quick Actions</h2>
      </div>
      <div class="p-5 space-y-2">
        <a href="/posts/new" class="flex items-center gap-3 p-3 rounded-lg bg-surface hover:bg-card/80 transition-colors">
          <span class="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center text-accent text-sm">✦</span>
          <div>
            <div class="text-sm font-medium text-white">Create Post</div>
            <div class="text-xs text-muted">Draft new content for any platform</div>
          </div>
        </a>
        <a href="/approvals" class="flex items-center gap-3 p-3 rounded-lg bg-surface hover:bg-card/80 transition-colors">
          <span class="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-400 text-sm">✓</span>
          <div>
            <div class="text-sm font-medium text-white">Review Approvals</div>
            <div class="text-xs text-muted">
              {stats.pending_approvals > 0 ? `${stats.pending_approvals} posts waiting` : 'All clear'}
            </div>
          </div>
        </a>
        <a href="/calendar" class="flex items-center gap-3 p-3 rounded-lg bg-surface hover:bg-card/80 transition-colors">
          <span class="w-8 h-8 rounded-md bg-cyan-500/10 flex items-center justify-center text-cyan-400 text-sm">◫</span>
          <div>
            <div class="text-sm font-medium text-white">Content Calendar</div>
            <div class="text-xs text-muted">View scheduled posts by date</div>
          </div>
        </a>
        <a href="/reports" class="flex items-center gap-3 p-3 rounded-lg bg-surface hover:bg-card/80 transition-colors">
          <span class="w-8 h-8 rounded-md bg-purple-500/10 flex items-center justify-center text-purple-400 text-sm">▣</span>
          <div>
            <div class="text-sm font-medium text-white">Reports</div>
            <div class="text-xs text-muted">Per-client and platform analytics</div>
          </div>
        </a>
        <a href="/clients" class="flex items-center gap-3 p-3 rounded-lg bg-surface hover:bg-card/80 transition-colors">
          <span class="w-8 h-8 rounded-md bg-green-500/10 flex items-center justify-center text-green-400 text-sm">◉</span>
          <div>
            <div class="text-sm font-medium text-white">Manage Clients</div>
            <div class="text-xs text-muted">{stats.clients} active clients</div>
          </div>
        </a>
      </div>
    </div>
  </div>
{/if}
