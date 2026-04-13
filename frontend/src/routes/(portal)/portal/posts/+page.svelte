<script lang="ts">
  import { onMount } from 'svelte';
  import { portalApi } from '$lib/api';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { PortalPost } from '$lib/api/portal';
  import { PLATFORM_META } from '$lib/types';

  let posts: PortalPost[] = [];
  let total   = 0;
  let page    = 1;
  let pages   = 1;
  let loading = true;
  let statusFilter = '';

  const statuses = ['', 'draft', 'pending_approval', 'approved', 'ready', 'scheduled', 'posted', 'failed'];

  async function load() {
    loading = true;
    try {
      const r = await portalApi.posts({ page, limit: 20, status: statusFilter || undefined });
      posts = r.posts; total = r.total; pages = r.pages;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function platformLabel(p: string) { return PLATFORM_META[p]?.label ?? p; }
  function platformColor(p: string) { return PLATFORM_META[p]?.color ?? '#888'; }

  function statusClass(s: string) {
    if (s === 'posted')    return 'bg-green-500/10 text-green-400';
    if (s === 'failed')    return 'bg-red-500/10 text-red-400';
    if (s === 'scheduled') return 'bg-accent/10 text-accent';
    if (s === 'approved' || s === 'ready') return 'bg-yellow-500/10 text-yellow-400';
    return 'bg-card text-muted';
  }

  function parsePlatforms(raw: string): string[] {
    try { return JSON.parse(raw); } catch { return []; }
  }
</script>

<svelte:head><title>Posts — WebXni Portal</title></svelte:head>

<div class="max-w-4xl mx-auto space-y-4">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-xl font-semibold text-white">Posts</h1>
      <p class="text-sm text-muted mt-0.5">{total} total</p>
    </div>
    <select bind:value={statusFilter} on:change={() => { page = 1; load(); }} class="input text-sm">
      <option value="">All statuses</option>
      {#each statuses.slice(1) as s}
        <option value={s}>{s.replace('_', ' ')}</option>
      {/each}
    </select>
  </div>

  {#if loading}
    <div class="flex justify-center py-16"><Spinner size="lg" /></div>
  {:else if posts.length === 0}
    <div class="card p-8 text-center text-muted text-sm">No posts found.</div>
  {:else}
    <div class="card divide-y divide-border">
      {#each posts as post}
      <div class="px-5 py-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-white truncate">{post.title || '(untitled)'}</p>
            <div class="flex items-center gap-3 mt-1">
              <span class="text-xs text-muted">
                {post.publish_date ? new Date(post.publish_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </span>
              <span class="text-xs text-muted capitalize">{post.content_type ?? ''}</span>
            </div>
            <!-- Platforms -->
            <div class="flex flex-wrap gap-1.5 mt-2">
              {#each parsePlatforms(post.platforms) as p}
                <span
                  class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
                  style="background:{platformColor(p)}22; color:{platformColor(p)}"
                >{platformLabel(p)}</span>
              {/each}
            </div>
          </div>
          <span class="text-xs shrink-0 capitalize px-2 py-0.5 rounded-full {statusClass(post.status ?? '')}">
            {(post.status ?? '').replace('_', ' ')}
          </span>
        </div>

        <!-- Live URLs -->
        {#if post.post_urls && post.post_urls.some(u => u.real_url)}
        <div class="mt-2 flex flex-wrap gap-2">
          {#each post.post_urls.filter(u => u.real_url) as u}
            <a
              href={u.real_url}
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-accent hover:underline"
            >View on {platformLabel(u.platform)} ↗</a>
          {/each}
        </div>
        {/if}
      </div>
      {/each}
    </div>

    <!-- Pagination -->
    {#if pages > 1}
    <div class="flex items-center justify-center gap-2 pt-2">
      <button
        class="btn-ghost btn-sm text-xs"
        disabled={page <= 1}
        on:click={() => { page -= 1; load(); }}
      >← Previous</button>
      <span class="text-xs text-muted">Page {page} of {pages}</span>
      <button
        class="btn-ghost btn-sm text-xs"
        disabled={page >= pages}
        on:click={() => { page += 1; load(); }}
      >Next →</button>
    </div>
    {/if}
  {/if}
</div>
