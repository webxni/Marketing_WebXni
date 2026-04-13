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

  const statuses = [
    { value: '',                 label: 'All Posts' },
    { value: 'posted',          label: 'Published' },
    { value: 'scheduled',       label: 'Scheduled' },
    { value: 'approved',        label: 'Approved' },
    { value: 'pending_approval',label: 'In Review' },
    { value: 'draft',           label: 'Draft' },
    { value: 'failed',          label: 'Failed' },
  ];

  async function load() {
    loading = true;
    try {
      const r = await portalApi.posts({ page, limit: 15, status: statusFilter || undefined });
      posts = r.posts; total = r.total; pages = r.pages;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function platformLabel(p: string) { return PLATFORM_META[p]?.label ?? p; }
  function platformColor(p: string) { return PLATFORM_META[p]?.color ?? '#888'; }

  function parsePlatforms(raw: string): string[] {
    try { return JSON.parse(raw); } catch { return []; }
  }

  function statusInfo(s: string) {
    const map: Record<string, { label: string; cls: string }> = {
      posted:           { label: 'Published',  cls: 'bg-green-500/10 text-green-400 border-green-500/20' },
      scheduled:        { label: 'Scheduled',  cls: 'bg-accent/10 text-accent border-accent/20' },
      approved:         { label: 'Approved',   cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
      ready:            { label: 'Ready',      cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
      pending_approval: { label: 'In Review',  cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
      failed:           { label: 'Failed',     cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
      draft:            { label: 'Draft',      cls: 'bg-card text-muted border-border' },
    };
    return map[s] ?? { label: s, cls: 'bg-card text-muted border-border' };
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
</script>

<svelte:head><title>Posts — WebXni Portal</title></svelte:head>

<div class="max-w-4xl mx-auto space-y-5">

  <!-- Header + filters -->
  <div class="flex items-center justify-between gap-4 flex-wrap">
    <div>
      <h1 class="text-xl font-semibold text-white">Content Posts</h1>
      <p class="text-sm text-muted mt-0.5">{total} post{total === 1 ? '' : 's'} total</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      {#each statuses as s}
        <button
          class="text-xs px-3 py-1.5 rounded-full border transition-all
            {statusFilter === s.value
              ? 'bg-accent/10 text-accent border-accent/30'
              : 'border-border text-muted hover:text-white hover:border-border/60'}"
          on:click={() => { statusFilter = s.value; page = 1; load(); }}
        >{s.label}</button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="flex justify-center py-16"><Spinner size="lg" /></div>
  {:else if posts.length === 0}
    <div class="card p-12 text-center">
      <p class="text-muted text-sm">No posts found{statusFilter ? ' with this filter' : ''}.</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each posts as post}
      {@const si = statusInfo(post.status ?? '')}
      <div class="card px-5 py-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-3">
              <!-- Content type icon -->
              <div class="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-sm shrink-0 mt-0.5">
                {#if post.content_type === 'reel' || post.content_type === 'video'}🎥
                {:else if post.content_type === 'blog'}📝
                {:else}🖼️{/if}
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-white leading-snug">{post.title || '(untitled)'}</p>
                <p class="text-xs text-muted mt-0.5 capitalize">{post.content_type ?? ''}</p>
              </div>
            </div>

            <!-- Platforms + date -->
            <div class="flex flex-wrap items-center gap-2 mt-3 ml-11">
              {#each parsePlatforms(post.platforms) as p}
                <span
                  class="text-xs px-2 py-0.5 rounded-full"
                  style="background:{platformColor(p)}18; color:{platformColor(p)}"
                >{platformLabel(p)}</span>
              {/each}
              <span class="text-xs text-muted">
                {post.publish_date ? fmtDate(post.publish_date) : '—'}
              </span>
            </div>

            <!-- Live URLs -->
            {#if post.post_urls?.some(u => u.real_url)}
            <div class="flex flex-wrap gap-3 mt-2 ml-11">
              {#each post.post_urls.filter(u => u.real_url) as u}
                <a
                  href={u.real_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xs text-accent hover:underline flex items-center gap-1"
                  style="color:{platformColor(u.platform)}"
                >
                  View on {platformLabel(u.platform)} ↗
                </a>
              {/each}
            </div>
            {/if}
          </div>

          <!-- Status badge -->
          <span class="text-xs shrink-0 px-2.5 py-1 rounded-full border {si.cls}">
            {si.label}
          </span>
        </div>
      </div>
      {/each}
    </div>

    <!-- Pagination -->
    {#if pages > 1}
    <div class="flex items-center justify-center gap-3 pt-2">
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
