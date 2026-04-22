<script lang="ts">
  import { onMount } from 'svelte';
  import { postsApi, clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { can, hasRole } from '$lib/stores/auth';
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

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} post${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    bulkProcessing = true;
    const ids = [...selected];
    let done = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await postsApi.delete(id);
        done++;
      } catch (e) {
        failed.push(String(e));
      }
    }
    selected = new Set();
    if (done > 0) toast.success(`${done} post${done === 1 ? '' : 's'} deleted`);
    if (failed.length > 0) toast.error(`${failed.length} delete${failed.length === 1 ? '' : 's'} failed: ${failed[0]}`);
    await load();
    bulkProcessing = false;
  }

  let filterSearch = '';
  let filterStatus = '';
  let filterClient = '';
  let filterPlatform = '';
  let filterDateFrom = '';
  let filterDateTo = '';
  let filterSort = 'desc';
  let includePosted = false;
  let page = 1;
  const limit = 50;
  let total = 0;
  let searchDebounce: ReturnType<typeof setTimeout>;

  async function load() {
    loading = true;
    try {
      const params: Record<string, string | number | boolean> = { page, limit, sort: filterSort };
      if (filterStatus)   params.status   = filterStatus;
      if (filterClient)   params.client   = filterClient;
      if (filterPlatform) params.platform = filterPlatform;
      if (filterDateFrom) params.from     = filterDateFrom;
      if (filterDateTo)   params.to       = filterDateTo;
      if (includePosted)  params.include_posted = true;
      if (filterSearch.trim()) params.search = filterSearch.trim();
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
    filterSort = 'desc';
    includePosted = false;
    page = 1; load();
  }

  function onSearchInput() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { page = 1; load(); }, 350);
  }

  const operationalStatuses = ['draft','pending_approval','approved','ready','scheduled','failed','cancelled'];
  $: statuses = includePosted ? [...operationalStatuses, 'posted'] : operationalStatuses;
  const platforms = ['facebook','instagram','linkedin','x','threads','tiktok','pinterest','bluesky','youtube','google_business','website_blog'];

  $: totalPages = Math.ceil(total / limit);

  function postedAgo(ts: number | null): string {
    if (!ts) return '';
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
</script>

<svelte:head><title>Posts — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Posts</h1>
    <p class="page-subtitle">{total} post{total === 1 ? '' : 's'}{includePosted ? ' including published history' : ''}</p>
  </div>
  <div class="flex items-center gap-2 shrink-0">
    {#if can('posts.create')}
      <a href="/posts/new" class="btn-primary btn-sm">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Post
      </a>
    {/if}
  </div>
</div>

<!-- Bulk action bar -->
{#if selected.size > 0}
<div class="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-accent/10 border border-accent/20">
  <span class="text-xs font-medium text-accent">{selected.size} selected</span>
  {#if can('posts.delete')}
    <button class="btn-ghost btn-sm text-xs text-red-400 hover:text-red-300" disabled={bulkProcessing} on:click={bulkDelete}>
      {bulkProcessing ? 'Deleting…' : 'Delete selected'}
    </button>
  {/if}
  <button class="btn-ghost btn-sm text-xs ml-auto" on:click={() => (selected = new Set())}>Deselect all</button>
</div>
{/if}

<!-- Filters -->
<div class="card p-4 mb-5">
  <!-- Search -->
  <div class="relative mb-3">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input
      type="search"
      bind:value={filterSearch}
      on:input={onSearchInput}
      placeholder="Search by title or caption…"
      class="input w-full pl-9"
    />
  </div>

  <!-- Filter row -->
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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
    <input type="date" bind:value={filterDateTo}   class="input text-sm" title="To date"   on:change={applyFilters} />

    <select bind:value={filterSort} class="input text-sm" on:change={applyFilters}>
      <option value="desc">Newest first</option>
      <option value="asc">Oldest first</option>
    </select>
  </div>

  <!-- Footer row -->
  <div class="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-border">
    <div class="flex items-center gap-4">
      {#if hasRole('admin')}
        <label class="inline-flex items-center gap-2 text-xs text-muted cursor-pointer">
          <input type="checkbox" bind:checked={includePosted} on:change={applyFilters} class="rounded" />
          Include posted history
        </label>
      {/if}
    </div>
    <div class="flex gap-2">
      <button class="btn-ghost btn-sm" on:click={clearFilters}>Clear filters</button>
      <button class="btn-primary btn-sm" on:click={applyFilters}>Apply</button>
    </div>
  </div>
</div>

{#if loading}
  <div class="flex flex-col items-center justify-center py-20 gap-3">
    <Spinner size="lg" />
    <p class="text-sm text-muted">Loading posts…</p>
  </div>
{:else if posts.length === 0}
  <EmptyState title="No posts found" detail="Try adjusting your filters or search term, or create a new post." icon="✦">
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
            <th class="w-16"></th>
          </tr>
        </thead>
        <tbody>
          {#each posts as post}
            <tr class="cursor-pointer {selected.has(post.id) ? 'bg-accent/5' : ''}">
              <td on:click|stopPropagation>
                <input type="checkbox" checked={selected.has(post.id)} on:change={() => toggleSelect(post.id)} class="rounded" />
              </td>
              <td>
                <a href="/posts/{post.id}" class="block hover:text-accent transition-colors">
                  <div class="font-medium text-white text-sm leading-snug">{post.title ?? '(untitled)'}</div>
                  <div class="text-xs text-muted mt-0.5">{post.client_name ?? post.client_slug ?? '—'}</div>
                </a>
              </td>
              <td>
                <div class="flex flex-col gap-0.5">
                  <Badge status={post.status ?? 'draft'} />
                  {#if post.posted_at}
                    <span class="text-[11px] text-muted">{postedAgo(post.posted_at)}</span>
                  {/if}
                </div>
              </td>
              <td>
                <div class="flex flex-wrap gap-1 max-w-[160px]">
                  {#each parsePlatforms(post.platforms) as p}
                    <PlatformBadge platform={p} size="sm" />
                  {/each}
                </div>
              </td>
              <td class="text-xs text-muted whitespace-nowrap">{post.publish_date ? formatDate(post.publish_date) : '—'}</td>
              <td>
                {#if post.content_type}
                  <span class="text-xs px-2 py-0.5 rounded bg-surface text-muted capitalize">{post.content_type}</span>
                {:else}
                  <span class="text-xs text-muted">—</span>
                {/if}
              </td>
              <td>
                <a href="/posts/{post.id}" class="btn-ghost btn-sm text-xs font-medium">
                  View
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    {#if totalPages > 1}
    <div class="px-5 py-3 border-t border-border flex items-center justify-between">
      <span class="text-xs text-muted">{total} total · Page {page} of {totalPages}</span>
      <div class="flex gap-1">
        <button
          class="btn-secondary btn-sm text-xs"
          disabled={page <= 1}
          on:click={() => { page--; load(); }}
        >← Prev</button>
        <button
          class="btn-secondary btn-sm text-xs"
          disabled={page >= totalPages}
          on:click={() => { page++; load(); }}
        >Next →</button>
      </div>
    </div>
    {/if}
  </div>
{/if}
