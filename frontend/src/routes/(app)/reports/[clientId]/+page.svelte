<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { reportsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { formatDate, currentMonth, monthRange, parsePlatforms } from '$lib/utils';
  import type { MonthlyReport } from '$lib/types';

  let report: MonthlyReport | null = null;
  let loading = true;
  let error = '';

  const months = monthRange(12, 3);
  let selectedMonth = $page.url.searchParams.get('month') ?? currentMonth();

  async function load() {
    loading = true;
    error = '';
    try {
      report = await reportsApi.monthly($page.params.clientId ?? '', selectedMonth);
    } catch (e) { error = String(e); }
    finally { loading = false; }
  }

  onMount(load);
  $: selectedMonth, load();

  function pct(n: number, d: number) { return d ? Math.round((n / d) * 100) : 0; }

  function printReport() { window.print(); }

  interface PlatformRow { post_id?: string; platform: string; real_url: string | null; status: string; title: string; publish_date: string; }
  interface PlatformStat { total: number; posted: number; failed: number; }

  function getPlatRows(rep: MonthlyReport): PlatformRow[] {
    return rep.platforms as unknown as PlatformRow[];
  }

  // Build a lookup: post_id (or title fallback) → platform rows
  $: urlsByPost = report
    ? getPlatRows(report).reduce<Record<string, PlatformRow[]>>((acc, r) => {
        const key = r.post_id ?? r.title;
        if (!acc[key]) acc[key] = [];
        acc[key].push(r);
        return acc;
      }, {})
    : {};

  function getPostUrls(rep: MonthlyReport, postId: string, postTitle: string): PlatformRow[] {
    return getPlatRows(rep).filter(r => r.post_id === postId || (!r.post_id && r.title === postTitle));
  }

  // Platform success summary
  $: platformStats = report
    ? getPlatRows(report).reduce<Record<string, PlatformStat>>((acc, r) => {
        if (!acc[r.platform]) acc[r.platform] = { total: 0, posted: 0, failed: 0 };
        acc[r.platform].total++;
        if (r.status === 'sent' || r.status === 'posted') acc[r.platform].posted++;
        if (r.status === 'failed') acc[r.platform].failed++;
        return acc;
      }, {})
    : {};

  $: platformStatEntries = Object.entries(platformStats).sort((a, b) => b[1].total - a[1].total);
  $: maxPlatTotal = platformStatEntries.reduce((m, [, d]) => Math.max(m, d.total), 1);

  const platformColors: Record<string, string> = {
    facebook: '#1877F2', instagram: '#E1306C', linkedin: '#0A66C2',
    x: '#E7E9EA', threads: '#AAAAAA', tiktok: '#EE1D52', pinterest: '#E60023',
    bluesky: '#0085FF', youtube: '#FF0000', google_business: '#4285F4',
  };

  function platformLabel(p: string) {
    return ({ google_business: 'Google Business', x: 'X / Twitter', website_blog: 'Blog' })[p]
      ?? p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
</script>

<svelte:head>
  <title>
    {report?.client.canonical_name ?? 'Report'} · {selectedMonth} — WebXni
  </title>
</svelte:head>

<div class="page-header print:hidden">
  <div>
    <div class="flex items-center gap-2 text-xs text-muted mb-1">
      <a href="/reports" class="hover:text-white">Reports</a>
      <span>/</span>
      <span>{report?.client.canonical_name ?? $page.params.clientId}</span>
    </div>
    <h1 class="page-title">{report?.client.canonical_name ?? '…'}</h1>
    <p class="page-subtitle">Monthly Report</p>
  </div>
  <div class="flex items-center gap-3">
    <select bind:value={selectedMonth} class="input text-sm w-36">
      {#each months as m}
        <option value={m.value}>{m.label}</option>
      {/each}
    </select>
    <button class="btn-secondary btn-sm" on:click={printReport}>Print / PDF</button>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20 print:hidden"><Spinner size="lg" /></div>
{:else if error}
  <div class="text-red-400 text-sm">{error}</div>
{:else if report}

<!-- ===== PRINTABLE REPORT ===== -->
<div class="print-report">

  <!-- Report Header (visible in print) -->
  <div class="hidden print:block mb-8">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">{report.client.canonical_name}</h1>
        <p class="text-sm text-muted mt-1">Monthly Marketing Report · {report.period.month}</p>
      </div>
      <div class="text-right text-xs text-muted">
        <div>WebXni Marketing</div>
        <div class="font-mono">{report.period.from} – {report.period.to}</div>
      </div>
    </div>
    <hr class="border-border mt-4" />
  </div>

  <!-- Summary metrics -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
    <div class="card p-4 text-center">
      <div class="text-3xl font-bold text-white">{report.summary.total}</div>
      <div class="text-xs text-muted mt-1">Total Posts</div>
    </div>
    <div class="card p-4 text-center">
      <div class="text-3xl font-bold text-green-400">{report.summary.posted}</div>
      <div class="text-xs text-muted mt-1">Published</div>
    </div>
    <div class="card p-4 text-center">
      <div class="text-3xl font-bold text-red-400">{report.summary.failed}</div>
      <div class="text-xs text-muted mt-1">Failed</div>
    </div>
    <div class="card p-4 text-center">
      <div class="text-3xl font-bold text-accent">{report.summary.success_rate}%</div>
      <div class="text-xs text-muted mt-1">Success Rate</div>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

    <!-- Platform performance chart -->
    <div class="card p-5">
      <h2 class="font-medium text-white text-sm mb-4">Platform Performance</h2>
      {#if platformStatEntries.length === 0}
        <p class="text-xs text-muted">No platform data yet.</p>
      {:else}
      <div class="space-y-3">
        {#each platformStatEntries as [platform, data]}
        {@const sp = pct(data.posted, data.total)}
        {@const color = platformColors[platform] ?? '#666'}
        <div>
          <div class="flex items-center justify-between mb-1 text-xs">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full" style="background:{color}"></span>
              <span class="text-white">{platformLabel(platform)}</span>
            </div>
            <span class="text-muted">{data.posted}/{data.total} · <span class="text-white font-medium">{sp}%</span></span>
          </div>
          <div class="h-1.5 bg-surface rounded-full overflow-hidden">
            <div class="h-full rounded-full" style="width:{(data.total/maxPlatTotal)*100}%; background:{color}; opacity:0.25"></div>
            <div class="h-full rounded-full -mt-1.5" style="width:{(data.posted/maxPlatTotal)*100}%; background:{color}"></div>
          </div>
        </div>
        {/each}
      </div>
      {/if}
    </div>

    <!-- Posts this period -->
    <div class="card lg:col-span-2">
      <div class="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 class="font-medium text-white text-sm">Posts This Period</h2>
        <span class="text-xs text-muted">{report.posts.length} total</span>
      </div>
      {#if report.posts.length === 0}
        <p class="text-sm text-muted text-center py-6">No posts this period.</p>
      {:else}
      <div class="divide-y divide-border">
        {#each report.posts as post}
        {@const postPlatforms = getPostUrls(report, post.id, post.title ?? '')}
        {@const liveUrls = postPlatforms.filter(r => r.real_url)}
        <div class="px-5 py-3">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <a href="/posts/{post.id}" class="text-sm text-white hover:text-accent font-medium">{post.title ?? '(untitled)'}</a>
                <Badge status={post.status ?? 'draft'} />
              </div>
              <div class="flex items-center gap-3 mt-1">
                <span class="text-xs text-muted">{post.publish_date ? formatDate(post.publish_date) : '—'}</span>
                <span class="text-xs text-muted capitalize">{post.content_type ?? ''}</span>
              </div>
            </div>
            <div class="flex flex-wrap gap-1 flex-shrink-0">
              {#each parsePlatforms(post.platforms) as p}
                <PlatformBadge platform={p} size="sm" />
              {/each}
            </div>
          </div>
          <!-- Live URLs inline -->
          {#if liveUrls.length > 0}
          <div class="flex flex-wrap gap-2 mt-2">
            {#each liveUrls as r}
            {@const rurl = r.real_url ?? ''}
            <a href={rurl} target="_blank"
               class="inline-flex items-center gap-1 text-[11px] text-accent hover:underline bg-accent/10 px-2 py-0.5 rounded">
              <PlatformBadge platform={r.platform} size="sm" />
              View on {platformLabel(r.platform)} →
            </a>
            {/each}
          </div>
          {/if}
        </div>
        {/each}
      </div>
      {/if}
    </div>

  </div>

  <!-- Failed posts -->
  {#if report.failed_detail.length > 0}
  <div class="card mb-6">
    <div class="px-5 py-4 border-b border-border">
      <h2 class="font-medium text-white text-sm text-red-400">Failed Posts</h2>
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Post</th>
            <th>Platform</th>
            <th>Date</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {#each report.failed_detail as f}
            <tr>
              <td class="text-sm text-white">{f.title}</td>
              <td><PlatformBadge platform={f.platform} size="sm" /></td>
              <td class="text-xs text-muted">{formatDate(f.publish_date)}</td>
              <td class="text-xs text-red-400 max-w-xs truncate">{f.error_message}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
  {/if}

  <!-- Footer (print only) -->
  <div class="hidden print:block mt-12 pt-4 border-t border-border text-xs text-muted text-center">
    Generated by WebXni Marketing Platform · {new Date().toLocaleDateString()}
  </div>
</div>

{/if}

<style>
  @media print {
    :global(.page-header) { display: none !important; }
    :global(nav), :global(aside), :global(.sidebar), :global(.topbar) { display: none !important; }
    :global(body) { background: white !important; color: #111 !important; }
    :global(.card) { border: 1px solid #ddd !important; background: white !important; }
    :global(.text-white) { color: #111 !important; }
    :global(.text-muted) { color: #666 !important; }
    :global(.text-accent) { color: #5b21b6 !important; }
    :global(.text-green-400) { color: #059669 !important; }
    :global(.text-red-400) { color: #dc2626 !important; }
    :global(.border-border) { border-color: #e5e7eb !important; }
    :global(.bg-surface), :global(.bg-bg) { background: white !important; }
  }
</style>
