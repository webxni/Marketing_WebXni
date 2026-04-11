<script lang="ts">
  import { onMount } from 'svelte';
  import { runApi, clientsApi, packagesApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { timeAgo, parseStats } from '$lib/utils';
  import type { PostingJob, GenerationRun, Client, Package } from '$lib/types';

  // ── State ─────────────────────────────────────────────────────────────────
  let clients:  Client[]  = [];
  let packages: Package[] = [];
  let genRuns:  GenerationRun[] = [];
  let jobs:     PostingJob[]    = [];
  let loadingGen  = true;
  let loadingJobs = true;
  let generating  = false;
  let triggering  = false;
  let historyTab: 'generation' | 'posting' = 'generation';

  // ── Generation form ────────────────────────────────────────────────────────
  let genMode: 'all' | 'select' = 'all';
  let genSelectedSlugs: string[] = [];

  // Month/Year picker
  const today     = new Date();
  let genMonth    = today.getMonth(); // 0-11
  let genYear     = today.getFullYear();
  const months    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const years     = [today.getFullYear(), today.getFullYear() + 1];

  $: periodStart = `${genYear}-${String(genMonth + 1).padStart(2,'0')}-01`;
  $: periodEnd   = new Date(genYear, genMonth + 1, 0).toISOString().split('T')[0]; // last day of month

  // Estimate total posts
  $: pkgMap = Object.fromEntries(packages.map(p => [p.slug, p]));
  $: activeClients = genMode === 'all' ? clients : clients.filter(c => genSelectedSlugs.includes(c.slug));
  $: estimatedPosts = activeClients.reduce((sum, c) => {
    const pkg = pkgMap[c.package ?? ''];
    return sum + (pkg?.posts_per_month ?? 8);
  }, 0);

  function toggleClient(slug: string) {
    if (genSelectedSlugs.includes(slug)) genSelectedSlugs = genSelectedSlugs.filter(s => s !== slug);
    else genSelectedSlugs = [...genSelectedSlugs, slug];
  }

  async function generate() {
    if (genMode === 'select' && genSelectedSlugs.length === 0) {
      toast.error('Select at least one client'); return;
    }
    generating = true;
    try {
      const { job_id } = await runApi.triggerGenerate({
        client_slugs: genMode === 'select' ? genSelectedSlugs : [],
        date_from:    periodStart,
        date_to:      periodEnd,
      });
      toast.success(`Generation started — ~${estimatedPosts} drafts queued`);
      historyTab = 'generation';
      setTimeout(loadGenRuns, 3000);
    } catch (e) { toast.error(String(e)); }
    finally { generating = false; }
  }

  // ── Posting trigger ────────────────────────────────────────────────────────
  let dryRun = false;
  let postClientFilter   = '';
  let postPlatformFilter = '';
  const allPlatforms = ['facebook','instagram','linkedin','x','threads','tiktok','pinterest','bluesky','youtube','google_business','website_blog'];

  async function triggerPosting() {
    triggering = true;
    try {
      const params: Record<string,unknown> = { dry_run: dryRun };
      if (postClientFilter)   params.client_filter   = postClientFilter;
      if (postPlatformFilter) params.platform_filter = postPlatformFilter;
      const { job_id, mode } = await runApi.triggerPosting(params);
      toast.success(`Posting job started (${mode})`);
      setTimeout(loadJobs, 1500);
    } catch (e) { toast.error(String(e)); }
    finally { triggering = false; }
  }

  async function fetchUrls() {
    triggering = true;
    try {
      await runApi.fetchUrls({});
      toast.success('URL fetch started');
      setTimeout(loadJobs, 1500);
    } catch (e) { toast.error(String(e)); }
    finally { triggering = false; }
  }

  // ── Data loaders ──────────────────────────────────────────────────────────
  async function loadGenRuns()  { loadingGen  = true; try { genRuns = (await runApi.listGenerationRuns()).runs; }  finally { loadingGen  = false; } }
  async function loadJobs()     { loadingJobs = true; try { jobs    = (await runApi.listJobs()).jobs; }            finally { loadingJobs = false; } }

  onMount(async () => {
    const [cr, pr, pkr] = await Promise.all([
      clientsApi.list('active'),
      packagesApi.list(),
      packagesApi.listAll(),
    ]);
    clients  = cr.clients;
    packages = pkr.packages;
    await Promise.all([loadGenRuns(), loadJobs()]);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function jobStats(job: PostingJob) {
    const s = parseStats(job.stats_json);
    return `${s.posted ?? 0} posted · ${s.failed ?? 0} failed · ${s.skipped ?? 0} skipped`;
  }
  function genRunClients(run: GenerationRun) {
    if (!run.client_filter) return 'All clients';
    try { const a = JSON.parse(run.client_filter); return Array.isArray(a) ? a.join(', ') : run.client_filter; }
    catch { return run.client_filter; }
  }
  function clientPkgInfo(c: Client): string {
    const p = pkgMap[c.package ?? ''];
    if (!p) return '';
    return `${p.posts_per_month}/mo`;
  }
</script>

<svelte:head><title>Automation — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Automation</h1>
    <p class="page-subtitle">Generate content &amp; manage posting</p>
  </div>
  <button class="btn-ghost btn-sm" on:click={() => { loadGenRuns(); loadJobs(); }}>Refresh</button>
</div>

<!-- ═══ CONTENT GENERATION ═══════════════════════════════════════════════════ -->
{#if can('automation.trigger')}
<div class="card p-5 mb-5">
  <div class="flex items-start justify-between mb-5">
    <div>
      <h3 class="text-sm font-semibold text-white mb-0.5">Generate Content</h3>
      <p class="text-xs text-muted">AI generates drafts based on each client's package, brand voice, and post history.</p>
    </div>
    {#if estimatedPosts > 0}
      <span class="text-xs px-2.5 py-1 rounded-full bg-accent/15 text-accent font-medium whitespace-nowrap">
        ~{estimatedPosts} drafts
      </span>
    {/if}
  </div>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-5">

    <!-- Clients -->
    <div>
      <p class="text-xs text-muted uppercase tracking-wider mb-2">Clients</p>
      <div class="flex rounded-md border border-border overflow-hidden text-xs mb-3">
        <button class="flex-1 py-1.5 transition-colors {genMode === 'all' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
          on:click={() => genMode = 'all'}>All active</button>
        <button class="flex-1 py-1.5 transition-colors {genMode === 'select' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
          on:click={() => genMode = 'select'}>Select</button>
      </div>

      {#if genMode === 'select'}
      <div class="border border-border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
        {#each clients as c}
          <label class="flex items-center gap-2.5 px-3 py-2 hover:bg-surface cursor-pointer border-b border-border last:border-0 {genSelectedSlugs.includes(c.slug) ? 'bg-accent/5' : ''}">
            <input type="checkbox" checked={genSelectedSlugs.includes(c.slug)} on:change={() => toggleClient(c.slug)} class="rounded flex-shrink-0" />
            <span class="text-xs text-white flex-1 truncate">{c.canonical_name}</span>
            {#if clientPkgInfo(c)}
              <span class="text-[10px] text-muted flex-shrink-0">{clientPkgInfo(c)}</span>
            {/if}
          </label>
        {/each}
      </div>
      {:else}
        <p class="text-xs text-muted">{clients.length} active clients — content types and platforms are read from each client's assigned package.</p>
      {/if}
    </div>

    <!-- Period -->
    <div>
      <p class="text-xs text-muted uppercase tracking-wider mb-2">Period</p>
      <div class="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label for="gen_month" class="block text-xs text-muted mb-1">Month</label>
          <select id="gen_month" bind:value={genMonth} class="input w-full text-sm">
            {#each months as m, i}
              <option value={i}>{m}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="gen_year" class="block text-xs text-muted mb-1">Year</label>
          <select id="gen_year" bind:value={genYear} class="input w-full text-sm">
            {#each years as y}
              <option value={y}>{y}</option>
            {/each}
          </select>
        </div>
      </div>
      <p class="text-xs text-muted">{periodStart} → {periodEnd}</p>
    </div>

    <!-- Summary + Action -->
    <div class="flex flex-col justify-between">
      <div>
        <p class="text-xs text-muted uppercase tracking-wider mb-2">Summary</p>
        {#if activeClients.length > 0}
          <ul class="space-y-1 mb-4 max-h-28 overflow-y-auto">
            {#each activeClients.slice(0, 8) as c}
              {@const pkg = pkgMap[c.package ?? '']}
              <li class="flex items-center justify-between text-xs">
                <span class="text-white truncate max-w-32">{c.canonical_name}</span>
                <span class="text-muted ml-2 flex-shrink-0">{pkg ? `${pkg.posts_per_month} posts` : '8 posts'}</span>
              </li>
            {/each}
            {#if activeClients.length > 8}
              <li class="text-xs text-muted">+{activeClients.length - 8} more…</li>
            {/if}
          </ul>
        {/if}
      </div>
      <button
        class="btn-primary w-full py-2.5 text-sm font-medium"
        disabled={generating || activeClients.length === 0}
        on:click={generate}
      >
        {#if generating}
          <span class="animate-pulse">Generating…</span>
        {:else}
          Generate {months[genMonth]} Drafts
        {/if}
      </button>
      <p class="text-[11px] text-muted text-center mt-2">Draft → Designer adds media → Approve → Ready → Cron posts</p>
    </div>

  </div>
</div>
{/if}

<!-- ═══ POSTING TRIGGER ═══════════════════════════════════════════════════════ -->
{#if can('automation.trigger')}
<div class="card p-4 mb-5">
  <h3 class="section-label mb-3">Posting Controls</h3>
  <div class="flex flex-wrap items-end gap-3">
    <div>
      <label for="post_client" class="block text-xs text-muted mb-1">Client</label>
      <select id="post_client" bind:value={postClientFilter} class="input text-sm">
        <option value="">All clients</option>
        {#each clients as c}
          <option value={c.slug}>{c.canonical_name}</option>
        {/each}
      </select>
    </div>
    <div>
      <label for="post_platform" class="block text-xs text-muted mb-1">Platform</label>
      <select id="post_platform" bind:value={postPlatformFilter} class="input text-sm">
        <option value="">All platforms</option>
        {#each allPlatforms as p}
          <option value={p}>{p.replace(/_/g,' ')}</option>
        {/each}
      </select>
    </div>
    <label class="flex items-center gap-2 text-xs text-muted cursor-pointer pb-2">
      <input type="checkbox" bind:checked={dryRun} class="rounded" /> Dry run
    </label>
    <div class="flex gap-2 pb-0.5">
      <button class="btn-secondary btn-sm" disabled={triggering} on:click={triggerPosting}>
        {dryRun ? 'Dry Run' : 'Run Posting'}
      </button>
      <button class="btn-ghost btn-sm" disabled={triggering} on:click={fetchUrls}>Fetch URLs</button>
    </div>
  </div>
</div>
{/if}

<!-- ═══ HISTORY ═══════════════════════════════════════════════════════════════ -->
<div class="flex border-b border-border mb-4">
  {#each [['generation','Generation Runs'],['posting','Posting Jobs']] as [key, label]}
    <button
      class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors {historyTab === key
        ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}"
      on:click={() => { historyTab = key; }}
    >{label}</button>
  {/each}
</div>

<!-- Generation runs -->
{#if historyTab === 'generation'}
  {#if loadingGen}
    <div class="flex justify-center py-12"><Spinner size="lg" /></div>
  {:else if genRuns.length === 0}
    <EmptyState title="No generation runs yet" detail="Trigger content generation above." icon="✦" />
  {:else}
    <div class="card">
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr><th>ID</th><th>Clients</th><th>Period</th><th>Status</th><th>Posts</th><th>Started</th><th>Duration</th></tr>
          </thead>
          <tbody>
            {#each genRuns as run}
              <tr>
                <td class="font-mono text-xs text-muted">{run.id.slice(0,10)}…</td>
                <td class="text-xs text-white max-w-xs truncate">{genRunClients(run)}</td>
                <td class="text-xs text-muted">{run.week_start}</td>
                <td>
                  <span class="badge {run.status === 'completed' ? 'badge-posted' : run.status === 'running' ? 'badge-running' : run.status === 'completed_with_errors' ? 'badge-blocked' : 'badge-failed'}">
                    {run.status === 'completed_with_errors' ? 'partial' : run.status}
                  </span>
                </td>
                <td class="text-xs {run.posts_created > 0 ? 'text-green-400 font-medium' : 'text-muted'}">{run.posts_created}</td>
                <td class="text-xs text-muted">{timeAgo(run.created_at)}</td>
                <td class="text-xs text-muted">
                  {#if run.completed_at}{run.completed_at - run.created_at}s
                  {:else if run.status === 'running'}<span class="text-yellow-400 animate-pulse">running…</span>
                  {:else}—{/if}
                </td>
              </tr>
              {#if run.error_log}
                <tr>
                  <td colspan="7" class="pb-3 pt-0 px-4">
                    <pre class="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2 overflow-auto max-h-20 whitespace-pre-wrap">{run.error_log}</pre>
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

<!-- Posting jobs -->
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
            <tr><th>ID</th><th>Mode</th><th>Status</th><th>Stats</th><th>Client</th><th>Started</th><th>Duration</th></tr>
          </thead>
          <tbody>
            {#each jobs as job}
              <tr>
                <td class="font-mono text-xs text-muted">{job.id.slice(0,10)}…</td>
                <td class="text-xs capitalize {job.mode === 'dry_run' ? 'text-yellow-400' : 'text-white'}">{job.mode.replace(/_/g,' ')}</td>
                <td><Badge status={job.status} /></td>
                <td class="text-xs text-muted">{jobStats(job)}</td>
                <td class="text-xs text-muted">{job.client_filter ?? 'all'}</td>
                <td class="text-xs text-muted">{timeAgo(job.created_at)}</td>
                <td class="text-xs text-muted">
                  {#if job.completed_at}{Math.round(job.completed_at - job.created_at)}s
                  {:else if job.status === 'running'}<span class="text-yellow-400 animate-pulse">running…</span>
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
