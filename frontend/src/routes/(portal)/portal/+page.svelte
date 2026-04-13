<script lang="ts">
  import { onMount } from 'svelte';
  import { portalApi } from '$lib/api';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { PortalSummary } from '$lib/api/portal';
  import { PLATFORM_META } from '$lib/types';

  let data: PortalSummary | null = null;
  let loading = true;
  let error = '';

  onMount(async () => {
    try {
      data = await portalApi.summary();
    } catch (e) {
      error = 'Failed to load summary.';
    } finally {
      loading = false;
    }
  });

  function platformLabel(p: string) { return PLATFORM_META[p]?.label ?? p; }
  function platformColor(p: string) { return PLATFORM_META[p]?.color ?? '#888'; }
</script>

<svelte:head><title>Portal — WebXni</title></svelte:head>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if error}
  <div class="text-red-400 text-sm">{error}</div>
{:else if data}
  <div class="max-w-4xl mx-auto space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-xl font-semibold text-white">{data.client.canonical_name}</h1>
      <p class="text-sm text-muted mt-0.5">{data.period.month}</p>
    </div>

    <!-- Stats cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="card p-4 text-center">
        <div class="text-2xl font-bold text-white">{data.summary.total}</div>
        <div class="text-xs text-muted mt-1">Total Posts</div>
      </div>
      <div class="card p-4 text-center">
        <div class="text-2xl font-bold text-green-400">{data.summary.published}</div>
        <div class="text-xs text-muted mt-1">Published</div>
      </div>
      <div class="card p-4 text-center">
        <div class="text-2xl font-bold text-accent">{data.summary.scheduled}</div>
        <div class="text-xs text-muted mt-1">Scheduled</div>
      </div>
      <div class="card p-4 text-center">
        <div class="text-2xl font-bold text-red-400">{data.summary.failed}</div>
        <div class="text-xs text-muted mt-1">Failed</div>
      </div>
    </div>

    <!-- By platform -->
    {#if data.by_platform.length > 0}
    <div class="card">
      <div class="px-5 py-3 border-b border-border">
        <h2 class="text-sm font-medium text-white">By Platform</h2>
      </div>
      <div class="divide-y divide-border">
        {#each data.by_platform as row}
        <div class="px-5 py-2.5 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full inline-block" style="background:{platformColor(row.platform)}"></span>
            <span class="text-sm text-white">{platformLabel(row.platform)}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs text-muted capitalize">{row.status}</span>
            <span class="text-sm font-medium text-white">{row.count}</span>
          </div>
        </div>
        {/each}
      </div>
    </div>
    {/if}

    <!-- Recent posts -->
    {#if data.recent_posts.length > 0}
    <div class="card">
      <div class="px-5 py-3 border-b border-border flex items-center justify-between">
        <h2 class="text-sm font-medium text-white">Recent Posts</h2>
        <a href="/portal/posts" class="text-xs text-accent hover:underline">View all</a>
      </div>
      <div class="divide-y divide-border">
        {#each data.recent_posts as post}
        <div class="px-5 py-3">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-sm text-white truncate">{post.title || '(untitled)'}</p>
              <p class="text-xs text-muted mt-0.5">
                {post.publish_date ? new Date(post.publish_date).toLocaleDateString() : '—'}
                · {post.content_type ?? ''}
              </p>
            </div>
            <span class="text-xs shrink-0 capitalize px-2 py-0.5 rounded-full
              {post.status === 'posted' ? 'bg-green-500/10 text-green-400' :
               post.status === 'failed' ? 'bg-red-500/10 text-red-400' :
               post.status === 'scheduled' ? 'bg-accent/10 text-accent' :
               'bg-card text-muted'}">
              {post.status}
            </span>
          </div>
        </div>
        {/each}
      </div>
    </div>
    {/if}
  </div>
{/if}
