<script lang="ts">
  import { onMount } from 'svelte';
  import { portalApi } from '$lib/api';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { PortalReport } from '$lib/api/portal';
  import { PLATFORM_META } from '$lib/types';

  let data: PortalReport | null = null;
  let loading = true;
  let error   = '';

  const now      = new Date();
  let fromStr    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let toStr      = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${lastDay}`;

  const presets = [
    {
      label: 'This month',
      from: () => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
      to:   () => toStr,
    },
    {
      label: 'Last month',
      from: () => {
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      },
      to: () => {
        const d = new Date(now.getFullYear(), now.getMonth(), 0);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getDate()}`;
      },
    },
    {
      label: 'Last 3 months',
      from: () => {
        const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      },
      to: () => toStr,
    },
  ];

  async function load() {
    loading = true; error = '';
    try { data = await portalApi.report({ from: fromStr, to: toStr }); }
    catch  { error = 'Failed to load report.'; }
    finally { loading = false; }
  }

  function setPreset(p: typeof presets[0]) {
    fromStr = p.from(); toStr = p.to(); load();
  }

  onMount(load);

  function platformLabel(p: string) { return PLATFORM_META[p]?.label ?? p; }
  function platformColor(p: string) { return PLATFORM_META[p]?.color ?? '#888'; }

  $: byPlatform = data ? groupByPlatform(data.post_platforms) : [];
  $: publishedPosts = data?.post_platforms.filter(p => p.status === 'posted') ?? [];
  $: uniquePublished = (() => {
    if (!data) return [];
    const seen = new Set<string>();
    return data.post_platforms
      .filter(p => p.status === 'posted')
      .filter(p => { if (seen.has(p.post_id)) return false; seen.add(p.post_id); return true; });
  })();

  function groupByPlatform(rows: PortalReport['post_platforms']) {
    const map: Record<string, { total: number; ok: number }> = {};
    for (const r of rows) {
      if (!map[r.platform]) map[r.platform] = { total: 0, ok: 0 };
      map[r.platform].total++;
      if (r.status === 'posted') map[r.platform].ok++;
    }
    return Object.entries(map)
      .map(([p, v]) => ({ platform: p, ...v }))
      .sort((a, b) => b.ok - a.ok);
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
</script>

<svelte:head><title>Report — WebXni Portal</title></svelte:head>

<div class="max-w-4xl mx-auto space-y-6">

  <!-- Header + date controls -->
  <div class="card p-5">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-white">Performance Report</h1>
        {#if data}
          <p class="text-sm text-muted mt-0.5">{data.client.canonical_name}</p>
        {/if}
      </div>
      <div class="flex flex-col gap-2 items-end">
        <!-- Quick presets -->
        <div class="flex gap-1.5">
          {#each presets as p}
            <button
              class="text-xs px-3 py-1.5 rounded-full border border-border text-muted hover:text-white hover:border-border/60 transition-all"
              on:click={() => setPreset(p)}
            >{p.label}</button>
          {/each}
        </div>
        <!-- Custom range -->
        <div class="flex items-center gap-2">
          <input type="date" bind:value={fromStr} class="input text-xs py-1.5" />
          <span class="text-muted text-xs">to</span>
          <input type="date" bind:value={toStr} class="input text-xs py-1.5" />
          <button class="btn-primary btn-sm text-xs px-3" on:click={load}>Apply</button>
        </div>
      </div>
    </div>
  </div>

  {#if loading}
    <div class="flex justify-center py-16"><Spinner size="lg" /></div>
  {:else if error}
    <div class="card p-8 text-center text-red-400 text-sm">{error}</div>
  {:else if data}

    <!-- Summary cards -->
    <div class="grid grid-cols-3 gap-4">
      <div class="card p-5 text-center">
        <div class="text-3xl font-bold text-white">{data.summary.total}</div>
        <div class="text-xs text-muted mt-1.5 font-medium">Total Posts</div>
        <div class="text-xs text-muted mt-0.5">{fromStr} – {toStr}</div>
      </div>
      <div class="card p-5 text-center">
        <div class="text-3xl font-bold text-green-400">{data.summary.published}</div>
        <div class="text-xs text-muted mt-1.5 font-medium">Published</div>
        <div class="text-xs text-muted mt-0.5">across all platforms</div>
      </div>
      <div class="card p-5 text-center">
        <div class="relative inline-flex items-center justify-center">
          <svg class="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1e293b" stroke-width="3.5"/>
            <circle cx="18" cy="18" r="15.9" fill="none"
              stroke={data.summary.success_rate >= 80 ? '#22c55e' : data.summary.success_rate >= 50 ? '#f59e0b' : '#ef4444'}
              stroke-width="3.5"
              stroke-dasharray="{data.summary.success_rate} {100 - data.summary.success_rate}"
              stroke-linecap="round"
            />
          </svg>
          <span class="absolute text-base font-bold text-white">{data.summary.success_rate}%</span>
        </div>
        <div class="text-xs text-muted mt-1 font-medium">Success Rate</div>
      </div>
    </div>

    <!-- Platform breakdown -->
    {#if byPlatform.length > 0}
    <div class="card">
      <div class="px-5 py-3.5 border-b border-border">
        <h2 class="text-sm font-semibold text-white">Platform Breakdown</h2>
      </div>
      <div class="px-5 py-2 divide-y divide-border">
        {#each byPlatform as row}
        <div class="py-3 flex items-center gap-4">
          <div class="flex items-center gap-2.5 w-36 shrink-0">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:{platformColor(row.platform)}"></span>
            <span class="text-sm text-white truncate">{platformLabel(row.platform)}</span>
          </div>
          <div class="flex-1">
            <div class="h-1.5 bg-border rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all"
                style="width:{row.total > 0 ? (row.ok / row.total * 100) : 0}%; background:{platformColor(row.platform)}"
              ></div>
            </div>
          </div>
          <div class="w-20 text-right shrink-0">
            <span class="text-sm font-medium text-white">{row.ok}</span>
            <span class="text-xs text-muted">/{row.total} posts</span>
          </div>
        </div>
        {/each}
      </div>
    </div>
    {/if}

    <!-- Published content with live links -->
    {#if publishedPosts.length > 0}
    <div class="card">
      <div class="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <h2 class="text-sm font-semibold text-white">Published Content</h2>
        <span class="text-xs text-muted">{publishedPosts.length} item{publishedPosts.length === 1 ? '' : 's'}</span>
      </div>
      <div class="divide-y divide-border">
        {#each publishedPosts as item}
        <div class="px-5 py-3.5 flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-white truncate">{item.title}</p>
            <p class="text-xs text-muted mt-0.5">{fmtDate(item.publish_date)}</p>
          </div>
          <div class="flex items-center gap-2.5 shrink-0">
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              style="background:{platformColor(item.platform)}18; color:{platformColor(item.platform)}"
            >{platformLabel(item.platform)}</span>
            {#if item.real_url}
              <a
                href={item.real_url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs font-medium hover:underline flex items-center gap-0.5"
                style="color:{platformColor(item.platform)}"
              >View ↗</a>
            {:else}
              <span class="text-xs text-muted">No link</span>
            {/if}
          </div>
        </div>
        {/each}
      </div>
    </div>
    {/if}

    {#if data.summary.total === 0}
      <div class="card p-12 text-center">
        <p class="text-muted text-sm">No posts found for this period.</p>
        <p class="text-xs text-muted mt-1">Try adjusting the date range.</p>
      </div>
    {/if}
  {/if}
</div>
