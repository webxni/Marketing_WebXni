<script lang="ts">
  import { onMount } from 'svelte';
  import { clientsApi } from '$lib/api';
  import { api } from '$lib/api/client';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { formatDateTime } from '$lib/utils';

  interface AuditLog {
    id:         string;
    user_id:    string | null;
    user_email: string | null;
    action:     string;
    resource:   string | null;
    detail:     string | null;
    ip:         string | null;
    created_at: number;
  }

  let logs: AuditLog[] = [];
  let loading = true;
  let page = 1;
  const limit = 50;
  let total = 0;
  let filterAction = '';
  let filterUser = '';
  let filterDateFrom = '';
  let filterDateTo = '';
  let filterSearch = '';

  async function load() {
    loading = true;
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterAction) params.set('action', filterAction);
      if (filterUser)   params.set('user', filterUser);
      const r = await api.get<{ logs: AuditLog[]; total: number }>(`/api/logs?${params}`);
      logs = r.logs;
      total = r.total ?? logs.length;
    } finally { loading = false; }
  }

  onMount(load);

  function applyFilters() { page = 1; load(); }
  function clearFilters() {
    filterAction = ''; filterUser = '';
    filterDateFrom = ''; filterDateTo = '';
    filterSearch = '';
    page = 1; load();
  }

  $: displayedLogs = filterSearch.trim()
    ? logs.filter(l =>
        (l.action ?? '').includes(filterSearch) ||
        (l.user_email ?? '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (l.detail ?? '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (l.resource ?? '').toLowerCase().includes(filterSearch.toLowerCase())
      )
    : logs;

  const actionColors: Record<string, string> = {
    login:        'text-green-400',
    logout:       'text-muted',
    post_approve: 'text-blue-400',
    post_reject:  'text-red-400',
    post_create:  'text-accent',
    user_create:  'text-orange-400',
    user_deactivate: 'text-red-400',
    posting_run:  'text-yellow-400',
  };

  $: totalPages = Math.ceil(total / limit);
</script>

<svelte:head><title>Audit Log — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Audit Log</h1>
    <p class="page-subtitle">Security and activity history</p>
  </div>
  <button class="btn-ghost btn-sm" on:click={load}>Refresh</button>
</div>

<!-- Filters -->
<div class="card p-4 mb-5 space-y-3">
  <div class="flex items-center gap-3 flex-wrap">
    <input
      type="search"
      bind:value={filterSearch}
      placeholder="Search action, user, detail…"
      class="input text-sm flex-1 min-w-[180px]"
    />
    <input
      type="text"
      bind:value={filterAction}
      placeholder="Filter by action (e.g. post.create)"
      class="input text-sm w-52"
    />
    <input
      type="text"
      bind:value={filterUser}
      placeholder="Filter by user email"
      class="input text-sm w-48"
    />
  </div>
  <div class="flex items-center gap-3 flex-wrap">
    <label class="text-xs text-muted">From</label>
    <input type="date" bind:value={filterDateFrom} class="input text-sm w-36" />
    <label class="text-xs text-muted">To</label>
    <input type="date" bind:value={filterDateTo}   class="input text-sm w-36" />
    <button class="btn-primary btn-sm" on:click={applyFilters}>Apply</button>
    <button class="btn-ghost btn-sm" on:click={clearFilters}>Clear</button>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if logs.length === 0}
  <EmptyState title="No logs found" detail="No activity has been recorded yet, or no logs match your filters." icon="◎" />
{:else}
  <div class="card">
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Action</th>
            <th>Resource</th>
            <th>Detail</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {#each displayedLogs as log}
            <tr>
              <td class="text-xs text-muted whitespace-nowrap">{formatDateTime(log.created_at)}</td>
              <td class="text-xs text-white">{log.user_email ?? '—'}</td>
              <td>
                <span class="text-xs font-mono {actionColors[log.action] ?? 'text-muted'}">
                  {log.action}
                </span>
              </td>
              <td class="text-xs text-muted">{log.resource ?? '—'}</td>
              <td class="text-xs text-muted max-w-xs truncate">{log.detail ?? '—'}</td>
              <td class="text-xs font-mono text-muted">{log.ip ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    {#if totalPages > 1}
    <div class="px-5 py-3 border-t border-border flex items-center justify-between">
      <span class="text-xs text-muted">Page {page} of {totalPages} · {total} entries</span>
      <div class="flex gap-2">
        <button class="btn-ghost btn-sm text-xs" disabled={page <= 1} on:click={() => { page--; load(); }}>Prev</button>
        <button class="btn-ghost btn-sm text-xs" disabled={page >= totalPages} on:click={() => { page++; load(); }}>Next</button>
      </div>
    </div>
    {/if}
  </div>
{/if}
