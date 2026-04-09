<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { reportsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { formatDate, currentMonth, lastNMonths, parsePlatforms } from '$lib/utils';
  import type { MonthlyReport } from '$lib/types';

  let report: MonthlyReport | null = null;
  let loading = true;
  let error = '';

  const months = lastNMonths(12);
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

  <!-- Posts table -->
  <div class="card mb-6">
    <div class="px-5 py-4 border-b border-border">
      <h2 class="font-medium text-white text-sm">Published Posts</h2>
    </div>
    {#if report.posts.filter(p => p.status === 'posted').length === 0}
      <p class="text-sm text-muted text-center py-6">No published posts this month.</p>
    {:else}
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Post</th>
            <th>Platforms</th>
            <th>Publish Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each report.posts.filter(p => p.status === 'posted') as post}
            <tr>
              <td>
                <div class="text-sm text-white">{post.title ?? '(untitled)'}</div>
                <div class="text-xs text-muted capitalize">{post.content_type ?? '—'}</div>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  {#each (parsePlatforms(post.platforms)) as p}
                    <PlatformBadge platform={p} size="sm" />
                  {/each}
                </div>
              </td>
              <td class="text-xs text-muted">{post.publish_date ? formatDate(post.publish_date) : '—'}</td>
              <td><Badge status={post.status ?? 'draft'} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {/if}
  </div>

  <!-- Published URLs -->
  {#if report.platforms.length > 0}
  <div class="card mb-6">
    <div class="px-5 py-4 border-b border-border">
      <h2 class="font-medium text-white text-sm">Live URLs</h2>
    </div>
    <div class="divide-y divide-border">
      {#each report.platforms.filter(p => p.real_url) as pt}
        <div class="px-5 py-3 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <PlatformBadge platform={pt.platform} size="sm" />
            <span class="text-sm text-white">{pt.title ?? '(untitled)'}</span>
          </div>
          <a href={pt.real_url ?? ''} target="_blank" class="text-xs text-accent hover:underline">
            View post →
          </a>
        </div>
      {/each}
    </div>
  </div>
  {/if}

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
