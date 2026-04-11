<script lang="ts">
  import { onMount } from 'svelte';
  import { packagesApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import type { Package } from '$lib/types';

  let packages: Package[] = [];
  let loading = true;
  let editing: Partial<Package> | null = null;
  let saving = false;
  let showForm = false;

  const platformOptions = [
    'facebook','instagram','linkedin','x','threads',
    'tiktok','pinterest','bluesky','youtube','google_business','website_blog'
  ];

  function newPackage(): Partial<Package> {
    return {
      slug: '', name: '', posts_per_month: 8, images_per_month: 4, videos_per_month: 0,
      reels_per_month: 0, blog_posts_per_month: 0, platforms_included: '[]',
      includes_gbp: 0, includes_blog: 0, includes_bilingual: 0, includes_stories: 0,
      posting_frequency: 'twice-weekly', cadence_notes: null, price_cents: null, active: 1, sort_order: 0
    };
  }

  function editPackage(pkg: Package) {
    editing = { ...pkg };
    showForm = true;
  }

  function cancelEdit() {
    editing = null;
    showForm = false;
  }

  function getPlatforms(pkg: Partial<Package>): string[] {
    try { return JSON.parse(pkg.platforms_included ?? '[]'); } catch { return []; }
  }

  function togglePlatform(pkg: Partial<Package>, p: string) {
    const current = getPlatforms(pkg);
    if (current.includes(p)) {
      pkg.platforms_included = JSON.stringify(current.filter(x => x !== p));
    } else {
      pkg.platforms_included = JSON.stringify([...current, p]);
    }
    editing = editing; // trigger reactivity
  }

  async function save() {
    if (!editing) return;
    if (!editing.name?.trim()) { toast.error('Name is required'); return; }
    if (!editing.slug?.trim()) {
      editing.slug = editing.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }
    saving = true;
    try {
      if (editing.id) {
        await packagesApi.update(editing.id, editing);
        toast.success('Package updated');
      } else {
        await packagesApi.create(editing);
        toast.success('Package created');
      }
      cancelEdit();
      load();
    } catch (e) { toast.error(String(e)); }
    finally { saving = false; }
  }

  async function toggleActive(pkg: Package) {
    try {
      await packagesApi.update(pkg.id, { active: pkg.active ? 0 : 1 });
      toast.success(pkg.active ? 'Package deactivated' : 'Package activated');
      load();
    } catch { toast.error('Failed to update'); }
  }

  async function deletePackage(pkg: Package) {
    if (!confirm(`Delete package "${pkg.name}"? This cannot be undone.`)) return;
    try { await packagesApi.delete(pkg.id); toast.success('Package deleted'); load(); }
    catch { toast.error('Failed to delete'); }
  }

  async function load() {
    loading = true;
    try { const r = await packagesApi.listAll(); packages = r.packages; }
    finally { loading = false; }
  }

  onMount(load);
</script>

<svelte:head><title>Packages — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Packages</h1>
    <p class="page-subtitle">{packages.filter(p => p.active).length} active service packages</p>
  </div>
  {#if can('settings.view') && !showForm}
    <button class="btn-primary btn-sm" on:click={() => { editing = newPackage(); showForm = true; }}>
      + New Package
    </button>
  {/if}
</div>

{#if showForm && editing}
<div class="card p-5 mb-6">
  <h3 class="section-label mb-4">{editing.id ? 'Edit Package' : 'New Package'}</h3>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
    <div>
      <label class="block text-xs text-muted mb-1">Name <span class="text-red-400">*</span></label>
      <input type="text" bind:value={editing.name} class="input w-full text-sm" placeholder="e.g. Premium Social" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Slug</label>
      <input type="text" bind:value={editing.slug} class="input w-full text-sm font-mono" placeholder="auto-generated from name" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Monthly Price (cents)</label>
      <input type="number" bind:value={editing.price_cents} class="input w-full text-sm" placeholder="e.g. 120000" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Posts / Month</label>
      <input type="number" bind:value={editing.posts_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Images / Month</label>
      <input type="number" bind:value={editing.images_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Videos / Month</label>
      <input type="number" bind:value={editing.videos_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Reels / Month</label>
      <input type="number" bind:value={editing.reels_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Blog Posts / Month</label>
      <input type="number" bind:value={editing.blog_posts_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Posting Frequency</label>
      <input type="text" bind:value={editing.posting_frequency} class="input w-full text-sm" placeholder="e.g. twice-weekly" />
    </div>
    <div class="md:col-span-3">
      <label class="block text-xs text-muted mb-1">Cadence Notes</label>
      <input type="text" bind:value={editing.cadence_notes} class="input w-full text-sm" placeholder="e.g. Mon/Wed/Fri, 2x/week…" />
    </div>
    <div class="md:col-span-3">
      <label class="block text-xs text-muted mb-2">Platforms Included</label>
      <div class="flex flex-wrap gap-2">
        {#each platformOptions as p}
          <button
            type="button"
            class="px-3 py-1 rounded-full text-xs border transition-colors
              {getPlatforms(editing).includes(p)
                ? 'bg-accent/20 border-accent text-accent'
                : 'border-border text-muted hover:border-accent/50 hover:text-white'}"
            on:click={() => editing && togglePlatform(editing, p)}
          >{p.replace(/_/g, ' ')}</button>
        {/each}
      </div>
    </div>
    <div class="flex flex-wrap gap-4 md:col-span-3">
      <label class="flex items-center gap-2 cursor-pointer text-xs text-muted">
        <input type="checkbox" bind:checked={editing.includes_gbp} class="rounded" /> Includes GBP
      </label>
      <label class="flex items-center gap-2 cursor-pointer text-xs text-muted">
        <input type="checkbox" bind:checked={editing.includes_blog} class="rounded" /> Includes Blog
      </label>
      <label class="flex items-center gap-2 cursor-pointer text-xs text-muted">
        <input type="checkbox" bind:checked={editing.includes_bilingual} class="rounded" /> Bilingual
      </label>
      <label class="flex items-center gap-2 cursor-pointer text-xs text-muted">
        <input type="checkbox" bind:checked={editing.includes_stories} class="rounded" /> Stories
      </label>
      <label class="flex items-center gap-2 cursor-pointer text-xs text-muted">
        <input type="checkbox" bind:checked={editing.active} class="rounded" /> Active
      </label>
    </div>
  </div>
  <div class="flex gap-2 justify-end">
    <button class="btn-ghost btn-sm" on:click={cancelEdit}>Cancel</button>
    <button class="btn-primary btn-sm" on:click={save} disabled={saving}>
      {saving ? 'Saving…' : editing.id ? 'Update' : 'Create'}
    </button>
  </div>
</div>
{/if}

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if packages.length === 0}
  <EmptyState title="No packages" detail="Create your first service package to assign to clients." icon="◈" />
{:else}
  <div class="space-y-3">
    {#each packages as pkg}
      <div class="card p-5" class:opacity-50={!pkg.active}>
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 mb-2">
              <span class="font-medium text-white">{pkg.name}</span>
              <Badge status={pkg.active ? 'active' : 'inactive'} />
              <span class="text-xs font-mono text-muted">{pkg.slug}</span>
              {#if pkg.price_cents}
                <span class="text-xs text-green-400">${(pkg.price_cents / 100).toFixed(0)}/mo</span>
              {/if}
            </div>
            <div class="flex flex-wrap gap-3 text-xs text-muted mb-2">
              <span>{pkg.posts_per_month} posts</span>
              {#if pkg.images_per_month > 0}<span>{pkg.images_per_month} images</span>{/if}
              {#if pkg.videos_per_month > 0}<span>{pkg.videos_per_month} videos</span>{/if}
              {#if pkg.reels_per_month > 0}<span>{pkg.reels_per_month} reels</span>{/if}
              {#if pkg.blog_posts_per_month > 0}<span>{pkg.blog_posts_per_month} blogs</span>{/if}
              {#if pkg.posting_frequency}<span>· {pkg.posting_frequency}</span>{/if}
            </div>
            <div class="flex flex-wrap gap-1">
              {#each getPlatforms(pkg) as p}
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-surface border border-border text-muted capitalize">
                  {p.replace(/_/g, ' ')}
                </span>
              {/each}
              {#if pkg.includes_gbp}<span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">GBP</span>{/if}
              {#if pkg.includes_blog}<span class="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">Blog</span>{/if}
              {#if pkg.includes_bilingual}<span class="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">Bilingual</span>{/if}
              {#if pkg.includes_stories}<span class="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-400">Stories</span>{/if}
            </div>
            {#if pkg.cadence_notes}
              <p class="text-xs text-muted mt-1">{pkg.cadence_notes}</p>
            {/if}
          </div>
          {#if can('settings.view')}
            <div class="flex gap-1 flex-shrink-0">
              <button class="btn-ghost btn-sm text-xs" on:click={() => editPackage(pkg)}>Edit</button>
              <button class="btn-ghost btn-sm text-xs" on:click={() => toggleActive(pkg)}>
                {pkg.active ? 'Deactivate' : 'Activate'}
              </button>
              <button class="btn-ghost btn-sm text-xs text-red-400" on:click={() => deletePackage(pkg)}>Delete</button>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
