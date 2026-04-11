<script lang="ts">
  import { onMount } from 'svelte';
  import { runApi, clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { formatDateTime, timeAgo, parseStats } from '$lib/utils';
  import type { PostingJob, GenerationRun, Client } from '$lib/types';

  // ── Shared ─────────────────────────────────────────────────────────────────
  let clients: Client[] = [];
  let historyTab: 'generation' | 'posting' = 'generation';

  // ── Posting trigger ────────────────────────────────────────────────────────
  let jobs: PostingJob[] = [];
  let loadingJobs = true;
  let triggering = false;
  let dryRun = false;
  let clientFilter = '';
  let platformFilter = '';
  const allPlatforms = [
    'facebook','instagram','linkedin','x','threads',
    'tiktok','pinterest','bluesky','youtube','google_business','website_blog',
  ];

  async function loadJobs() {
    loadingJobs = true;
    try { const r = await runApi.listJobs(); jobs = r.jobs; }
    finally { loadingJobs = false; }
  }

  async function triggerPosting(dry: boolean) {
    triggering = true;
    try {
      const params: Record<string, unknown> = { dry_run: dry };
      if (clientFilter)   params.client_filter   = clientFilter;
      if (platformFilter) params.platform_filter = platformFilter;
      const { job_id, mode } = await runApi.triggerPosting(params);
      toast.success(`Posting job started: ${job_id} (${mode})`);
      setTimeout(loadJobs, 1500);
    } catch (e) { toast.error(String(e)); }
    finally { triggering = false; }
  }

  async function fetchUrls() {
    triggering = true;
    try {
      const { job_id } = await runApi.fetchUrls({});
      toast.success(`URL fetch job started: ${job_id}`);
      setTimeout(loadJobs, 1500);
    } catch (e) { toast.error(String(e)); }
    finally { triggering = false; }
  }

  // ── Content generation ─────────────────────────────────────────────────────
  let genRuns: GenerationRun[] = [];
  let loadingGenRuns = true;
  let generating = false;

  // Client selection
  let genClientMode: 'all' | 'select' = 'all';
  let genSelectedSlugs: string[] = [];
  function toggleGenClient(slug: string) {
    if (genSelectedSlugs.includes(slug)) genSelectedSlugs = genSelectedSlugs.filter(s => s !== slug);
    else genSelectedSlugs = [...genSelectedSlugs, slug];
  }
  function selectAllClients()  { genSelectedSlugs = clients.map(c => c.slug); }
  function clearClientSel()    { genSelectedSlugs = []; }

  // Dates
  let genDateFrom = '';
  let genDateTo   = '';
  $: genDateCount = (() => {
    if (!genDateFrom) return 0;
    const a = new Date(genDateFrom), b = new Date(genDateTo || genDateFrom);
    return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
  })();
  $: genPostCount = genDateCount * (genClientMode === 'all' ? clients.length : genSelectedSlugs.length);

  // Content types
  let genTypes: string[] = ['image'];
  function toggleGenType(t: string) {
    if (genTypes.includes(t)) {
      if (genTypes.length > 1) genTypes = genTypes.filter(x => x !== t);
    } else genTypes = [...genTypes, t];
  }

  // Platform override
  let genPlatformOverride = false;
  let genPlatforms: string[] = [];
  function toggleGenPlatform(p: string) {
    if (genPlatforms.includes(p)) genPlatforms = genPlatforms.filter(x => x !== p);
    else genPlatforms = [...genPlatforms, p];
  }

  async function loadGenRuns() {
    loadingGenRuns = true;
    try { const r = await runApi.listGenerationRuns(); genRuns = r.runs; }
    finally { loadingGenRuns = false; }
  }

  async function generate() {
    if (!genDateFrom) { toast.error('Select a start date'); return; }
    if (genClientMode === 'select' && genSelectedSlugs.length === 0) { toast.error('Select at least one client'); return; }
    generating = true;
    try {
      const params = {
        client_slugs:    genClientMode === 'select' ? genSelectedSlugs : [],
        date_from:       genDateFrom,
        date_to:         genDateTo || genDateFrom,
        content_types:   genTypes,
        platform_filter: genPlatformOverride ? genPlatforms : [],
      };
      const { job_id } = await runApi.triggerGenerate(params);
      toast.success(`Generation started — ${genPostCount} posts queued (${job_id.slice(0, 8)}…)`);
      historyTab = 'generation';
      setTimeout(loadGenRuns, 3000);
    } catch (e) { toast.error(String(e)); }
    finally { generating = false; }
  }

  // ── Mount ──────────────────────────────────────────────────────────────────
  onMount(async () => {
    const r = await clientsApi.list('active');
    clients = r.clients;
    await Promise.all([loadJobs(), loadGenRuns()]);
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function jobStats(job: PostingJob) {
    const s = parseStats(job.stats_json);
    return `${s.posted ?? 0} posted · ${s.failed ?? 0} failed · ${s.skipped ?? 0} skipped`;
  }

  function genRunLabel(run: GenerationRun) {
    const cf = run.client_filter;
    if (!cf) return 'All clients';
    try { const a = JSON.parse(cf); return Array.isArray(a) ? a.join(', ') : cf; }
    catch { return cf; }
  }

  function runDuration(run: { created_at: number; completed_at: number | null }) {
    if (!run.completed_at) return null;
    return Math.round((run.completed_at - run.created_at));
  }

  const contentTypeOptions = [
    { value: 'image',  label: 'Image' },
    { value: 'video',  label: 'Video' },
    { value: 'reel',   label: 'Reel'  },
    { value: 'blog',   label: 'Blog'  },
  ];
</script>

<svelte:head><title>Automation — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Automation</h1>
    <p class="page-subtitle">Content generation & posting</p>
  </div>
  <button class="btn-ghost btn-sm" on:click={() => { loadJobs(); loadGenRuns(); }}>Refresh</button>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     CONTENT GENERATION
════════════════════════════════════════════════════════════════════════════ -->
{#if can('automation.trigger')}
<div class="card p-5 mb-6">
  <div class="flex items-center justify-between mb-5">
    <div>
      <h3 class="text-sm font-semibold text-white">AI Content Generation</h3>
      <p class="text-xs text-muted mt-0.5">Generate draft posts using client intelligence, brand voice, and post history.</p>
    </div>
    {#if genPostCount > 0}
      <span class="px-2.5 py-1 rounded-full bg-accent/15 text-accent text-xs font-medium">
        ~{genPostCount} post{genPostCount === 1 ? '' : 's'} will be created
      </span>
    {/if}
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

    <!-- Left column -->
    <div class="space-y-5">

      <!-- Client selection -->
      <div>
        <p class="text-xs font-medium text-muted uppercase tracking-wider mb-2">Clients</p>
        <div class="flex rounded-md border border-border overflow-hidden mb-3">
          {#each [['all','All Clients'],['select','Select Clients']] as [v, label]}
            <button
              class="flex-1 py-1.5 text-xs transition-colors {genClientMode === v ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
              on:click={() => { genClientMode = v; }}
            >{label}</button>
          {/each}
        </div>

        {#if genClientMode === 'select'}
        <div class="border border-border rounded-lg overflow-hidden">
          <div class="flex gap-2 p-2 border-b border-border bg-surface">
            <button class="text-[10px] text-muted hover:text-white" on:click={selectAllClients}>Select all</button>
            <span class="text-border">·</span>
            <button class="text-[10px] text-muted hover:text-white" on:click={clearClientSel}>Clear</button>
            <span class="text-xs text-muted ml-auto">{genSelectedSlugs.length} selected</span>
          </div>
          <div class="max-h-48 overflow-y-auto">
            {#each clients as c}
              <label class="flex items-center gap-2.5 px-3 py-2 hover:bg-surface cursor-pointer border-b border-border last:border-0">
                <input type="checkbox" checked={genSelectedSlugs.includes(c.slug)} on:change={() => toggleGenClient(c.slug)} class="rounded" />
                <span class="text-xs text-white">{c.canonical_name}</span>
                <span class="text-[10px] text-muted ml-auto">{c.slug}</span>
              </label>
            {/each}
          </div>
        </div>
        {/if}
      </div>

      <!-- Date range -->
      <div>
        <p class="text-xs font-medium text-muted uppercase tracking-wider mb-2">Date Range</p>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="gen_date_from" class="block text-xs text-muted mb-1">From</label>
            <input id="gen_date_from" type="date" bind:value={genDateFrom} class="input w-full text-sm" />
          </div>
          <div>
            <label for="gen_date_to" class="block text-xs text-muted mb-1">To</label>
            <input id="gen_date_to" type="date" bind:value={genDateTo} min={genDateFrom} class="input w-full text-sm" />
          </div>
        </div>
        {#if genDateCount > 0}
          <p class="text-xs text-muted mt-1">{genDateCount} date{genDateCount === 1 ? '' : 's'} selected — 1 post per client per date</p>
        {/if}
      </div>

    </div>

    <!-- Right column -->
    <div class="space-y-5">

      <!-- Content types -->
      <div>
        <p class="text-xs font-medium text-muted uppercase tracking-wider mb-2">Content Types <span class="text-muted font-normal normal-case">(select one or more — cycles per date)</span></p>
        <div class="flex flex-wrap gap-2">
          {#each contentTypeOptions as opt}
            <button
              class="px-3 py-1.5 text-xs rounded-md border transition-colors {genTypes.includes(opt.value)
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-muted hover:text-white hover:border-border'}"
              on:click={() => toggleGenType(opt.value)}
            >{opt.label}</button>
          {/each}
        </div>
      </div>

      <!-- Platform override -->
      <div>
        <div class="flex items-center gap-2 mb-2">
          <p class="text-xs font-medium text-muted uppercase tracking-wider">Platforms</p>
          <label class="flex items-center gap-1.5 ml-auto cursor-pointer">
            <input type="checkbox" bind:checked={genPlatformOverride} class="rounded" />
            <span class="text-xs text-muted">Override per-client defaults</span>
          </label>
        </div>
        {#if genPlatformOverride}
          <div class="flex flex-wrap gap-2">
            {#each allPlatforms as p}
              <button
                class="px-2.5 py-1 text-[11px] rounded-md border transition-colors {genPlatforms.includes(p)
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-muted hover:text-white'}"
                on:click={() => toggleGenPlatform(p)}
              >{p.replace(/_/g,' ')}</button>
            {/each}
          </div>
          {#if genPlatforms.length === 0}
            <p class="text-xs text-warning mt-1">Select at least one platform, or disable override to use client defaults.</p>
          {/if}
        {:else}
          <p class="text-xs text-muted">Each client's configured platforms will be used automatically.</p>
        {/if}
      </div>

      <!-- Generate button -->
      <div class="pt-2">
        <button
          class="btn-primary w-full py-3 text-sm font-semibold"
          disabled={generating || !genDateFrom || (genClientMode === 'select' && genSelectedSlugs.length === 0) || (genPlatformOverride && genPlatforms.length === 0)}
          on:click={generate}
        >
          {#if generating}
            <span class="animate-pulse">Generating…</span>
          {:else}
            Generate {genPostCount > 0 ? `${genPostCount} ` : ''}Draft Post{genPostCount !== 1 ? 's' : ''}
          {/if}
        </button>
        <p class="text-xs text-muted text-center mt-2">Posts are created as <strong class="text-white">Draft</strong> — designer adds media, you approve, then they go ready for the cron.</p>
      </div>

    </div>
  </div>
</div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     POSTING TRIGGER
════════════════════════════════════════════════════════════════════════════ -->
{#if can('automation.trigger')}
<div class="card p-5 mb-6">
  <h3 class="section-label mb-4">Manual Posting Trigger</h3>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
    <div>
      <label for="client_filter" class="block text-xs text-muted mb-1.5">Client filter</label>
      <select id="client_filter" bind:value={clientFilter} class="input w-full text-sm">
        <option value="">All clients</option>
        {#each clients as c}
          <option value={c.slug}>{c.canonical_name}</option>
        {/each}
      </select>
    </div>
    <div>
      <label for="platform_filter" class="block text-xs text-muted mb-1.5">Platform filter</label>
      <select id="platform_filter" bind:value={platformFilter} class="input w-full text-sm">
        <option value="">All platforms</option>
        {#each allPlatforms as p}
          <option value={p}>{p.replace(/_/g,' ')}</option>
        {/each}
      </select>
    </div>
    <div class="flex items-end pb-1">
      <label for="dry_run" class="flex items-center gap-2 text-xs text-muted cursor-pointer">
        <input id="dry_run" type="checkbox" bind:checked={dryRun} class="rounded" />
        Dry run (no actual posting)
      </label>
    </div>
  </div>
  <div class="flex gap-3">
    <button
      class="btn-secondary btn-sm"
      disabled={triggering}
      on:click={() => triggerPosting(dryRun)}
    >{dryRun ? 'Dry Run' : 'Run Posting'}</button>
    <button
      class="btn-ghost btn-sm"
      disabled={triggering}
      on:click={fetchUrls}
    >Fetch Published URLs</button>
  </div>
</div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     HISTORY TABS
════════════════════════════════════════════════════════════════════════════ -->
<div class="flex border-b border-border mb-5">
  {#each [['generation','Generation Runs'],['posting','Posting Jobs']] as [key, label]}
    <button
      class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors {historyTab === key
        ? 'border-accent text-white'
        : 'border-transparent text-muted hover:text-white'}"
      on:click={() => { historyTab = key; }}
    >{label}</button>
  {/each}
</div>

<!-- Generation runs table -->
{#if historyTab === 'generation'}
  {#if loadingGenRuns}
    <div class="flex justify-center py-12"><Spinner size="lg" /></div>
  {:else if genRuns.length === 0}
    <EmptyState title="No generation runs yet" detail="Trigger AI content generation above to get started." icon="✦" />
  {:else}
    <div class="card">
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Clients</th>
              <th>Date Range</th>
              <th>Status</th>
              <th>Posts Created</th>
              <th>Started</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {#each genRuns as run}
              <tr>
                <td class="font-mono text-xs text-muted">{run.id.slice(0, 12)}…</td>
                <td class="text-xs text-white max-w-xs truncate">{genRunLabel(run)}</td>
                <td class="text-xs text-muted">{run.week_start}</td>
                <td>
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                    {run.status === 'completed' ? 'bg-green-500/15 text-green-400' :
                     run.status === 'running'   ? 'bg-yellow-500/15 text-yellow-400' :
                     run.status === 'completed_with_errors' ? 'bg-orange-500/15 text-orange-400' :
                     run.status === 'failed'    ? 'bg-red-500/15 text-red-400' :
                     'bg-gray-500/15 text-gray-400'}">
                    {run.status === 'completed_with_errors' ? 'partial' : run.status}
                  </span>
                </td>
                <td class="text-xs {run.posts_created > 0 ? 'text-green-400 font-medium' : 'text-muted'}">{run.posts_created}</td>
                <td class="text-xs text-muted">{timeAgo(run.created_at)}</td>
                <td class="text-xs text-muted">
                  {#if run.completed_at}
                    {runDuration(run)}s
                  {:else if run.status === 'running'}
                    <span class="text-yellow-400 animate-pulse">running…</span>
                  {:else}—{/if}
                </td>
              </tr>
              {#if run.error_log}
                <tr>
                  <td colspan="7" class="pb-3 pt-0 px-4">
                    <pre class="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2 overflow-auto max-h-24 whitespace-pre-wrap">{run.error_log}</pre>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
{/if}

<!-- Posting jobs table -->
{#if historyTab === 'posting'}
  {#if loadingJobs}
    <div class="flex justify-center py-12"><Spinner size="lg" /></div>
  {:else if jobs.length === 0}
    <EmptyState title="No posting jobs yet" detail="Trigger a posting run above." icon="▶" />
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
                    {job.mode.replace(/_/g,' ')}
                  </span>
                </td>
                <td><Badge status={job.status} /></td>
                <td class="text-xs text-muted">{jobStats(job)}</td>
                <td class="text-xs text-muted">{job.client_filter ?? 'all'}</td>
                <td class="text-xs text-muted">{timeAgo(job.created_at)}</td>
                <td class="text-xs text-muted">
                  {#if job.completed_at}
                    {Math.round((job.completed_at - job.created_at))}s
                  {:else if job.status === 'running'}
                    <span class="text-yellow-400 animate-pulse">running…</span>
                  {:else}—{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
{/if}
