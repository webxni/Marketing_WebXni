<script lang="ts">
  import { onMount } from 'svelte';
  import { postsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { formatDate, parsePlatforms } from '$lib/utils';
  import type { Post } from '$lib/types';

  let posts: Post[] = [];
  let loading = true;
  let actionLoading: string | null = null;
  let selected = new Set<string>();
  let bulkProcessing = false;

  $: allSelected = posts.length > 0 && selected.size === posts.length;

  function toggleSelect(id: string) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    selected = selected;
  }

  function toggleAll() {
    if (allSelected) selected = new Set();
    else selected = new Set(posts.map(p => p.id));
  }

  async function bulkApprove() {
    if (selected.size === 0) return;
    bulkProcessing = true;
    const ids = [...selected];
    let done = 0;
    for (const id of ids) {
      try { await postsApi.approve(id); done++; } catch { /* continue */ }
    }
    toast.success(`${done} of ${ids.length} posts approved`);
    selected = new Set();
    load();
    bulkProcessing = false;
  }

  async function bulkReject() {
    if (selected.size === 0) return;
    bulkProcessing = true;
    const ids = [...selected];
    let done = 0;
    for (const id of ids) {
      try { await postsApi.reject(id); done++; } catch { /* continue */ }
    }
    toast.success(`${done} of ${ids.length} posts rejected`);
    selected = new Set();
    load();
    bulkProcessing = false;
  }

  async function load() {
    loading = true;
    try {
      // Show only posts submitted for review (pending_approval)
      const r = await postsApi.list({ status: 'pending_approval', limit: 100 });
      posts = r.posts;
    } finally { loading = false; }
  }

  onMount(load);

  async function approve(post: Post) {
    actionLoading = post.id;
    try {
      await postsApi.approve(post.id);
      toast.success(`"${post.title ?? 'Post'}" approved`);
      posts = posts.filter(p => p.id !== post.id);
    } catch { toast.error('Failed to approve'); }
    finally { actionLoading = null; }
  }

  async function reject(post: Post) {
    actionLoading = post.id;
    try {
      await postsApi.reject(post.id);
      toast.success(`"${post.title ?? 'Post'}" sent back to draft`);
      posts = posts.filter(p => p.id !== post.id);
    } catch { toast.error('Failed to reject'); }
    finally { actionLoading = null; }
  }

  // Readiness indicator
  function readinessFlags(post: Post): { label: string; ok: boolean }[] {
    const flags = [];
    const platforms = parsePlatforms(post.platforms);
    flags.push({ label: 'Caption', ok: !!(post.master_caption?.trim()) });
    flags.push({ label: 'Asset', ok: post.asset_delivered === 1 || post.content_type === 'text' || post.content_type === 'blog' });
    flags.push({ label: 'Date', ok: !!post.publish_date });
    if (platforms.includes('website_blog')) {
      flags.push({ label: 'Blog body', ok: !!(post.blog_content?.trim()) });
    }
    return flags;
  }
</script>

<svelte:head><title>Approvals — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Approvals</h1>
    <p class="page-subtitle">{posts.length} post{posts.length === 1 ? '' : 's'} pending review</p>
  </div>
  <div class="flex items-center gap-2">
    {#if selected.size > 0}
      <span class="text-xs text-muted">{selected.size} selected</span>
      {#if can('posts.approve')}
        <button class="btn-primary btn-sm" disabled={bulkProcessing} on:click={bulkApprove}>
          {bulkProcessing ? 'Processing…' : `Approve ${selected.size}`}
        </button>
        <button class="btn-danger btn-sm" disabled={bulkProcessing} on:click={bulkReject}>
          Reject {selected.size}
        </button>
      {/if}
    {/if}
    <button class="btn-ghost btn-sm" on:click={load}>Refresh</button>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if posts.length === 0}
  <EmptyState
    title="All clear!"
    detail="No posts are waiting for approval. Posts submitted for review will appear here."
    icon="✓"
  />
{:else}
  <!-- Bulk select bar -->
  {#if posts.length > 1}
  <div class="flex items-center gap-3 mb-3 text-xs text-muted">
    <label class="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={allSelected} on:change={toggleAll} class="rounded" />
      Select all {posts.length}
    </label>
  </div>
  {/if}

  <div class="space-y-4">
    {#each posts as post}
      {@const flags = readinessFlags(post)}
      {@const allReady = flags.every(f => f.ok)}
      <div class="card p-5" class:ring-1={selected.has(post.id)} class:ring-accent={selected.has(post.id)}>
        <div class="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected.has(post.id)}
            on:change={() => toggleSelect(post.id)}
            class="rounded mt-1 flex-shrink-0"
          />
          <div class="flex-1 min-w-0 flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span class="font-medium text-white text-sm">{post.title ?? '(untitled)'}</span>
                <Badge status={post.status ?? 'pending_approval'} />
                <span class="text-xs text-muted capitalize">{post.content_type ?? '—'}</span>
              </div>
              <div class="text-xs text-muted mb-3">
                {post.client_name ?? post.client_slug ?? '—'}
                {#if post.publish_date}· {formatDate(post.publish_date)}{/if}
              </div>

              <!-- Platforms -->
              <div class="flex flex-wrap gap-1 mb-3">
                {#each parsePlatforms(post.platforms) as p}
                  <PlatformBadge platform={p} size="sm" />
                {/each}
              </div>

              <!-- Caption preview -->
              {#if post.master_caption}
              <p class="text-xs text-muted line-clamp-3 bg-surface rounded px-3 py-2 mb-3">
                {post.master_caption}
              </p>
              {/if}

              <!-- Readiness flags -->
              <div class="flex flex-wrap gap-2">
                {#each flags as flag}
                  <span class="text-[10px] px-2 py-0.5 rounded-full border
                    {flag.ok
                      ? 'border-green-500/30 text-green-400 bg-green-500/5'
                      : 'border-red-500/30 text-red-400 bg-red-500/5'}">
                    {flag.ok ? '✓' : '✗'} {flag.label}
                  </span>
                {/each}
                {#if !allReady}
                  <span class="text-[10px] text-yellow-400">⚠ incomplete — can still approve</span>
                {/if}
              </div>
            </div>

            <!-- Actions -->
            <div class="flex flex-col gap-2 flex-shrink-0 min-w-[80px]">
              <a href="/posts/{post.id}" class="btn-ghost btn-sm text-xs text-center">View</a>
              {#if can('posts.approve')}
                <button
                  class="btn-primary btn-sm text-xs"
                  disabled={actionLoading === post.id}
                  on:click={() => approve(post)}
                >Approve</button>
                <button
                  class="btn-danger btn-sm text-xs"
                  disabled={actionLoading === post.id}
                  on:click={() => reject(post)}
                >Reject</button>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}
