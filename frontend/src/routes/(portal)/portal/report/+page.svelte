<script lang="ts">
  import { onMount } from 'svelte';
  import { portalApi } from '$lib/api';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { PortalReport } from '$lib/api/portal';
  import { PLATFORM_META } from '$lib/types';

  let data: PortalReport | null = null;
  let loading = true;
  let error   = '';

  // Default: current month
  const now   = new Date();
  let fromStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let toStr   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${lastDay}`;

  async function load() {
    loading = true; error = '';
    try {
      data = await portalApi.report({ from: fromStr, to: toStr });
    } catch {
      error = 'Failed to load report.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function platformLabel(p: string) { return PLATFORM_META[p]?.label ?? p; }
  function platformColor(p: string) { return PLATFORM_META[p]?.color ?? '#888'; }

  // Group post_platforms by platform for summary
  $: byPlatform = data ? groupByPlatform(data.post_platforms) : [];

  function groupByPlatform(rows: PortalReport['post_platforms']) {
    const map: Record<string, { total: number; ok: number }> = {};
    for (const r of rows) {
      if (!map[r.platform]) map[r.platform] = { total: 0, ok: 0 };
      map[r.platform].total++;
      if (r.status === 'posted') map[r.platform].ok++;
    }
    return Object.entries(map).map(([p, v]) => ({ platform: p, ...v }));
  }
</script>

<svelte:head><title>Report — WebXni Portal</title></svelte:head>

<div class="max-w-4xl mx-auto space-y-6">
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h1 class="text-xl font-semibold text-white">Monthly Report</h1>
      {#if data}
        <p class="text-sm text-muted mt-0.5">{data.client.canonical_name}</p>
      {/if}
    </div>
    <!-- Date range picker -->
    <div class="flex items-center gap-2">
      <input type="date" bind:value={fromStr} class="input text-sm" />
      <span class="text-muted text-sm">to</span>
      <input type="date" bind:value={toStr} class="input text-sm" />
      <button class="btn-primary btn-sm text-xs" on:click={load}>Apply</button>
    </div>
  </div>

  {#if loading}
    <div class="flex justify-center py-16"><Spinner size="lg" /></div>
  {:else if error}
    <div class="text-red-400 text-sm">{error}</div>
  {:else if data}
    <!-- Summary cards -->
    <div class="grid grid-cols-3 gap-4">
      <div class="card p-4 text-center">
        <div class="text-2xl font-bold text-white">{data.summary.total}</div>
        <div class="text-xs text-muted mt-1">Total Posts</div>
      </div>
      <div class="card p-4 text-center">
        <div class="text-2xl font-bold text-green-400">{data.summary.published}</div>
        <div class="text-xs text-muted mt-1">Published</div>
      </div>
      <div class="card p-4 text-center">
        <div class="text-2xl font-bold text-accent">
          {data.summary.success_rate.toFixed(0)}%
        </div>
        <div class="text-xs text-muted mt-1">Success Rate</div>
      </div>
    </div>

    <!-- Platform breakdown -->
    {#if byPlatform.length > 0}
    <div class="card">
      <div class="px-5 py-3 border-b border-border">
        <h2 class="text-sm font-medium text-white">Platform Breakdown</h2>
      </div>
      <div class="divide-y divide-border">
        {#each byPlatform as row}
        <div class="px-5 py-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full inline-block" style="background:{platformColor(row.platform)}"></span>
            <span class="text-sm text-white">{platformLabel(row.platform)}</span>
          </div>
          <div class="flex items-center gap-4">
            <span class="text-xs text-muted">{row.ok}/{row.total} posted</span>
            <!-- Mini progress bar -->
            <div class="w-20 h-1.5 bg-border rounded-full overflow-hidden">
              <div
                class="h-full rounded-full bg-green-500"
                style="width:{row.total > 0 ? (row.ok / row.total * 100) : 0}%"
              ></div>
            </div>
          </div>
        </div>
        {/each}
      </div>
    </div>
    {/if}

    <!-- Post list with live URLs -->
    {#if data.post_platforms.length > 0}
    <div class="card">
      <div class="px-5 py-3 border-b border-border">
        <h2 class="text-sm font-medium text-white">Published Content</h2>
      </div>
      <div class="divide-y divide-border">
        {#each data.post_platforms.filter(p => p.status === 'posted') as item}
        <div class="px-5 py-3 flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="text-sm text-white truncate">{item.title}</p>
            <p class="text-xs text-muted mt-0.5">
              {item.publish_date ? new Date(item.publish_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span
              class="text-xs px-1.5 py-0.5 rounded"
              style="background:{platformColor(item.platform)}22; color:{platformColor(item.platform)}"
            >{platformLabel(item.platform)}</span>
            {#if item.real_url}
              <a
                href={item.real_url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs text-accent hover:underline"
              >View ↗</a>
            {/if}
          </div>
        </div>
        {/each}
      </div>
    </div>
    {/if}
  {/if}
</div>
