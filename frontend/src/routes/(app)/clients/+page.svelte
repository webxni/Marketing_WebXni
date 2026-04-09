<script lang="ts">
  import { onMount } from 'svelte';
  import { clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { can } from '$lib/stores/auth';
  import type { Client } from '$lib/types';

  let clients: Client[] = [];
  let loading = true;
  let search  = '';
  let filter: 'active' | 'inactive' | 'all' = 'active';

  async function load() {
    loading = true;
    try { const r = await clientsApi.list(filter); clients = r.clients; }
    finally { loading = false; }
  }

  onMount(load);
  $: filter, load();

  function setFilter(s: string) { filter = s as typeof filter; }

  $: filtered = clients.filter((c) =>
    c.canonical_name.toLowerCase().includes(search.toLowerCase()) ||
    c.slug.toLowerCase().includes(search.toLowerCase()),
  );
</script>

<svelte:head><title>Clients — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Clients</h1>
    <p class="page-subtitle">{clients.length} client{clients.length === 1 ? '' : 's'} · {filter}</p>
  </div>
  {#if can('clients.create')}
    <a href="/clients/new" class="btn-primary btn-sm">+ Add Client</a>
  {/if}
</div>

<!-- Filters -->
<div class="flex items-center gap-3 mb-5">
  <input type="search" bind:value={search} placeholder="Search clients…" class="input w-64" />
  <div class="flex rounded-md border border-border overflow-hidden">
    {#each ['active','inactive','all'] as s}
      <button
        class="px-3 py-1.5 text-xs transition-colors {filter === s ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface'}"
        on:click={() => setFilter(s)}
      >{s}</button>
    {/each}
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if filtered.length === 0}
  <EmptyState title="No clients found" detail="Try adjusting your search or filter." icon="◉" />
{:else}
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each filtered as client}
      <a href="/clients/{client.slug}" class="card p-5 hover:border-accent/30 transition-colors block">
        <div class="flex items-start justify-between mb-3">
          <div class="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent font-semibold text-sm">
            {client.canonical_name[0]}
          </div>
          <Badge status={client.status ?? 'active'} />
        </div>
        <div class="font-medium text-white text-sm mb-1">{client.canonical_name}</div>
        <div class="text-xs text-muted mb-3">{client.slug}</div>
        <div class="flex items-center gap-3 text-xs text-muted">
          <span class="capitalize">{client.package ?? '—'}</span>
          {#if client.manual_only === 1}
            <span class="badge-warning badge">manual</span>
          {/if}
          {#if client.language && client.language !== 'en'}
            <span class="uppercase">{client.language}</span>
          {/if}
        </div>
      </a>
    {/each}
  </div>
{/if}
