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
  let platformFilter = '';

  const allPlatforms = [
    'facebook','instagram','linkedin','x','threads',
    'tiktok','pinterest','bluesky','youtube','google_business','website_blog'
  ];

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
      if (platformFilter) params.platform_filter = platformFilter;
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
      <label for="client_filter" class="block text-xs text-muted mb-1.5">Client filter (optional)</label>
      <select id="client_filter" bind:value={clientFilter} class="input w-full text-sm">
        <option value="">All clients</option>
        {#each clients as c}
          <option value={c.slug}>{c.canonical_name}</option>
        {/each}
      </select>
    </div>
    <div>
      <label for="platform_filter" class="block text-xs text-muted mb-1.5">Platform filter (optional)</label>
      <select id="platform_filter" bind:value={platformFilter} class="input w-full text-sm">
        <option value="">All platforms</option>
        {#each allPlatforms as p}
          <option value={p}>{p.replace(/_/g, ' ')}</option>
        {/each}
      </select>
    </div>
    <div class="flex items-end pb-1">
      <label for="dry_run" class="flex items-center gap-2 text-xs text-muted cursor-pointer">
        <input id="dry_run" type="checkbox" bind:checked={dryRun} class="rounded" />
        Dry run mode (no actual posting)
      </label>
    </div>
  </div>
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
    <button
      class="btn-primary btn-sm flex flex-col items-start gap-1 h-auto py-3 px-4 text-left"
      disabled={triggering}
      on:click={() => trigger(dryRun)}
    >
      <span class="font-semibold">{dryRun ? 'Dry Run Posting' : 'Run Posting'}</span>
      <span class="text-[11px] opacity-70 font-normal whitespace-normal">
        {dryRun
          ? 'Validates Ready posts without actually publishing. No changes made.'
          : 'Picks up all Ready posts and submits them to Upload-Post and WordPress.'}
      </span>
    </button>
    <button
      class="btn-secondary btn-sm flex flex-col items-start gap-1 h-auto py-3 px-4 text-left"
      disabled={triggering}
      on:click={triggerGenerate}
    >
      <span class="font-semibold">Generate Content</span>
      <span class="text-[11px] opacity-70 font-normal whitespace-normal">
        Phase 1 — AI generates captions and blog content for approved posts. (Coming soon)
      </span>
    </button>
    <button
      class="btn-secondary btn-sm flex flex-col items-start gap-1 h-auto py-3 px-4 text-left"
      disabled={triggering}
      on:click={fetchUrls}
    >
      <span class="font-semibold">Fetch Published URLs</span>
      <span class="text-[11px] opacity-70 font-normal whitespace-normal">
        Polls Upload-Post history and writes real post URLs back into the database.
      </span>
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
