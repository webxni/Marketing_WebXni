<script lang="ts">
  import { onMount } from 'svelte';
  import { runApi, clientsApi, packagesApi, postsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { timeAgo, parseStats } from '$lib/utils';
  import type { PostingJob, GenerationRun, Client, Package, Post } from '$lib/types';

  // ── Data ─────────────────────────────────────────────────────────────────────
  let clients:  Client[]  = [];
  let packages: Package[] = [];
  let genRuns:  GenerationRun[] = [];
  let jobs:     PostingJob[]    = [];
  let loadingGen  = true;
  let loadingJobs = true;
  let generating  = false;
  let triggering  = false;
  let historyTab: 'generation' | 'posting' = 'generation';

  // ── Client selection ──────────────────────────────────────────────────────────
  let clientMode: 'all' | 'select' | 'by-package' = 'all';
  let selectedSlugs: string[] = [];
  let clientSearch  = '';
  let filterPackage = '';

  $: pkgMap = Object.fromEntries(packages.map(p => [p.slug, p]));

  $: filteredClients = (() => {
    let list = clients;
    if (clientSearch.trim())
      list = list.filter(c => c.canonical_name.toLowerCase().includes(clientSearch.toLowerCase()));
    if (filterPackage)
      list = list.filter(c => c.package === filterPackage);
    return list;
  })();

  $: activeClients = (() => {
    if (clientMode === 'all') return clients;
    if (clientMode === 'by-package') return filterPackage ? clients.filter(c => c.package === filterPackage) : clients;
    return clients.filter(c => selectedSlugs.includes(c.slug));
  })();

  function toggleClient(slug: string) {
    if (selectedSlugs.includes(slug)) selectedSlugs = selectedSlugs.filter(s => s !== slug);
    else selectedSlugs = [...selectedSlugs, slug];
  }
  function toggleAll() {
    if (selectedSlugs.length === filteredClients.length) selectedSlugs = [];
    else selectedSlugs = filteredClients.map(c => c.slug);
  }

  // ── Date mode ────────────────────────────────────────────────────────────────
  let dateMode: 'monthly' | 'custom' | 'preset' = 'monthly';
  let activePreset: 'this-week' | 'next7' | 'next14' | 'next30' | null = null;

  const today  = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Monthly
  let genMonth = today.getMonth();
  let genYear  = today.getFullYear();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const years  = [today.getFullYear(), today.getFullYear() + 1];

  // Publish time — applies to all generated posts
  let publishTime = '10:00';  // default 10:00 AM

  // Custom
  let customStart = todayStr;
  let customEnd   = addDays(today, 13); // default: 14-day range

  function addDays(d: Date, n: number): string {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().split('T')[0];
  }

  /** Return the next weekday (Mon–Fri) on or after a given Date. */
  function nextWeekday(d: Date): Date {
    const day = d.getUTCDay();
    if (day === 0) { const n = new Date(d); n.setUTCDate(d.getUTCDate() + 1); return n; } // Sun → Mon
    if (day === 6) { const n = new Date(d); n.setUTCDate(d.getUTCDate() + 2); return n; } // Sat → Mon
    return d;
  }

  function applyPreset(preset: typeof activePreset) {
    activePreset = preset;
    dateMode = 'preset';
    const now = new Date();
    if (preset === 'this-week') {
      const day = now.getUTCDay();
      const mon = new Date(now);
      mon.setUTCDate(now.getUTCDate() - (day === 0 ? 6 : day - 1));
      const fri = new Date(mon);
      fri.setUTCDate(mon.getUTCDate() + 4);
      customStart = mon.toISOString().split('T')[0];
      customEnd   = fri.toISOString().split('T')[0];
    } else {
      // For next7/14/30: start from next weekday, end N calendar days later
      const start = nextWeekday(now);
      const t = start.toISOString().split('T')[0];
      if (preset === 'next7')  { customStart = t; customEnd = addDays(start, 6);  }
      else if (preset === 'next14') { customStart = t; customEnd = addDays(start, 13); }
      else if (preset === 'next30') { customStart = t; customEnd = addDays(start, 29); }
    }
  }

  // Resolved period
  $: periodStart = dateMode === 'monthly'
    ? `${genYear}-${String(genMonth + 1).padStart(2,'0')}-01`
    : customStart;
  $: periodEnd = dateMode === 'monthly'
    ? new Date(genYear, genMonth + 1, 0).toISOString().split('T')[0]
    : customEnd;

  $: rangeDays = (() => {
    const s = new Date(periodStart + 'T12:00:00Z');
    const e = new Date(periodEnd   + 'T12:00:00Z');
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
  })();

  // ── Estimate helpers ──────────────────────────────────────────────────────────
  function estimatePosts(client: Client): number {
    const pkg = pkgMap[client.package ?? ''];
    if (!pkg) return Math.max(1, Math.round(8 * rangeDays / 30));
    return Math.max(1, Math.round(pkg.posts_per_month * rangeDays / 30));
  }

  function contentBreakdown(client: Client): { images: number; videos: number; blogs: number } {
    const pkg = pkgMap[client.package ?? ''];
    const total = estimatePosts(client);
    if (!pkg || pkg.posts_per_month === 0) return { images: total, videos: 0, blogs: 0 };
    const ratio = total / pkg.posts_per_month;
    const blogs  = Math.round((pkg.blog_posts_per_month ?? 0) * ratio);
    const videos = Math.round(((pkg.videos_per_month ?? 0) + (pkg.reels_per_month ?? 0)) * ratio);
    const images = Math.max(0, total - blogs - videos);
    return { images, videos, blogs };
  }

  function getWarnings(client: Client): string[] {
    const w: string[] = [];
    if (!client.package) w.push('No package assigned');
    return w;
  }

  $: totalEstimated = activeClients.reduce((s, c) => s + estimatePosts(c), 0);
  $: clientsWithWarnings = activeClients.filter(c => getWarnings(c).length > 0);

  // ── Date display helpers ──────────────────────────────────────────────────────
  function fmtDate(iso: string): string {
    const d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function fmtYear(iso: string): string {
    return new Date(iso + 'T12:00:00Z').getUTCFullYear().toString();
  }

  $: buttonLabel = (() => {
    if (generating) return 'Generating…';
    if (dateMode === 'monthly') return `Generate ${months[genMonth]} ${genYear} Drafts`;
    const s = fmtDate(periodStart);
    const e = fmtDate(periodEnd);
    const sameYear = fmtYear(periodStart) === fmtYear(periodEnd);
    const label = sameYear ? `${s}–${e}` : `${s} ${fmtYear(periodStart)}–${e} ${fmtYear(periodEnd)}`;
    if (activePreset === 'this-week')  return `Generate This Week's Drafts`;
    if (activePreset === 'next7')      return `Generate Next 7 Days (${label})`;
    if (activePreset === 'next14')     return `Generate Next 14 Days (${label})`;
    if (activePreset === 'next30')     return `Generate Next 30 Days (${label})`;
    return `Generate Drafts (${label})`;
  })();

  // ── Custom range validation ───────────────────────────────────────────────────
  $: dateError = (() => {
    if (dateMode === 'monthly') return null;
    if (!customStart || !customEnd) return 'Select both start and end dates';
    if (customStart > customEnd) return 'Start date must be before end date';
    if (rangeDays > 92) return 'Range exceeds 92 days — generate by month instead';
    return null;
  })();

  // ── Generate ─────────────────────────────────────────────────────────────────
  async function generate() {
    if (clientMode === 'select' && selectedSlugs.length === 0) {
      toast.error('Select at least one client'); return;
    }
    if (dateError) { toast.error(dateError); return; }
    generating = true;
    try {
      await runApi.triggerGenerate({
        client_slugs: clientMode === 'select' ? selectedSlugs
          : clientMode === 'by-package' && filterPackage ? activeClients.map(c => c.slug)
          : [],
        date_from:    periodStart,
        date_to:      periodEnd,
        publish_time: publishTime || '10:00',
      });
      toast.success(`Generation started — ~${totalEstimated} drafts queued`);
      historyTab = 'generation';
      setTimeout(loadGenRuns, 3000);
    } catch (e) { toast.error(String(e)); }
    finally { generating = false; }
  }

  // ── Scheduled queue ───────────────────────────────────────────────────────────
  let scheduledPosts:    Post[] = [];
  let loadingScheduled = true;
  let showAdvancedPosting = false;

  async function loadScheduledPosts() {
    loadingScheduled = true;
    try {
      const [readyR, approvedR] = await Promise.all([
        postsApi.list({ status: 'ready',    limit: 100 }),
        postsApi.list({ status: 'approved', limit: 100 }),
      ]);
      const combined = [...readyR.posts, ...approvedR.posts];
      // deduplicate (shouldn't overlap, but be safe)
      const seen = new Set<string>();
      scheduledPosts = combined.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      }).sort((a, b) => {
        if (!a.publish_date) return 1;
        if (!b.publish_date) return -1;
        return a.publish_date.localeCompare(b.publish_date);
      });
    } finally { loadingScheduled = false; }
  }

  // Nicaragua time helpers (CST = UTC-6, no DST)
  function nicNow(): string {
    return new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  }
  function nicToday(): string { return nicNow().slice(0, 10); }
  function nicTomorrow(): string {
    return new Date(Date.now() - 6 * 3600000 + 86400000).toISOString().slice(0, 10);
  }

  function formatScheduledTime(dt: string | null): string {
    if (!dt) return 'No time set';
    // dt is stored as NIC local time 'YYYY-MM-DDTHH:MM'
    const [date, time] = dt.split('T');
    return `${date}  ${time ?? ''} NIC`.trim();
  }

  function scheduledLabel(dt: string | null): { label: string; cls: string; hint?: string } {
    if (!dt) return { label: 'Unscheduled', cls: 'text-muted', hint: 'No publish time set — will not be sent automatically' };
    const nowMs = Date.now() - 6 * 3600000; // NIC now in ms
    const dtMs  = new Date(dt.replace(' ', 'T')).getTime();
    const diffMin = (dtMs - nowMs) / 60000; // positive = future

    if (diffMin < -10) return {
      label: 'Overdue',
      cls: 'text-red-400',
      hint: 'More than 10 minutes overdue — use Manual Run below if it has not posted yet.',
    };
    if (diffMin <= 2) return {
      label: 'Sending…',
      cls: 'text-green-400',
    };
    const dtNorm = dt.replace(' ', 'T');
    if (diffMin <= 60) return { label: 'Due soon', cls: 'text-yellow-400' };
    if (dtNorm.startsWith(nicToday())) return { label: 'Today', cls: 'text-accent' };
    if (dtNorm.startsWith(nicTomorrow())) return { label: 'Tomorrow', cls: 'text-muted' };
    return { label: 'Upcoming', cls: 'text-muted' };
  }

  // ── Posting trigger (manual / emergency) ─────────────────────────────────────
  let dryRun = false;
  let postClientFilter   = '';
  let postPlatformFilter = '';
  const allPlatforms = ['facebook','instagram','linkedin','x','threads','tiktok','pinterest','bluesky','youtube','google_business'];

  async function triggerPosting() {
    triggering = true;
    try {
      const params: Record<string,unknown> = { dry_run: dryRun };
      if (postClientFilter)   params.client_filter   = postClientFilter;
      if (postPlatformFilter) params.platform_filter = postPlatformFilter;
      await runApi.triggerPosting(params);
      toast.success(`Posting job started${dryRun ? ' (dry run)' : ''}`);
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

  // ── Loaders ───────────────────────────────────────────────────────────────────
  async function loadGenRuns() { loadingGen  = true; try { genRuns = (await runApi.listGenerationRuns()).runs; } finally { loadingGen  = false; } }
  async function loadJobs()    { loadingJobs = true; try { jobs    = (await runApi.listJobs()).jobs;           } finally { loadingJobs = false; } }

  onMount(async () => {
    const [cr, pkr] = await Promise.all([clientsApi.list('active'), packagesApi.listAll()]);
    clients  = cr.clients;
    packages = pkr.packages;
    await Promise.all([loadGenRuns(), loadJobs(), loadScheduledPosts()]);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function jobStats(job: PostingJob) {
    const s = parseStats(job.stats_json);
    return `${s.posted ?? 0} posted · ${s.failed ?? 0} failed · ${s.skipped ?? 0} skipped`;
  }
  function genRunClients(run: GenerationRun) {
    if (!run.client_filter) return 'All clients';
    try { const a = JSON.parse(run.client_filter); return Array.isArray(a) ? a.join(', ') : run.client_filter; }
    catch { return run.client_filter; }
  }
  function pkgLabel(pkg: Package | undefined): string {
    if (!pkg) return '8 posts';
    return `${pkg.posts_per_month}/mo`;
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

<!-- ═══ CONTENT GENERATION ════════════════════════════════════════════════════ -->
{#if can('automation.trigger')}
<div class="card p-5 mb-5">

  <!-- Header -->
  <div class="flex items-start justify-between mb-5">
    <div>
      <h3 class="text-sm font-semibold text-white mb-0.5">Generate Content</h3>
      <p class="text-xs text-muted">AI generates drafts based on each client's package, brand voice, and post history.</p>
    </div>
    {#if totalEstimated > 0}
      <span class="text-xs px-2.5 py-1 rounded-full bg-accent/15 text-accent font-medium whitespace-nowrap ml-3">
        ~{totalEstimated} drafts
      </span>
    {/if}
  </div>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-5">

    <!-- ── Col 1: Client selection ─────────────────────────────────────────── -->
    <div>
      <p class="text-xs text-muted uppercase tracking-wider mb-2">Clients</p>

      <!-- Mode toggle -->
      <div class="flex rounded-md border border-border overflow-hidden text-xs mb-3">
        <button
          class="flex-1 py-1.5 transition-colors {clientMode === 'all' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
          on:click={() => { clientMode = 'all'; filterPackage = ''; }}>All active</button>
        <button
          class="flex-1 py-1.5 transition-colors {clientMode === 'select' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
          on:click={() => clientMode = 'select'}>Select</button>
        <button
          class="flex-1 py-1.5 transition-colors {clientMode === 'by-package' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
          on:click={() => clientMode = 'by-package'}>Package</button>
      </div>

      {#if clientMode === 'all'}
        <p class="text-xs text-muted">{clients.length} active clients — content types and platforms are read from each client's assigned package.</p>

      {:else if clientMode === 'by-package'}
        <select bind:value={filterPackage} class="input w-full text-xs mb-2">
          <option value="">All packages</option>
          {#each packages as p}
            <option value={p.slug}>{p.name} ({clients.filter(c => c.package === p.slug).length} clients)</option>
          {/each}
        </select>
        <p class="text-xs text-muted">{activeClients.length} client{activeClients.length !== 1 ? 's' : ''} selected</p>

      {:else}
        <!-- Search + package filter row -->
        <div class="flex gap-1.5 mb-2">
          <input
            type="search"
            placeholder="Search…"
            bind:value={clientSearch}
            class="input flex-1 text-xs py-1"
          />
          <select bind:value={filterPackage} class="input text-xs py-1 w-24">
            <option value="">All</option>
            {#each packages as p}
              <option value={p.slug}>{p.name}</option>
            {/each}
          </select>
        </div>

        <!-- Select all / clear -->
        <div class="flex items-center justify-between mb-1.5">
          <button class="text-[10px] text-accent hover:underline" on:click={toggleAll}>
            {selectedSlugs.length === filteredClients.length && filteredClients.length > 0 ? 'Deselect all' : 'Select all'}
          </button>
          <span class="text-[10px] text-muted">{selectedSlugs.length} selected</span>
        </div>

        <!-- Client list -->
        <div class="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
          {#each filteredClients as c}
            {@const warnings = getWarnings(c)}
            <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-surface cursor-pointer border-b border-border last:border-0 {selectedSlugs.includes(c.slug) ? 'bg-accent/5' : ''}">
              <input type="checkbox" checked={selectedSlugs.includes(c.slug)} on:change={() => toggleClient(c.slug)} class="rounded flex-shrink-0" />
              <span class="text-xs text-white flex-1 truncate">{c.canonical_name}</span>
              {#if warnings.length > 0}
                <span class="text-[10px] text-yellow-400 flex-shrink-0" title={warnings.join(', ')}>⚠</span>
              {/if}
              <span class="text-[10px] text-muted flex-shrink-0">{pkgLabel(pkgMap[c.package ?? ''])}</span>
            </label>
          {:else}
            <p class="text-xs text-muted px-3 py-3">No clients match</p>
          {/each}
        </div>
      {/if}
    </div>

    <!-- ── Col 2: Date period ──────────────────────────────────────────────── -->
    <div>
      <p class="text-xs text-muted uppercase tracking-wider mb-2">Period</p>

      <!-- Mode tabs -->
      <div class="flex rounded-md border border-border overflow-hidden text-xs mb-3">
        <button
          class="flex-1 py-1.5 transition-colors {dateMode === 'monthly' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
          on:click={() => { dateMode = 'monthly'; activePreset = null; }}>Monthly</button>
        <button
          class="flex-1 py-1.5 transition-colors {dateMode === 'custom' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
          on:click={() => { dateMode = 'custom'; activePreset = null; }}>Custom</button>
        <button
          class="flex-1 py-1.5 transition-colors {dateMode === 'preset' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
          on:click={() => { dateMode = 'preset'; activePreset = activePreset ?? 'next7'; applyPreset(activePreset); }}>Presets</button>
      </div>

      {#if dateMode === 'monthly'}
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label class="block text-xs text-muted mb-1">Month</label>
            <select bind:value={genMonth} class="input w-full text-xs">
              {#each months as m, i}
                <option value={i}>{m}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="block text-xs text-muted mb-1">Year</label>
            <select bind:value={genYear} class="input w-full text-xs">
              {#each years as y}
                <option value={y}>{y}</option>
              {/each}
            </select>
          </div>
        </div>
        <p class="text-xs text-muted">{periodStart} → {periodEnd} &nbsp;·&nbsp; {rangeDays} days</p>

      {:else if dateMode === 'custom'}
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label class="block text-xs text-muted mb-1">Start date</label>
            <input type="date" bind:value={customStart} class="input w-full text-xs" />
          </div>
          <div>
            <label class="block text-xs text-muted mb-1">End date</label>
            <input type="date" bind:value={customEnd} min={customStart} class="input w-full text-xs" />
          </div>
        </div>
        {#if dateError}
          <p class="text-xs text-red-400 mb-1">⚠ {dateError}</p>
        {:else}
          <div class="text-xs text-muted space-y-0.5">
            <p>{fmtDate(periodStart)} → {fmtDate(periodEnd)} &nbsp;·&nbsp; <span class="text-white font-medium">{rangeDays} days</span></p>
            <p>~{totalEstimated} drafts across {activeClients.length} client{activeClients.length !== 1 ? 's' : ''}</p>
          </div>
        {/if}

      {:else}
        <!-- Presets -->
        <div class="grid grid-cols-2 gap-2 mb-3">
          <button
            class="text-xs py-2 px-3 rounded-md border transition-colors text-left {activePreset === 'this-week' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-white hover:border-white/30'}"
            on:click={() => applyPreset('this-week')}>This Week</button>
          <button
            class="text-xs py-2 px-3 rounded-md border transition-colors text-left {activePreset === 'next7' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-white hover:border-white/30'}"
            on:click={() => applyPreset('next7')}>Next 7 Days</button>
          <button
            class="text-xs py-2 px-3 rounded-md border transition-colors text-left {activePreset === 'next14' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-white hover:border-white/30'}"
            on:click={() => applyPreset('next14')}>Next 14 Days</button>
          <button
            class="text-xs py-2 px-3 rounded-md border transition-colors text-left {activePreset === 'next30' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-white hover:border-white/30'}"
            on:click={() => applyPreset('next30')}>Next 30 Days</button>
        </div>
        {#if activePreset}
          <p class="text-xs text-muted">
            {fmtDate(periodStart)} → {fmtDate(periodEnd)}
            &nbsp;·&nbsp; <span class="text-white font-medium">{rangeDays} days</span>
          </p>
          <p class="text-xs text-muted mt-1">Mon–Fri only · weekends excluded · posting days set per package</p>
        {/if}
      {/if}

      <!-- ── Publish Time ──────────────────────────────────────────────────── -->
      <div class="mt-4 pt-4 border-t border-border">
        <p class="text-xs text-muted uppercase tracking-wider mb-2">Default Publish Time</p>
        <div class="flex items-center gap-2">
          <input
            type="time"
            bind:value={publishTime}
            class="input text-sm w-32"
          />
          <span class="text-xs text-muted">Applied to all generated posts · editable per post after</span>
        </div>
      </div>
    </div>

    <!-- ── Col 3: Summary + Action ────────────────────────────────────────── -->
    <div class="flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs text-muted uppercase tracking-wider">Summary</p>
          {#if totalEstimated > 0}
            <span class="text-xs font-semibold text-white">{totalEstimated} total</span>
          {/if}
        </div>

        {#if activeClients.length === 0}
          <p class="text-xs text-muted">No clients selected.</p>
        {:else}
          <ul class="space-y-1 mb-3 max-h-36 overflow-y-auto">
            {#each activeClients.slice(0, 10) as c}
              {@const est  = estimatePosts(c)}
              {@const bkdn = contentBreakdown(c)}
              {@const warn = getWarnings(c)}
              <li class="text-xs">
                <div class="flex items-center justify-between">
                  <span class="text-white truncate max-w-36 {warn.length > 0 ? 'text-yellow-300' : ''}"
                    title={warn.length > 0 ? warn.join(', ') : c.canonical_name}>
                    {#if warn.length > 0}<span class="mr-1">⚠</span>{/if}{c.canonical_name}
                  </span>
                  <span class="text-muted ml-1 flex-shrink-0">{est} posts</span>
                </div>
                <!-- content type chips -->
                <div class="flex gap-1 mt-0.5">
                  {#if bkdn.images > 0}
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">{bkdn.images} img</span>
                  {/if}
                  {#if bkdn.videos > 0}
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">{bkdn.videos} vid</span>
                  {/if}
                  {#if bkdn.blogs > 0}
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">{bkdn.blogs} blog</span>
                  {/if}
                </div>
              </li>
            {/each}
            {#if activeClients.length > 10}
              <li class="text-xs text-muted">+{activeClients.length - 10} more…</li>
            {/if}
          </ul>

          <!-- Warnings block -->
          {#if clientsWithWarnings.length > 0}
            <div class="text-[10px] text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded px-2.5 py-1.5 mb-3">
              ⚠ {clientsWithWarnings.length} client{clientsWithWarnings.length !== 1 ? 's' : ''} with missing setup:
              <span class="text-yellow-300">{clientsWithWarnings.slice(0,3).map(c => c.canonical_name.split(' ')[0]).join(', ')}{clientsWithWarnings.length > 3 ? '…' : ''}</span>
            </div>
          {/if}
        {/if}
      </div>

      <!-- CTA -->
      <div>
        <button
          class="btn-primary w-full py-2.5 text-sm font-medium"
          disabled={generating || activeClients.length === 0 || !!dateError}
          on:click={generate}
        >
          {#if generating}
            <span class="animate-pulse">Generating…</span>
          {:else}
            {buttonLabel}
          {/if}
        </button>
        <p class="text-[11px] text-muted text-center mt-2">Draft → Designer adds media → Approve → Posts at scheduled time</p>
      </div>
    </div>

  </div>
</div>
{/if}

<!-- ═══ SCHEDULED QUEUE ═══════════════════════════════════════════════════════ -->
<div class="card p-4 mb-5">
  <div class="flex items-center justify-between mb-3">
    <h3 class="section-label">Scheduled Queue</h3>
    <span class="text-xs text-muted">
      {#if !loadingScheduled}{scheduledPosts.length} post{scheduledPosts.length !== 1 ? 's' : ''} queued{/if}
    </span>
  </div>
  <p class="text-xs text-muted mb-4">Posts go out automatically at their exact scheduled time. Set publish date + time on each post to control when it sends.</p>

  {#if loadingScheduled}
    <div class="flex justify-center py-6"><Spinner /></div>
  {:else if scheduledPosts.length === 0}
    <p class="text-xs text-muted italic py-4 text-center">No posts are currently scheduled.</p>
  {:else}
    <div class="space-y-2">
      {#each scheduledPosts as post}
      {@const lbl = scheduledLabel(post.publish_date)}
      {@const platforms = JSON.parse(post.platforms ?? '[]')}
      <div class="px-3 py-2.5 rounded-lg bg-surface border {lbl.label === 'Overdue' ? 'border-red-500/30' : lbl.label === 'Sending…' ? 'border-green-500/30' : 'border-border'} hover:border-border/80">
        <div class="flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <a href="/posts/{post.id}" class="text-white hover:text-accent truncate block font-medium text-xs">{post.title}</a>
            <p class="text-[11px] text-muted truncate">{post.client_name ?? post.client_slug}</p>
          </div>
          <div class="hidden sm:flex flex-wrap gap-1 flex-shrink-0">
            {#each platforms.slice(0,3) as p}
              <PlatformBadge platform={p} size="sm" />
            {/each}
            {#if platforms.length > 3}
              <span class="text-[10px] text-muted">+{platforms.length - 3}</span>
            {/if}
          </div>
          <div class="text-right flex-shrink-0">
            <span class="text-[11px] {lbl.cls} font-medium block">{lbl.label}</span>
            <span class="text-[11px] text-muted font-mono">{formatScheduledTime(post.publish_date)}</span>
          </div>
        </div>
        {#if lbl.hint}
        <p class="text-[11px] text-muted mt-1.5 leading-tight">{lbl.hint}</p>
        {/if}
      </div>
      {/each}
    </div>
  {/if}

  <!-- Manual / emergency posting controls (collapsed by default) -->
  {#if can('automation.trigger')}
  <div class="mt-4 border-t border-border pt-3">
    <button
      class="text-xs text-muted hover:text-white flex items-center gap-1"
      on:click={() => (showAdvancedPosting = !showAdvancedPosting)}
    >
      <span class="transition-transform {showAdvancedPosting ? 'rotate-90' : ''} inline-block">▶</span>
      Manual / emergency run
    </button>
    {#if showAdvancedPosting}
    <div class="flex flex-wrap items-end gap-3 mt-3">
      <div>
        <label class="block text-xs text-muted mb-1">Client</label>
        <select bind:value={postClientFilter} class="input text-sm">
          <option value="">All clients</option>
          {#each clients as c}
            <option value={c.slug}>{c.canonical_name}</option>
          {/each}
        </select>
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Platform</label>
        <select bind:value={postPlatformFilter} class="input text-sm">
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
    {/if}
  </div>
  {/if}
</div>

<!-- ═══ HISTORY ════════════════════════════════════════════════════════════════ -->
<div class="flex border-b border-border mb-4">
  <button
    class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors {historyTab === 'generation' ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}"
    on:click={() => { historyTab = 'generation'; }}>Generation Runs</button>
  <button
    class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors {historyTab === 'posting' ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}"
    on:click={() => { historyTab = 'posting'; }}>Posting Jobs</button>
</div>

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
