<script lang="ts">
  import { onMount } from 'svelte';
  import { postsApi, clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { formatDate, parsePlatforms } from '$lib/utils';
  import type { Post, Client } from '$lib/types';

  let posts: Post[] = [];
  let clients: Client[] = [];
  let loading = true;

  // Bulk selection
  let selected = new Set<string>();
  let bulkProcessing = false;
  $: allSelected = posts.length > 0 && selected.size === posts.length;
  function toggleSelect(id: string) { if (selected.has(id)) selected.delete(id); else selected.add(id); selected = selected; }
  function toggleAll() { selected = allSelected ? new Set() : new Set(posts.map(p => p.id)); }

  async function bulkMarkReady() {
    if (selected.size === 0) return;
    bulkProcessing = true;
    const ids = [...selected];
    let done = 0;
    for (const id of ids) {
      try { await postsApi.markReady(id); done++; } catch { /* continue */ }
    }
    toast.success(`${done}/${ids.length} posts marked ready`);
    selected = new Set();
    load();
    bulkProcessing = false;
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} posts? This cannot be undone.`)) return;
    bulkProcessing = true;
    const ids = [...selected];
    let done = 0;
    for (const id of ids) {
      try { await postsApi.delete(id); done++; } catch { /* continue */ }
    }
    toast.success(`${done}/${ids.length} posts deleted`);
    selected = new Set();
    load();
    bulkProcessing = false;
  }

  let filterSearch = '';
  let filterStatus = '';
  let filterClient = '';
  let filterPlatform = '';
  let filterDateFrom = '';
  let filterDateTo = '';
  let page = 1;
  const limit = 25;
  let total = 0;

  async function load() {
    loading = true;
    try {
      const params: Record<string, string | number> = { page, limit };
      if (filterStatus)   params.status   = filterStatus;
      if (filterClient)   params.client   = filterClient;
      if (filterPlatform) params.platform = filterPlatform;
      if (filterDateFrom) params.from     = filterDateFrom;
      if (filterDateTo)   params.to       = filterDateTo;
      const r = await postsApi.list(params);
      posts = r.posts;
      total = r.total ?? posts.length;
    } finally { loading = false; }
  }

  onMount(async () => {
    const r = await clientsApi.list('all');
    clients = r.clients;
    load();
  });

  function applyFilters() { page = 1; load(); }
  function clearFilters() {
    filterSearch = '';
    filterStatus = ''; filterClient = ''; filterPlatform = '';
    filterDateFrom = ''; filterDateTo = '';
    page = 1; load();
  }

  // Client-side search filter on loaded results
  $: displayedPosts = filterSearch.trim()
    ? posts.filter(p =>
        (p.title ?? '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (p.master_caption ?? '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (p.client_name ?? '').toLowerCase().includes(filterSearch.toLowerCase())
      )
    : posts;

  const statuses = ['draft','pending_approval','approved','ready','scheduled','posted','failed','cancelled'];
  const platforms = ['facebook','instagram','linkedin','x','threads','tiktok','pinterest','bluesky','youtube','google_business','website_blog'];

  $: totalPages = Math.ceil(total / limit);
</script>

<svelte:head><title>Posts — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Posts</h1>
    <p class="page-subtitle">{total} post{total === 1 ? '' : 's'} found</p>
  </div>
  <div class="flex items-center gap-2">
    {#if selected.size > 0}
      <span class="text-xs text-muted">{selected.size} selected</span>
      {#if can('automation.trigger')}
        <button class="btn-secondary btn-sm text-xs" disabled={bulkProcessing} on:click={bulkMarkReady}>
          {bulkProcessing ? '…' : `Mark ${selected.size} Ready`}
        </button>
      {/if}
      {#if can('posts.delete')}
        <button class="btn-ghost btn-sm text-xs text-red-400" disabled={bulkProcessing} on:click={bulkDelete}>
          Delete {selected.size}
        </button>
      {/if}
    {/if}
    {#if can('posts.create')}
      <a href="/posts/new" class="btn-primary btn-sm">+ New Post</a>
    {/if}
  </div>
</div>

<!-- Filters -->
<div class="card p-4 mb-5">
  <div class="mb-3">
    <input
      type="search"
      bind:value={filterSearch}
      placeholder="Search by title, caption, or client…"
      class="input w-full text-sm"
    />
  </div>
  <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
    <select bind:value={filterStatus} class="input text-sm" on:change={applyFilters}>
      <option value="">All statuses</option>
      {#each statuses as s}
        <option value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
      {/each}
    </select>

    <select bind:value={filterClient} class="input text-sm" on:change={applyFilters}>
      <option value="">All clients</option>
      {#each clients as c}
        <option value={c.slug}>{c.canonical_name}</option>
      {/each}
    </select>

    <select bind:value={filterPlatform} class="input text-sm" on:change={applyFilters}>
      <option value="">All platforms</option>
      {#each platforms as p}
        <option value={p}>{p.replace(/_/g, ' ')}</option>
      {/each}
    </select>

    <input type="date" bind:value={filterDateFrom} class="input text-sm" title="From date" on:change={applyFilters} />
    <input type="date" bind:value={filterDateTo}   class="input text-sm" title="To date"  on:change={applyFilters} />
  </div>
  <div class="flex gap-2 mt-3">
    <button class="btn-primary btn-sm" on:click={applyFilters}>Apply</button>
    <button class="btn-ghost btn-sm" on:click={clearFilters}>Clear</button>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if displayedPosts.length === 0}
  <EmptyState title="No posts found" detail="Try adjusting your filters or search term." icon="✦">
    <svelte:fragment slot="action">
      {#if can('posts.create')}
        <a href="/posts/new" class="btn-primary btn-sm">Create Post</a>
      {/if}
    </svelte:fragment>
  </EmptyState>
{:else}
  <div class="card">
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th class="w-8">
              <input type="checkbox" checked={allSelected} on:change={toggleAll} class="rounded" />
            </th>
            <th>Title / Client</th>
            <th>Status</th>
            <th>Platforms</th>
            <th>Publish Date</th>
            <th>Type</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each displayedPosts as post}
            <tr class="{selected.has(post.id) ? 'bg-accent/5' : ''}">
              <td>
                <input type="checkbox" checked={selected.has(post.id)} on:change={() => toggleSelect(post.id)} class="rounded" />
              </td>
              <td>
                <div class="font-medium text-white text-sm">{post.title ?? '(untitled)'}</div>
                <div class="text-xs text-muted">{post.client_name ?? post.client_slug ?? '—'}</div>
              </td>
              <td><Badge status={post.status ?? 'draft'} /></td>
              <td>
                <div class="flex flex-wrap gap-1">
                  {#each parsePlatforms(post.platforms) as p}
                    <PlatformBadge platform={p} size="sm" />
                  {/each}
                </div>
              </td>
              <td class="text-xs text-muted">{post.publish_date ? formatDate(post.publish_date) : '—'}</td>
              <td class="text-xs text-muted capitalize">{post.content_type ?? '—'}</td>
              <td>
                <a href="/posts/{post.id}" class="btn-ghost btn-sm text-xs">View</a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    {#if totalPages > 1}
    <div class="px-5 py-3 border-t border-border flex items-center justify-between">
      <span class="text-xs text-muted">Page {page} of {totalPages}</span>
      <div class="flex gap-2">
        <button
          class="btn-ghost btn-sm text-xs"
          disabled={page <= 1}
          on:click={() => { page--; load(); }}
        >Prev</button>
        <button
          class="btn-ghost btn-sm text-xs"
          disabled={page >= totalPages}
          on:click={() => { page++; load(); }}
        >Next</button>
      </div>
    </div>
    {/if}
  </div>
{/if}
