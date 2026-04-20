<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { reportsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { PLATFORM_META, type MetricTotals, type MonthlyReport, type ReportPlatformRow } from '$lib/types';
  import { currentMonth, formatDate, monthRange } from '$lib/utils';

  let report: MonthlyReport | null = null;
  let loading = true;
  let error = '';

  const months = monthRange(12, 3);
  let selectedMonth = $page.url.searchParams.get('month') ?? currentMonth();
  let useCustomRange = Boolean($page.url.searchParams.get('from') || $page.url.searchParams.get('to'));
  let customFrom = $page.url.searchParams.get('from') ?? '';
  let customTo = $page.url.searchParams.get('to') ?? '';
  let selectedPlatform = $page.url.searchParams.get('platform') ?? '';
  let lastQueryKey = '';

  function formatNumber(value: number | null | undefined): string {
    if (value == null) return '—';
    return new Intl.NumberFormat('en-US').format(value);
  }

  function metricList(metrics: MetricTotals): { key: keyof MetricTotals; label: string; value: number }[] {
    const labels: Record<keyof MetricTotals, string> = {
      impressions: 'Impressions',
      likes: 'Likes',
      comments: 'Comments',
      shares: 'Shares',
      saves: 'Saves',
      views: 'Views',
      reach: 'Reach',
      followers: 'Followers',
    };
    return (Object.entries(metrics) as [keyof MetricTotals, number | null][])
      .filter(([, value]) => value != null)
      .map(([key, value]) => ({ key, label: labels[key], value: value ?? 0 }));
  }

  function compactMetrics(metrics: MetricTotals, limit = 4): string[] {
    return metricList(metrics)
      .filter((row) => row.key !== 'followers')
      .slice(0, limit)
      .map((row) => `${row.label} ${formatNumber(row.value)}`);
  }

  function platformMeta(platform: string) {
    return PLATFORM_META[platform] ?? { label: platform.replace(/_/g, ' '), color: '#94a3b8' };
  }

  async function load() {
    if (useCustomRange && (!customFrom || !customTo)) return;
    loading = true;
    error = '';
    try {
      report = await reportsApi.monthly($page.params.clientId ?? '', useCustomRange
        ? { from: customFrom, to: customTo, platform: selectedPlatform || undefined }
        : { month: selectedMonth, platform: selectedPlatform || undefined });
      if (browser) {
        const qs = new URLSearchParams();
        if (useCustomRange) {
          qs.set('from', customFrom);
          qs.set('to', customTo);
        } else {
          qs.set('month', selectedMonth);
        }
        if (selectedPlatform) qs.set('platform', selectedPlatform);
        window.history.replaceState({}, '', `${$page.url.pathname}?${qs}`);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function refresh() {
    const queryKey = useCustomRange
      ? `custom:${customFrom}:${customTo}:${selectedPlatform}`
      : `month:${selectedMonth}:${selectedPlatform}`;
    if (queryKey === lastQueryKey) return;
    lastQueryKey = queryKey;
    load();
  }

  onMount(refresh);
  $: refresh();

  $: platformOptions = report?.platform_breakdown.map((row) => row.platform) ?? [];

  const topCards = [
    { key: 'total', label: 'Total posts' },
    { key: 'posted', label: 'Posted' },
    { key: 'failed', label: 'Failed' },
    { key: 'success_rate', label: 'Success rate', suffix: '%' },
    { key: 'total_impressions', label: 'Total impressions' },
    { key: 'likes', label: 'Likes' },
    { key: 'comments', label: 'Comments' },
    { key: 'shares', label: 'Shares' },
    { key: 'saves', label: 'Saves' },
  ] as const;

  function topCardValue(key: typeof topCards[number]['key']): string {
    if (!report) return '—';
    if (key === 'total') return formatNumber(report.summary.total);
    if (key === 'posted') return formatNumber(report.summary.posted);
    if (key === 'failed') return formatNumber(report.summary.failed);
    if (key === 'success_rate') return formatNumber(report.summary.success_rate);
    if (key === 'total_impressions') return formatNumber(report.summary.total_impressions);
    return formatNumber(report.summary.metrics[key as keyof MetricTotals] ?? null);
  }

  function isLive(row: ReportPlatformRow): boolean {
    return Boolean(row.real_url);
  }
</script>

<svelte:head>
  <title>{report?.client.canonical_name ?? 'Report'} — WebXni</title>
</svelte:head>

<div class="page-header">
  <div>
    <div class="flex items-center gap-2 text-xs text-muted mb-1">
      <a href="/reports" class="hover:text-white">Reports</a>
      <span>/</span>
      <span>{report?.client.canonical_name ?? $page.params.clientId}</span>
    </div>
    <h1 class="page-title">{report?.client.canonical_name ?? 'Client report'}</h1>
    <p class="page-subtitle">
      Posted history, published links, and KPI totals for the selected reporting range.
    </p>
  </div>

  <div class="flex flex-wrap items-center gap-3">
    <div class="flex rounded-lg border border-border overflow-hidden text-xs">
      <button
        class="px-3 py-1.5 transition-colors {!useCustomRange ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}"
        on:click={() => { useCustomRange = false; }}
      >Month</button>
      <button
        class="px-3 py-1.5 transition-colors {useCustomRange ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}"
        on:click={() => { useCustomRange = true; }}
      >Custom</button>
    </div>

    {#if useCustomRange}
      <input type="date" bind:value={customFrom} class="input text-sm" />
      <input type="date" bind:value={customTo} class="input text-sm" />
    {:else}
      <select bind:value={selectedMonth} class="input text-sm w-40">
        {#each months as month}
          <option value={month.value}>{month.label}</option>
        {/each}
      </select>
    {/if}

    <select bind:value={selectedPlatform} class="input text-sm w-44">
      <option value="">All platforms</option>
      {#each platformOptions as platform}
        <option value={platform}>{platformMeta(platform).label}</option>
      {/each}
    </select>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if error}
  <div class="card p-5 text-sm text-red-400">{error}</div>
{:else if report}
  <section class="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
    {#each topCards as card}
      <div class="card p-4">
        <div class="text-[11px] uppercase tracking-[0.14em] text-muted">{card.label}</div>
        <div class="mt-2 text-2xl font-semibold text-white">
          {topCardValue(card.key)}{'suffix' in card ? card.suffix : ''}
        </div>
      </div>
    {/each}
  </section>

  <section class="grid grid-cols-1 xl:grid-cols-[1.25fr,0.75fr] gap-6 mb-6">
    <div class="card p-5">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 class="text-sm font-semibold text-white">Platform performance</h2>
          <p class="text-xs text-muted mt-1">Published rows, link coverage, and available metric totals.</p>
        </div>
        <div class="text-xs text-muted">{report.period.from} to {report.period.to}</div>
      </div>

      {#if report.platform_breakdown.length === 0}
        <div class="text-sm text-muted py-10 text-center">No posted platforms in this range.</div>
      {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {#each report.platform_breakdown as row}
            {@const meta = platformMeta(row.platform)}
            <div class="rounded-xl border border-border bg-bg/55 p-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="inline-flex items-center gap-2 text-sm font-medium text-white">
                    <span class="w-2.5 h-2.5 rounded-full" style="background:{meta.color}"></span>
                    {meta.label}
                  </div>
                  <div class="mt-1 text-xs text-muted">
                    {row.posted}/{row.total} posted • {row.failed} failed • {row.links} live links
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-lg font-semibold text-white">{row.success_rate}%</div>
                  <div class="text-[11px] text-muted">success</div>
                </div>
              </div>

              <div class="mt-3 h-2 rounded-full bg-surface overflow-hidden">
                <div class="h-full rounded-full" style="width:{row.success_rate}%; background:{meta.color}"></div>
              </div>

              <div class="mt-4 flex flex-wrap gap-2">
                {#each compactMetrics(row.metrics, 4) as metric}
                  <span class="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted">{metric}</span>
                {/each}
                {#if row.profile.followers != null}
                  <span class="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted">
                    Followers {formatNumber(row.profile.followers)}
                  </span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="card p-5">
      <h2 class="text-sm font-semibold text-white">Range summary</h2>
      <div class="mt-4 space-y-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-muted">Selected range</span>
          <span class="text-white">{report.period.from} to {report.period.to}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted">Platform filter</span>
          <span class="text-white">{selectedPlatform ? platformMeta(selectedPlatform).label : 'All platforms'}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted">Published history rows</span>
          <span class="text-white">{formatNumber(report.posts.length)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted">Profile impressions</span>
          <span class="text-white">{formatNumber(report.profile_analytics.total_impressions)}</span>
        </div>
      </div>

      <div class="mt-5 pt-5 border-t border-border">
        <h3 class="text-xs uppercase tracking-[0.14em] text-muted">Available metrics</h3>
        <div class="mt-3 flex flex-wrap gap-2">
          {#each compactMetrics(report.summary.metrics, 6) as metric}
            <span class="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted">{metric}</span>
          {/each}
        </div>
      </div>
    </div>
  </section>

  <section class="card overflow-hidden">
    <div class="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-white">Published history</h2>
        <p class="text-xs text-muted mt-1">Operational work stays on Posts. Published links and results live here.</p>
      </div>
      <div class="text-xs text-muted">{report.posts.length} post{report.posts.length === 1 ? '' : 's'}</div>
    </div>

    {#if report.posts.length === 0}
      <div class="py-12 text-center text-sm text-muted">No reported posts in this range.</div>
    {:else}
      <div class="divide-y divide-border">
        {#each report.posts as post}
          <article class="px-5 py-4">
            <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <a href="/posts/{post.id}" class="text-base font-medium text-white hover:text-accent">{post.title ?? '(untitled)'}</a>
                  <Badge status={post.status ?? 'draft'} />
                  <span class="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted capitalize">{post.content_type ?? '—'}</span>
                </div>

                <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{post.publish_date ? formatDate(post.publish_date) : '—'}</span>
                  <span>{post.actual_platforms.length > 0 ? `${post.actual_platforms.length} platform${post.actual_platforms.length === 1 ? '' : 's'} posted` : 'No live platforms yet'}</span>
                  {#each compactMetrics(post.metrics, 4) as metric}
                    <span>{metric}</span>
                  {/each}
                </div>
              </div>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              {#each post.platform_rows as row}
                {@const meta = platformMeta(row.platform)}
                {#if isLive(row)}
                  <a
                    href={row.real_url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
                    style="border-color:{meta.color}40; color:{meta.color};"
                    title={`Open on ${meta.label}`}
                  >
                    <span>{meta.label}</span>
                    <span class="text-[10px] opacity-70">↗</span>
                  </a>
                {:else}
                  <span
                    class="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted opacity-70"
                    title={row.metrics_error ?? row.error_message ?? `No published link for ${meta.label}`}
                  >
                    <span>{meta.label}</span>
                    <span class="text-[10px]">Unavailable</span>
                  </span>
                {/if}
              {/each}
            </div>

            {#if post.platform_rows.some((row) => metricList(row.metrics).length > 0 || row.metrics_error)}
              <details class="mt-4 rounded-xl border border-border bg-bg/40">
                <summary class="cursor-pointer list-none px-4 py-3 text-xs font-medium text-muted">
                  View post metrics
                </summary>
                <div class="border-t border-border px-4 py-4 space-y-3">
                  {#each post.platform_rows as row}
                    {@const metrics = metricList(row.metrics)}
                    {#if metrics.length > 0 || row.metrics_error}
                      <div class="rounded-lg bg-surface/50 px-3 py-3">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm text-white">{platformMeta(row.platform).label}</div>
                          {#if row.metrics_synced_at}
                            <div class="text-[11px] text-muted">Synced {formatDate(row.metrics_synced_at)}</div>
                          {/if}
                        </div>

                        {#if metrics.length > 0}
                          <div class="mt-2 flex flex-wrap gap-2">
                            {#each metrics as metric}
                              <span class="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted">
                                {metric.label} {formatNumber(metric.value)}
                              </span>
                            {/each}
                          </div>
                        {/if}

                        {#if row.metrics_error}
                          <div class="mt-2 text-[11px] text-muted">{row.metrics_error}</div>
                        {/if}
                      </div>
                    {/if}
                  {/each}
                </div>
              </details>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if report.failed_detail.length > 0}
    <section class="card mt-6 overflow-hidden">
      <div class="px-5 py-4 border-b border-border">
        <h2 class="text-sm font-semibold text-white">Failed publishing attempts</h2>
      </div>
      <div class="divide-y divide-border">
        {#each report.failed_detail as failure}
          <div class="px-5 py-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <div class="text-sm text-white">{failure.title}</div>
              <div class="text-xs text-muted mt-1">{formatDate(failure.publish_date)} • {platformMeta(failure.platform).label}</div>
            </div>
            <div class="text-xs text-red-400 md:max-w-md">{failure.error_message}</div>
          </div>
        {/each}
      </div>
    </section>
  {/if}
{/if}
