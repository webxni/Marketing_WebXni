<script lang="ts">
  import { onMount } from 'svelte';
  import { reportsApi, clientsApi } from '$lib/api';
  import MetricCard from '$lib/components/ui/MetricCard.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { currentMonth, lastNMonths } from '$lib/utils';
  import type { PostingStats, Client } from '$lib/types';

  let stats: PostingStats | null = null;
  let clients: Client[] = [];
  let loading = true;
  let selectedMonth = currentMonth();
  let selectedClient = '';

  const months = lastNMonths(6);

  async function load() {
    loading = true;
    try {
      const params: Record<string, string> = { month: selectedMonth };
      if (selectedClient) params.client = selectedClient;
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

  function pct(posted: number, total: number) {
    return total ? Math.round((posted / total) * 100) : 0;
  }

  type PlatformRollup = { posted: number; failed: number; total: number };
  $: platformRollup = stats
    ? stats.by_platform.reduce<Record<string, PlatformRollup>>((acc, row) => {
        if (!acc[row.platform]) acc[row.platform] = { posted: 0, failed: 0, total: 0 };
        acc[row.platform].total += row.count;
        if (row.status === 'posted') acc[row.platform].posted += row.count;
        if (row.status === 'failed') acc[row.platform].failed += row.count;
        return acc;
      }, {})
    : {};

  const platformColors: Record<string, string> = {
    facebook: '#1877F2', instagram: '#E1306C', linkedin: '#0A66C2',
    x: '#555', threads: '#111', tiktok: '#010101', pinterest: '#E60023',
    bluesky: '#0085FF', youtube: '#FF0000', google_business: '#4285F4', website_blog: '#6366F1'
  };
</script>

<svelte:head><title>Reports — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Reports</h1>
    <p class="page-subtitle">Posting performance overview</p>
  </div>
</div>

<!-- Filters -->
<div class="flex items-center gap-3 mb-6">
  <select bind:value={selectedMonth} class="input text-sm w-40">
    {#each months as m}
      <option value={m.value}>{m.label}</option>
    {/each}
  </select>
  <select bind:value={selectedClient} class="input text-sm w-48">
    <option value="">All clients</option>
    {#each clients as c}
      <option value={c.slug}>{c.canonical_name}</option>
    {/each}
  </select>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if stats}

  <!-- Status breakdown -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
    {#each stats.by_status as s}
      <div class="card p-4">
        <div class="text-2xl font-bold text-white">{s.count}</div>
        <div class="text-xs text-muted mt-1 capitalize">{s.status}</div>
        <div class="mt-2"><Badge status={s.status} /></div>
      </div>
    {/each}
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Per-platform breakdown -->
    <div class="card">
      <div class="px-5 py-4 border-b border-border">
        <h2 class="font-medium text-white text-sm">By Platform</h2>
      </div>
      <div class="divide-y divide-border">
        {#each Object.entries(platformRollup) as [platform, data]}
          <div class="px-5 py-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span
                class="w-2 h-2 rounded-full"
                style="background:{platformColors[platform] ?? '#666'}"
              ></span>
              <span class="text-sm text-white capitalize">{platform.replace(/_/g, ' ')}</span>
            </div>
            <div class="flex items-center gap-4 text-xs text-muted">
              <span class="text-green-400">{data.posted} posted</span>
              {#if data.failed > 0}<span class="text-red-400">{data.failed} failed</span>{/if}
              <span>{pct(data.posted, data.total)}%</span>
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
      <div class="divide-y divide-border">
        {#each stats.by_client as c}
          <a href="/reports/{c.slug}?month={selectedMonth}" class="px-5 py-3 flex items-center justify-between hover:bg-surface transition-colors block">
            <div>
              <div class="text-sm text-white">{c.canonical_name}</div>
              <div class="text-xs text-muted">{c.total} posts</div>
            </div>
            <div class="flex items-center gap-3 text-xs">
              <span class="text-green-400">{c.posted} posted</span>
              {#if c.failed > 0}<span class="text-red-400">{c.failed} failed</span>{/if}
              <!-- Progress bar -->
              <div class="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                <div
                  class="h-full bg-green-500 rounded-full"
                  style="width:{pct(c.posted, c.total)}%"
                ></div>
              </div>
              <span class="text-muted w-8 text-right">{pct(c.posted, c.total)}%</span>
            </div>
          </a>
        {/each}
      </div>
    </div>
  </div>
{/if}
