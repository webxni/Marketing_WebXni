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
      const r = await postsApi.list({ status: 'pending_approval', limit: 100 });
      posts = r.posts;
    } finally { loading = false; }
  }

  onMount(load);

  async function approve(post: Post) {
    actionLoading = post.id;
    try {
      await postsApi.approve(post.id);
      toast.success(`"${post.title ?? 'Post'}" approved ✓`);
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

  function readinessFlags(post: Post): { label: string; ok: boolean }[] {
    const flags = [];
    const platforms = parsePlatforms(post.platforms);
    flags.push({ label: 'Caption', ok: !!(post.master_caption?.trim()) });
    flags.push({ label: 'Asset', ok: post.asset_delivered === 1 || post.content_type === 'text' || post.content_type === 'blog' });
    flags.push({ label: 'Date', ok: !!post.publish_date });
    if (platforms.includes('website_blog')) {
      flags.push({ label: 'Blog', ok: !!(post.blog_content?.trim()) });
    }
    return flags;
  }

  function isVideo(post: Post): boolean {
    return post.content_type === 'video' || post.content_type === 'reel' || post.asset_type === 'video';
  }

  function hideImgOnError(e: Event) {
    const img = e.target;
    if (img && 'style' in img) (img as HTMLElement).style.display = 'none';
  }

  function contentTypeIcon(post: Post): string {
    if (post.content_type === 'blog') return '📝';
    if (post.content_type === 'reel') return '🎬';
    if (post.content_type === 'video') return '▶';
    return '🖼';
  }

  // ── Image lightbox ────────────────────────────────────────────────────────
  let lightboxUrl: string | null = null;
  function openLightbox(url: string) { lightboxUrl = url; }
  function closeLightbox() { lightboxUrl = null; }
</script>

<svelte:head><title>Approvals — WebXni</title></svelte:head>
<svelte:window on:keydown={(e) => lightboxUrl && e.key === 'Escape' && closeLightbox()} />

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
  <!-- Select all bar -->
  {#if posts.length > 1}
  <div class="flex items-center gap-3 mb-4 text-xs text-muted">
    <label class="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={allSelected} on:change={toggleAll} class="rounded" />
      Select all {posts.length}
    </label>
  </div>
  {/if}

  <!-- Grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
    {#each posts as post}
      {@const flags = readinessFlags(post)}
      {@const allReady = flags.every(f => f.ok)}
      {@const platformList = parsePlatforms(post.platforms)}

      <div class="card overflow-hidden flex flex-col transition-shadow hover:shadow-lg
                  {selected.has(post.id) ? 'ring-1 ring-accent' : ''}">

        <!-- ── Media preview ── -->
        <div class="relative bg-card/60 overflow-hidden" style="aspect-ratio:16/9;">
          <!-- Checkbox -->
          <label class="absolute top-2 left-2 z-10 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.has(post.id)}
              on:change={() => toggleSelect(post.id)}
              class="rounded"
            />
          </label>

          {#if post.asset_r2_key}
            {#if isVideo(post)}
              <!-- Playable video — Range requests now supported by /media proxy -->
              <video
                src="/media/{post.asset_r2_key}"
                class="w-full h-full object-contain bg-black"
                controls
                preload="metadata"
                muted
                playsinline
                on:click|stopPropagation
              />
            {:else}
              <!-- Image thumbnail — click to open full-size lightbox -->
              <button
                type="button"
                class="w-full h-full cursor-zoom-in focus:outline-none"
                title="Click to view full size"
                on:click|stopPropagation={() => openLightbox(`/media/${post.asset_r2_key}`)}
              >
                <img
                  src="/media/{post.asset_r2_key}"
                  alt={post.title ?? ''}
                  class="w-full h-full object-cover"
                  loading="lazy"
                  on:error={hideImgOnError}
                />
              </button>
            {/if}
          {:else if post.content_type === 'blog'}
            <div class="w-full h-full flex items-center justify-center flex-col gap-1">
              <span class="text-3xl opacity-30">📝</span>
              <span class="text-[10px] text-muted">Blog post</span>
            </div>
          {:else if post.canva_link}
            <div class="w-full h-full flex items-center justify-center">
              <a href={post.canva_link} target="_blank" rel="noopener"
                 class="text-xs text-accent hover:underline flex items-center gap-1">
                <span>🎨</span> Canva design
              </a>
            </div>
          {:else}
            <div class="w-full h-full flex items-center justify-center text-3xl opacity-20">
              {contentTypeIcon(post)}
            </div>
          {/if}

          <!-- Content type pill -->
          <div class="absolute top-2 right-2">
            <span class="text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded capitalize font-medium">
              {post.content_type ?? '—'}
            </span>
          </div>

          <!-- Readiness warning dot -->
          {#if !allReady}
          <div class="absolute bottom-2 right-2 w-2 h-2 rounded-full bg-yellow-400" title="Incomplete"></div>
          {/if}
        </div>

        <!-- ── Card body ── -->
        <div class="p-4 flex flex-col gap-2.5 flex-1">

          <!-- Title + status -->
          <div class="flex items-start justify-between gap-2">
            <span class="font-medium text-white text-sm leading-snug line-clamp-2 flex-1">
              {post.title ?? '(untitled)'}
            </span>
            <Badge status={post.status ?? 'pending_approval'} />
          </div>

          <!-- Client + date -->
          <p class="text-xs text-muted">
            {post.client_name ?? post.client_slug ?? '—'}
            {#if post.publish_date}
              <span class="text-border mx-1">·</span>{formatDate(post.publish_date)}
            {/if}
          </p>

          <!-- Platform chips -->
          <div class="flex flex-wrap gap-1">
            {#each platformList.slice(0, 6) as p}
              <PlatformBadge platform={p} size="sm" />
            {/each}
            {#if platformList.length > 6}
              <span class="text-[10px] text-muted self-center">+{platformList.length - 6}</span>
            {/if}
          </div>

          <!-- Caption preview -->
          {#if post.master_caption}
          <p class="text-[11px] text-muted line-clamp-2 italic">
            "{post.master_caption.slice(0, 120)}{post.master_caption.length > 120 ? '…' : ''}"
          </p>
          {/if}

          <!-- Readiness flags -->
          <div class="flex flex-wrap gap-1 mt-auto pt-1">
            {#each flags as flag}
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border
                {flag.ok
                  ? 'border-green-500/30 text-green-400 bg-green-500/5'
                  : 'border-red-500/30 text-red-400 bg-red-500/5'}">
                {flag.ok ? '✓' : '✗'} {flag.label}
              </span>
            {/each}
          </div>

          <!-- Actions -->
          <div class="flex gap-2 pt-2 border-t border-border">
            <a href="/posts/{post.id}" class="btn-ghost btn-sm text-xs flex-1 text-center">
              View
            </a>
            {#if can('posts.approve')}
              <button
                class="btn-primary btn-sm text-xs flex-1"
                disabled={actionLoading === post.id}
                on:click={() => approve(post)}
              >
                {actionLoading === post.id ? '…' : 'Approve'}
              </button>
              <button
                class="btn-danger btn-sm text-xs px-2.5"
                disabled={actionLoading === post.id}
                title="Reject"
                on:click={() => reject(post)}
              >✗</button>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}

<!-- ── Image lightbox ──────────────────────────────────────────────────────── -->
{#if lightboxUrl}
  <div
    class="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeLightbox}
  >
    <!-- Close button -->
    <button
      class="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center text-white text-base z-10"
      on:click={closeLightbox}
      aria-label="Close"
    >✕</button>

    <!-- Full image — click inside does not close -->
    <img
      src={lightboxUrl}
      alt=""
      class="max-w-full max-h-[90vh] object-contain rounded shadow-2xl"
      on:click|stopPropagation
    />
  </div>
{/if}
