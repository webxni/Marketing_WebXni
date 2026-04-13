<script lang="ts">
  import { onMount } from 'svelte';
  import { reportsApi, clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { currentMonth, monthRange } from '$lib/utils';
  import type { PostingStats, Client } from '$lib/types';

  let stats: PostingStats | null = null;
  let clients: Client[] = [];
  let loading = true;

  // Filtering — month picker OR custom date range
  const months = monthRange(12, 3);
  let selectedMonth = currentMonth();
  let selectedClient = '';
  let useCustomRange = false;
  let customFrom = '';
  let customTo = '';

  async function load() {
    loading = true;
    try {
      const params: Record<string, string> = {};
      if (selectedClient) params.client = selectedClient;
      if (useCustomRange && customFrom) {
        params.from = customFrom;
        if (customTo) params.to = customTo;
      } else {
        params.month = selectedMonth;
      }
      const r = await reportsApi.postingStats(params);
      stats = r;
    } finally { loading = false; }
  }

  onMount(async () => {
    const r = await clientsApi.list('active');
    clients = r.clients;
    load();
  });

  $: selectedMonth, selectedClient, load();
  $: useCustomRange, load();

  function applyCustomRange() { page = 0; load(); }

  let page = 0; // unused but keeps reactive pattern consistent

  function pct(posted: number, total: number) {
    return total ? Math.round((posted / total) * 100) : 0;
  }

  type PlatformRollup = { posted: number; failed: number; total: number };
  $: platformRollup = stats
    ? stats.by_platform.reduce<Record<string, PlatformRollup>>((acc, row) => {
        if (!acc[row.platform]) acc[row.platform] = { posted: 0, failed: 0, total: 0 };
        acc[row.platform].total += row.count;
        if (row.status === 'sent' || row.status === 'posted') acc[row.platform].posted += row.count;
        if (row.status === 'failed') acc[row.platform].failed += row.count;
        return acc;
      }, {})
    : {};

  $: platformEntries = Object.entries(platformRollup)
    .sort((a, b) => b[1].total - a[1].total);

  $: maxPlatformTotal = platformEntries.reduce((m, [, d]) => Math.max(m, d.total), 1);

  // Summary totals from by_status
  $: totalPosted    = stats?.by_status.find(s => s.status === 'posted')?.count ?? 0;
  $: totalScheduled = stats?.by_status.find(s => s.status === 'scheduled')?.count ?? 0;
  $: totalFailed    = stats?.by_status.find(s => s.status === 'failed')?.count ?? 0;
  $: totalDraft     = stats?.by_status.find(s => s.status === 'draft')?.count ?? 0;
  $: totalAll       = stats?.by_status.reduce((s, r) => s + r.count, 0) ?? 0;
  $: overallPct     = pct(totalPosted, totalAll);

  const platformColors: Record<string, string> = {
    facebook: '#1877F2', instagram: '#E1306C', linkedin: '#0A66C2',
    x: '#E7E9EA', threads: '#AAAAAA', tiktok: '#EE1D52', pinterest: '#E60023',
    bluesky: '#0085FF', youtube: '#FF0000', google_business: '#4285F4',
  };

  function platformLabel(p: string): string {
    const map: Record<string, string> = {
      google_business: 'Google Business', x: 'X / Twitter', website_blog: 'Blog',
    };
    return map[p] ?? p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
</script>

<svelte:head><title>Reports — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Reports</h1>
    <p class="page-subtitle">Posting performance overview</p>
  </div>
  <div class="flex items-center gap-3 flex-wrap">
    <!-- Range mode toggle -->
    <div class="flex rounded-lg border border-border overflow-hidden text-xs">
      <button
        class="px-3 py-1.5 transition-colors {!useCustomRange ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}"
        on:click={() => { useCustomRange = false; }}
      >Monthly</button>
      <button
        class="px-3 py-1.5 transition-colors {useCustomRange ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}"
        on:click={() => { useCustomRange = true; }}
      >Custom</button>
    </div>

    {#if !useCustomRange}
      <select bind:value={selectedMonth} class="input text-sm w-40">
        {#each months as m}
          <option value={m.value}>{m.label}</option>
        {/each}
      </select>
    {:else}
      <input type="date" bind:value={customFrom} class="input text-sm" title="From" on:change={applyCustomRange} />
      <input type="date" bind:value={customTo}   class="input text-sm" title="To"   on:change={applyCustomRange} />
    {/if}

    <select bind:value={selectedClient} class="input text-sm w-48">
      <option value="">All clients</option>
      {#each clients as c}
        <option value={c.slug}>{c.canonical_name}</option>
      {/each}
    </select>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if stats}

  <!-- Summary bar -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
    <div class="card p-4">
      <div class="text-3xl font-bold text-green-400">{totalPosted}</div>
      <div class="text-xs text-muted mt-1">Published</div>
    </div>
    <div class="card p-4">
      <div class="text-3xl font-bold text-accent">{overallPct}%</div>
      <div class="text-xs text-muted mt-1">Success Rate</div>
    </div>
    <div class="card p-4">
      <div class="text-3xl font-bold text-yellow-400">{totalScheduled}</div>
      <div class="text-xs text-muted mt-1">Submitted / Pending</div>
    </div>
    <div class="card p-4">
      <div class="text-3xl font-bold {totalFailed > 0 ? 'text-red-400' : 'text-muted'}">{totalFailed}</div>
      <div class="text-xs text-muted mt-1">Failed</div>
    </div>
  </div>

  <!-- Overall progress bar -->
  {#if totalAll > 0}
  <div class="card p-4 mb-6">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-muted">{totalAll} total posts this period</span>
      <span class="text-xs text-white font-medium">{overallPct}% confirmed published</span>
    </div>
    <div class="h-3 bg-surface rounded-full overflow-hidden flex">
      <div class="h-full rounded-l-full transition-all" style="width:{(totalPosted/totalAll)*100}%; background:#22c55e"></div>
      <div class="h-full transition-all" style="width:{(totalScheduled/totalAll)*100}%; background:#eab308; opacity:0.7"></div>
      {#if totalFailed > 0}
      <div class="h-full" style="width:{(totalFailed/totalAll)*100}%; background:#ef4444; opacity:0.7"></div>
      {/if}
    </div>
    <div class="flex gap-4 mt-2 text-[11px] text-muted">
      <span class="text-green-400">{totalPosted} published</span>
      {#if totalScheduled > 0}<span class="text-yellow-400">{totalScheduled} submitted (awaiting URL)</span>{/if}
      <span class="text-muted">{totalDraft} draft</span>
      {#if totalFailed > 0}<span class="text-red-400">{totalFailed} failed</span>{/if}
    </div>
  </div>
  {/if}

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

    <!-- Platform bar chart -->
    <div class="card">
      <div class="px-5 py-4 border-b border-border">
        <h2 class="font-medium text-white text-sm">By Platform</h2>
      </div>
      <div class="p-5 space-y-4">
        {#if platformEntries.length === 0}
          <p class="text-xs text-muted text-center py-4">No platform data this period.</p>
        {/if}
        {#each platformEntries as [platform, data]}
        {@const successPct = pct(data.posted, data.total)}
        {@const color = platformColors[platform] ?? '#666'}
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:{color}"></span>
              <span class="text-sm text-white">{platformLabel(platform)}</span>
            </div>
            <div class="flex items-center gap-3 text-xs">
              <span class="text-green-400">{data.posted}/{data.total}</span>
              {#if data.failed > 0}<span class="text-red-400">{data.failed} failed</span>{/if}
              <span class="text-white font-medium w-8 text-right">{successPct}%</span>
            </div>
          </div>
          <div class="h-2 bg-surface rounded-full overflow-hidden flex">
            <div class="h-full rounded-l-full" style="width:{(data.posted/maxPlatformTotal)*100}%; background:{color}; opacity:0.85"></div>
            {#if data.failed > 0}
            <div class="h-full" style="width:{(data.failed/maxPlatformTotal)*100}%; background:#ef4444; opacity:0.7"></div>
            {/if}
          </div>
        </div>
        {/each}
      </div>
    </div>

    <!-- Per-client breakdown -->
    <div class="card">
      <div class="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 class="font-medium text-white text-sm">By Client</h2>
        <span class="text-xs text-muted">Click for full report</span>
      </div>
      {#if stats.by_client.length === 0}
        <p class="text-xs text-muted text-center py-6">No data for this period.</p>
      {:else}
      <div class="divide-y divide-border">
        {#each stats.by_client as c}
        {@const cp = pct(c.posted, c.total)}
        <a
          href="/reports/{c.slug}?month={selectedMonth}"
          class="px-5 py-3.5 flex items-center gap-4 hover:bg-surface transition-colors"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm text-white font-medium">{c.canonical_name}</div>
            <div class="text-xs text-muted mt-0.5 flex gap-2">
              <span>{c.total} post{c.total !== 1 ? 's' : ''}</span>
              {#if c.scheduled > 0}<span class="text-yellow-400">{c.scheduled} pending</span>{/if}
            </div>
          </div>
          <div class="flex-shrink-0 w-32">
            <div class="flex justify-between text-[11px] mb-1">
              <span class="text-green-400">{c.posted} published</span>
              {#if c.failed > 0}<span class="text-red-400">{c.failed} failed</span>{/if}
            </div>
            <div class="h-1.5 bg-border rounded-full overflow-hidden">
              <div class="h-full bg-green-500 rounded-full" style="width:{cp}%"></div>
            </div>
          </div>
          <span class="text-sm font-medium {cp >= 80 ? 'text-green-400' : cp >= 50 ? 'text-yellow-400' : 'text-muted'} w-10 text-right flex-shrink-0">{cp}%</span>
        </a>
        {/each}
      </div>
      {/if}
    </div>
  </div>

  <!-- Status breakdown (detail) -->
  {#if stats.by_status.length > 0}
  <div class="card mt-6">
    <div class="px-5 py-4 border-b border-border">
      <h2 class="font-medium text-white text-sm">All Statuses</h2>
    </div>
    <div class="px-5 py-4 flex flex-wrap gap-4">
      {#each stats.by_status as s}
      <div class="flex items-center gap-2">
        <Badge status={s.status} />
        <span class="text-sm font-bold text-white">{s.count}</span>
      </div>
      {/each}
    </div>
  </div>
  {/if}

{/if}
