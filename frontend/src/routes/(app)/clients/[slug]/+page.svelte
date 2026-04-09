<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import type { Client, ClientPlatform } from '$lib/types';

  type Svc   = { id: string; name: string; category_name: string | null; active: number };
  type Area  = { id: string; city: string; state: string | null; zip: string | null; primary_area: number };
  type Offer = { id: string; title: string; description: string | null; cta_text: string | null; valid_until: string | null; active: number };

  let client:    Client | null = null;
  let platforms: ClientPlatform[] = [];
  let loading = true;
  let activeTab: 'profile' | 'platforms' | 'services' | 'areas' | 'offers' = 'profile';

  let services: Svc[]   = [];
  let areas:    Area[]  = [];
  let offers:   Offer[] = [];

  async function load() {
    loading = true;
    try {
      const r = await clientsApi.get($page.params.slug ?? '');
      client    = r.client;
      platforms = r.client.platforms ?? [];
    } finally { loading = false; }
  }

  onMount(load);

  async function togglePause(p: ClientPlatform) {
    if (!client) return;
    try {
      if (p.paused) await clientsApi.unpausePlatform(client.slug, p.platform);
      else          await clientsApi.pausePlatform(client.slug, p.platform);
      toast.success(`${p.platform} ${p.paused ? 'unpaused' : 'paused'}`);
      load();
    } catch { toast.error('Failed to update platform'); }
  }

  async function loadServices(slug: string) {
    try { const r = await clientsApi.getServices(slug); services = r.services as Svc[]; } catch {}
  }
  async function loadAreas(slug: string) {
    try { const r = await clientsApi.getAreas(slug); areas = r.areas as Area[]; } catch {}
  }
  async function loadOffers(slug: string) {
    try { const r = await clientsApi.getOffers(slug); offers = r.offers as Offer[]; } catch {}
  }

  $: brand = client?.brand_json ? JSON.parse(client.brand_json) : null;

  function switchTab(t: string) { activeTab = t as typeof activeTab; }
  $: if (client && activeTab === 'services') loadServices(client.slug);
  $: if (client && activeTab === 'areas')    loadAreas(client.slug);
  $: if (client && activeTab === 'offers')   loadOffers(client.slug);
</script>

