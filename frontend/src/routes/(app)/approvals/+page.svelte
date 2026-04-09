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

  async function load() {
    loading = true;
    try {
      const r = await postsApi.list({ status: 'draft', limit: 100 });
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
      toast.success(`"${post.title ?? 'Post'}" rejected`);
      posts = posts.filter(p => p.id !== post.id);
    } catch { toast.error('Failed to reject'); }
    finally { actionLoading = null; }
  }
</script>

<svelte:head><title>Approvals — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Approvals</h1>
    <p class="page-subtitle">{posts.length} post{posts.length === 1 ? '' : 's'} pending review</p>
  </div>
  <button class="btn-ghost btn-sm" on:click={load}>Refresh</button>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if posts.length === 0}
  <EmptyState
    title="All clear!"
    detail="No posts are waiting for approval."
    icon="✓"
  />
{:else}
  <div class="space-y-4">
    {#each posts as post}
      <div class="card p-5">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-medium text-white text-sm">{post.title ?? '(untitled)'}</span>
              <Badge status={post.status ?? 'draft'} />
              <span class="text-xs text-muted capitalize">{post.content_type ?? '—'}</span>
            </div>
            <div class="text-xs text-muted mb-3">
              {post.client_name ?? post.client_slug ?? '—'}
              {#if post.publish_date}
                · {formatDate(post.publish_date)}
              {/if}
            </div>

            <!-- Platforms -->
            <div class="flex flex-wrap gap-1 mb-3">
              {#each parsePlatforms(post.platforms) as p}
                <PlatformBadge platform={p} size="sm" />
              {/each}
            </div>

            <!-- Caption preview -->
            {#if post.master_caption}
            <p class="text-xs text-muted line-clamp-3 bg-surface rounded px-3 py-2">
              {post.master_caption}
            </p>
            {/if}
          </div>

          <!-- Actions -->
          <div class="flex flex-col gap-2 flex-shrink-0">
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
    {/each}
  </div>
{/if}
