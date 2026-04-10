<script lang="ts">
  import { onMount } from 'svelte';
  import { reportsApi, runApi } from '$lib/api';
  import MetricCard from '$lib/components/ui/MetricCard.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { formatDate, parseStats, timeAgo } from '$lib/utils';
  import type { OverviewStats, PostingJob } from '$lib/types';

  let stats:   OverviewStats | null = null;
  let loading = true;
  let error   = '';

  onMount(async () => {
    try {
      stats = await reportsApi.overview();
    } catch (e) {
      // Show a user-friendly message; log full error to console for debugging
      const msg = e instanceof Error ? e.message : String(e);
      error = msg.includes('401') ? 'Session expired — please log in again.' : `Failed to load dashboard: ${msg}`;
      console.error('[Dashboard] overview fetch failed:', e);
    } finally {
      loading = false;
    }
  });

  async function triggerPosting(dryRun: boolean) {
    try {
      const { job_id, mode } = await runApi.triggerPosting({ dry_run: dryRun });
      alert(`Job started: ${job_id} (${mode})`);
    } catch (e) { alert(`Error: ${e}`); }
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
    <button class="btn-secondary btn-sm" on:click={() => triggerPosting(true)}>Dry Run</button>
    <button class="btn-primary btn-sm" on:click={() => triggerPosting(false)}>Run Posting</button>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if error}
  <div class="text-red-400 text-sm">{error}</div>
{:else if stats}
  <!-- Metrics -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
    <MetricCard label="Active Clients"    value={stats.clients}           href="/clients" />
    <MetricCard label="Total Posts"       value={stats.total_posts}       href="/posts" />
    <MetricCard label="Posted"            value={stats.posted}            color="success" />
    <MetricCard label="Failed"            value={stats.failed}            href="/posts?status=failed" color={stats.failed > 0 ? 'error' : 'default'} />
  </div>
  {#if stats.pending_approvals > 0}
  <div class="mb-6 flex items-center gap-3 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm text-yellow-400">
    <span>⚠</span>
    <span>{stats.pending_approvals} post{stats.pending_approvals !== 1 ? 's' : ''} waiting for approval</span>
    <a href="/approvals" class="ml-auto text-xs underline hover:no-underline">Review now →</a>
  </div>
  {/if}

  <!-- Two columns -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <!-- Recent Jobs -->
    <div class="card">
      <div class="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 class="font-medium text-white text-sm">Recent Jobs</h2>
        <a href="/automation" class="text-xs text-accent hover:underline">View all</a>
      </div>
      {#if stats.recent_jobs.length === 0}
        <p class="px-5 py-8 text-center text-sm text-muted">No jobs yet</p>
      {:else}
        <div class="divide-y divide-border">
          {#each stats.recent_jobs as job}
            <div class="px-5 py-3 flex items-center justify-between">
              <div>
                <div class="flex items-center gap-2 mb-0.5">
                  <Badge status={job.status} />
                  <span class="text-xs text-muted capitalize">{job.mode}</span>
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
        <a href="/posts/new" class="flex items-center gap-3 p-3 rounded-lg bg-surface hover:bg-card/80 transition-colors group">
          <span class="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center text-accent">✦</span>
          <div>
            <div class="text-sm font-medium text-white">Create Post</div>
            <div class="text-xs text-muted">Draft new content manually</div>
          </div>
        </a>
        <a href="/approvals" class="flex items-center gap-3 p-3 rounded-lg bg-surface hover:bg-card/80 transition-colors">
          <span class="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-400">✓</span>
          <div>
            <div class="text-sm font-medium text-white">Review Approvals</div>
            <div class="text-xs text-muted">{stats.pending_approvals} posts waiting</div>
          </div>
        </a>
        <a href="/reports" class="flex items-center gap-3 p-3 rounded-lg bg-surface hover:bg-card/80 transition-colors">
          <span class="w-8 h-8 rounded-md bg-purple-500/10 flex items-center justify-center text-purple-400">▣</span>
          <div>
            <div class="text-sm font-medium text-white">Monthly Reports</div>
            <div class="text-xs text-muted">Per-client PDF reports</div>
          </div>
        </a>
        <a href="/clients" class="flex items-center gap-3 p-3 rounded-lg bg-surface hover:bg-card/80 transition-colors">
          <span class="w-8 h-8 rounded-md bg-green-500/10 flex items-center justify-center text-green-400">◉</span>
          <div>
            <div class="text-sm font-medium text-white">Manage Clients</div>
            <div class="text-xs text-muted">{stats.clients} active clients</div>
          </div>
        </a>
      </div>
    </div>
  </div>
{/if}
