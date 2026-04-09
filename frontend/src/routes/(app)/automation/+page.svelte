<script lang="ts">
  import { onMount } from 'svelte';
  import { runApi, clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { formatDateTime, timeAgo, parseStats } from '$lib/utils';
  import type { PostingJob, Client } from '$lib/types';

  let jobs: PostingJob[] = [];
  let clients: Client[] = [];
  let loading = true;
  let triggering = false;

  let dryRun = false;
  let clientFilter = '';

  async function load() {
    loading = true;
    try {
      const r = await runApi.listJobs();
      jobs = r.jobs;
    } finally { loading = false; }
  }

  onMount(async () => {
    const r = await clientsApi.list('active');
    clients = r.clients;
    load();
  });

  async function trigger(dry: boolean) {
    triggering = true;
    try {
      const params: Record<string, unknown> = { dry_run: dry };
      if (clientFilter) params.client_filter = clientFilter;
      const { job_id, mode } = await runApi.triggerPosting(params);
      toast.success(`Job started: ${job_id} (${mode})`);
      setTimeout(load, 1000);
    } catch (e) { toast.error(String(e)); }
    finally { triggering = false; }
  }

  async function triggerGenerate() {
    triggering = true;
    try {
      const params: Record<string, unknown> = {};
      if (clientFilter) params.client_filter = clientFilter;
      const { job_id } = await runApi.triggerGenerate(params);
      toast.success(`Content generation started: ${job_id}`);
      setTimeout(load, 1000);
    } catch (e) { toast.error(String(e)); }
    finally { triggering = false; }
  }

  async function fetchUrls() {
    triggering = true;
    try {
      const { job_id } = await runApi.fetchUrls({});
      toast.success(`URL fetch job started: ${job_id}`);
      setTimeout(load, 1000);
    } catch (e) { toast.error(String(e)); }
    finally { triggering = false; }
  }

  function jobStats(job: PostingJob) {
    const s = parseStats(job.stats_json);
    return `${s.posted ?? 0} posted · ${s.failed ?? 0} failed · ${s.skipped ?? 0} skipped`;
  }

  function statusColor(status: string) {
    if (status === 'running')   return 'text-yellow-400';
    if (status === 'completed') return 'text-green-400';
    if (status === 'failed')    return 'text-red-400';
    return 'text-muted';
  }
</script>

<svelte:head><title>Automation — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Automation</h1>
    <p class="page-subtitle">Posting jobs and triggers</p>
  </div>
  <button class="btn-ghost btn-sm" on:click={load}>Refresh</button>
</div>

{#if can('automation.trigger')}
<!-- Trigger panel -->
<div class="card p-5 mb-6">
  <h3 class="section-label mb-4">Trigger Job</h3>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
    <div>
      <label class="block text-xs text-muted mb-1.5">Client filter (optional)</label>
      <select bind:value={clientFilter} class="input w-full text-sm">
        <option value="">All clients</option>
        {#each clients as c}
          <option value={c.slug}>{c.canonical_name}</option>
        {/each}
      </select>
    </div>
    <div class="flex items-end">
      <label class="flex items-center gap-2 text-xs text-muted cursor-pointer">
        <input type="checkbox" bind:checked={dryRun} class="rounded" />
        Dry run mode (no actual posting)
      </label>
    </div>
  </div>
  <div class="flex flex-wrap gap-2">
    <button
      class="btn-primary btn-sm"
      disabled={triggering}
      on:click={() => trigger(dryRun)}
    >
      {dryRun ? 'Dry Run Posting' : 'Run Posting'}
    </button>
    <button
      class="btn-secondary btn-sm"
      disabled={triggering}
      on:click={triggerGenerate}
    >
      Generate Content (Phase 1)
    </button>
    <button
      class="btn-secondary btn-sm"
      disabled={triggering}
      on:click={fetchUrls}
    >
      Fetch Published URLs
    </button>
  </div>
</div>
{/if}

<!-- Jobs list -->
{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if jobs.length === 0}
  <EmptyState title="No jobs yet" detail="Trigger a posting run to get started." icon="▶" />
{:else}
  <div class="card">
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Mode</th>
            <th>Status</th>
            <th>Stats</th>
            <th>Client</th>
            <th>Triggered</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {#each jobs as job}
            <tr>
              <td class="font-mono text-xs text-muted">{job.id.slice(0, 12)}…</td>
              <td>
                <span class="text-xs capitalize {job.mode === 'dry_run' ? 'text-yellow-400' : 'text-white'}">
                  {job.mode.replace(/_/g, ' ')}
                </span>
              </td>
              <td><Badge status={job.status} /></td>
              <td class="text-xs text-muted">{jobStats(job)}</td>
              <td class="text-xs text-muted">{job.client_filter ?? 'all'}</td>
              <td class="text-xs text-muted">{timeAgo(job.created_at)}</td>
              <td class="text-xs text-muted">
                {#if job.completed_at}
                  {Math.round((job.completed_at - job.created_at) / 1000)}s
                {:else if job.status === 'running'}
                  <span class="text-yellow-400 animate-pulse">running…</span>
                {:else}
                  —
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}