<svelte:head><title>{client?.canonical_name ?? 'Client'} — WebXni</title></svelte:head>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if client}
  <!-- Header -->
  <div class="page-header">
    <div>
      <div class="flex items-center gap-2 text-xs text-muted mb-1">
        <a href="/clients" class="hover:text-white">Clients</a>
        <span>/</span>
        <span>{client.canonical_name}</span>
      </div>
      <h1 class="page-title">{client.canonical_name}</h1>
      <div class="flex items-center gap-2 mt-1">
        <Badge status={client.status ?? 'active'} />
        <span class="text-xs text-muted capitalize">{client.package}</span>
        {#if client.manual_only === 1}
          <span class="badge-blocked badge">manual only</span>
        {/if}
      </div>
    </div>
    {#if can('clients.edit')}
      <a href="/clients/{client.slug}/edit" class="btn-secondary btn-sm">Edit</a>
    {/if}
  </div>

  <!-- Tabs -->
  <div class="flex border-b border-border mb-6">
    {#each ['profile','platforms','services','areas','offers'] as tab}
      <button
        class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
               {activeTab === tab ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}"
        on:click={() => switchTab(tab)}
      >{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
    {/each}
  </div>

  <!-- Profile tab -->
  {#if activeTab === 'profile'}
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <div class="card p-5">
      <h3 class="section-label mb-4">General</h3>
      <dl class="space-y-3">
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Slug</dt>
          <dd class="text-xs font-mono text-white">{client.slug}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Language</dt>
          <dd class="text-xs text-white uppercase">{client.language ?? '—'}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Upload-Post Profile</dt>
          <dd class="text-xs font-mono text-white">{client.upload_post_profile ?? '—'}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">WordPress Domain</dt>
          <dd class="text-xs text-white">{client.wp_domain ?? '—'}</dd>
        </div>
        {#if client.requires_approval_from}
          <div class="flex justify-between">
            <dt class="text-xs text-muted">Approval Required From</dt>
            <dd class="text-xs text-yellow-400">{client.requires_approval_from}</dd>
          </div>
        {/if}
        {#if client.notes}
          <div>
            <dt class="text-xs text-muted mb-1">Notes</dt>
            <dd class="text-xs text-white bg-surface rounded p-2">{client.notes}</dd>
          </div>
        {/if}
      </dl>
    </div>

    {#if brand}
    <div class="card p-5">
      <h3 class="section-label mb-4">Brand</h3>
      <dl class="space-y-3">
        {#each Object.entries(brand) as [k, v]}
          <div class="flex justify-between items-center">
            <dt class="text-xs text-muted capitalize">{k.replace(/_/g, ' ')}</dt>
            <dd class="text-xs text-white">
              {#if k.includes('color')}
                <span class="inline-flex items-center gap-1.5">
                  <span class="w-3 h-3 rounded-full border border-border" style="background:{v}"></span>
                  {v}
                </span>
              {:else}
                {v}
              {/if}
            </dd>
          </div>
        {/each}
      </dl>
    </div>
    {/if}
  </div>
  {/if}

  <!-- Platforms tab -->
  {#if activeTab === 'platforms'}
  <div class="card">
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Platform</th>
            <th>Username / Page ID</th>
            <th>Status</th>
            <th>Reason</th>
            {#if can('clients.edit')}<th></th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each platforms as p}
            <tr>
              <td><PlatformBadge platform={p.platform} /></td>
              <td class="font-mono text-xs text-muted">{p.username ?? p.page_id ?? '—'}</td>
              <td><Badge status={p.paused === 1 ? 'blocked' : 'active'} /></td>
              <td class="text-xs text-muted">{p.paused_reason ?? '—'}</td>
              {#if can('clients.edit')}
              <td>
                <button class="btn-ghost btn-sm text-xs" on:click={() => togglePause(p)}>
                  {p.paused === 1 ? 'Unpause' : 'Pause'}
                </button>
              </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
  {/if}
{/if}

<!-- Services tab (outside {#if client} so reactive load works) -->
{#if activeTab === 'services' && client}
<div class="space-y-4">
  <div class="flex justify-between items-center">
    <h2 class="section-label">Services</h2>
  </div>
  {#if services.length === 0}
    <p class="text-sm text-muted text-center py-8">No services added yet.</p>
  {:else}
    <div class="card divide-y divide-border">
      {#each services as svc}
        <div class="px-4 py-3 flex items-center justify-between">
          <div>
            <div class="text-sm text-white">{svc.name}</div>
            {#if svc.category_name}<div class="text-xs text-muted">{svc.category_name}</div>{/if}
          </div>
          <Badge status={svc.active ? 'active' : 'inactive'} />
        </div>
      {/each}
    </div>
  {/if}
</div>
{/if}

{#if activeTab === 'areas' && client}
<div class="card">
  {#if areas.length === 0}
    <p class="text-sm text-muted text-center py-8">No service areas added yet.</p>
  {:else}
    <div class="divide-y divide-border">
      {#each areas as area}
        <div class="px-4 py-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            {#if area.primary_area}<span class="badge-info badge text-[10px]">Primary</span>{/if}
            <span class="text-sm text-white">{area.city}{area.state ? `, ${area.state}` : ''}</span>
          </div>
          {#if area.zip}<span class="text-xs text-muted">{area.zip}</span>{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
{/if}

{#if activeTab === 'offers' && client}
<div class="space-y-3">
  {#if offers.length === 0}
    <p class="text-sm text-muted text-center py-8">No offers added yet.</p>
  {:else}
    {#each offers as offer}
      <div class="card p-4 flex items-start justify-between">
        <div>
          <div class="text-sm font-medium text-white">{offer.title}</div>
          {#if offer.description}<div class="text-xs text-muted mt-1">{offer.description}</div>{/if}
          {#if offer.cta_text}<div class="text-xs text-accent mt-1">{offer.cta_text}</div>{/if}
          {#if offer.valid_until}<div class="text-xs text-muted mt-1">Valid until {offer.valid_until}</div>{/if}
        </div>
        <Badge status={offer.active ? 'active' : 'inactive'} />
      </div>
    {/each}
  {/if}
</div>
{/if}
