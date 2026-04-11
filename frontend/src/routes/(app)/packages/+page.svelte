<script lang="ts">
  import { onMount } from 'svelte';
  import { packagesApi } from '$lib/api';
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
    'tiktok','pinterest','bluesky','youtube','google_business','website_blog',
  ];

  const frequencyOptions = [
    { value: 'daily',        label: 'Daily' },
    { value: '3x_week',      label: '3x / week' },
    { value: 'twice_weekly', label: '2x / week' },
    { value: 'weekly',       label: 'Weekly' },
    { value: 'biweekly',     label: 'Biweekly' },
    { value: 'monthly',      label: 'Monthly' },
  ];

  function newPackage(): Partial<Package> {
    return {
      slug: '', name: '',
      posts_per_month: 8,
      images_per_month: 4, videos_per_month: 0,
      reels_per_month: 0,  blog_posts_per_month: 0,
      platforms_included: '[]',
      posting_frequency: 'twice_weekly',
      cadence_notes: null,
      sort_order: 0,
    };
  }

  function editPackage(pkg: Package) { editing = { ...pkg }; showForm = true; }
  function cancelEdit()              { editing = null; showForm = false; }

  function getPlatforms(pkg: Partial<Package>): string[] {
    try { return JSON.parse(pkg.platforms_included ?? '[]'); } catch { return []; }
  }

  function togglePlatform(pkg: Partial<Package>, p: string) {
    const cur = getPlatforms(pkg);
    pkg.platforms_included = JSON.stringify(
      cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]
    );
    editing = editing;
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
      cancelEdit(); load();
    } catch (e) { toast.error(String(e)); }
    finally { saving = false; }
  }

  async function toggleActive(pkg: Package) {
    try {
      await packagesApi.update(pkg.id, { active: pkg.active ? 0 : 1 });
      load();
    } catch { toast.error('Failed'); }
  }

  async function deletePackage(pkg: Package) {
    if (!confirm(`Delete "${pkg.name}"?`)) return;
    try { await packagesApi.delete(pkg.id); load(); }
    catch { toast.error('Failed'); }
  }

  async function load() {
    loading = true;
    try { const r = await packagesApi.listAll(); packages = r.packages; }
    finally { loading = false; }
  }

  onMount(load);

  function freqLabel(v: string) {
    return frequencyOptions.find(o => o.value === v)?.label ?? v;
  }
</script>

<svelte:head><title>Packages — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Packages</h1>
    <p class="page-subtitle">{packages.filter(p => p.active).length} active</p>
  </div>
  {#if can('settings.view') && !showForm}
    <button class="btn-primary btn-sm" on:click={() => { editing = newPackage(); showForm = true; }}>+ New Package</button>
  {/if}
</div>

<!-- Form -->
{#if showForm && editing}
<div class="card p-5 mb-6">
  <h3 class="section-label mb-4">{editing.id ? 'Edit Package' : 'New Package'}</h3>

  <!-- Name + Slug -->
  <div class="grid grid-cols-2 gap-4 mb-4">
    <div>
      <label class="block text-xs text-muted mb-1">Name <span class="text-red-400">*</span></label>
      <input type="text" bind:value={editing.name} class="input w-full" placeholder="Premium Social" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Slug</label>
      <input type="text" bind:value={editing.slug} class="input w-full font-mono text-sm" placeholder="auto-generated" />
    </div>
  </div>

  <!-- Content counts + Frequency -->
  <div class="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
    <div>
      <label class="block text-xs text-muted mb-1">Posts / mo</label>
      <input type="number" bind:value={editing.posts_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Images</label>
      <input type="number" bind:value={editing.images_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Videos</label>
      <input type="number" bind:value={editing.videos_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Reels</label>
      <input type="number" bind:value={editing.reels_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Blogs</label>
      <input type="number" bind:value={editing.blog_posts_per_month} class="input w-full text-sm" min="0" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1">Frequency</label>
      <select bind:value={editing.posting_frequency} class="input w-full text-sm">
        {#each frequencyOptions as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Cadence notes -->
  <div class="mb-4">
    <label class="block text-xs text-muted mb-1">Schedule notes (optional)</label>
    <input type="text" bind:value={editing.cadence_notes} class="input w-full text-sm" placeholder="e.g. Mon / Wed / Fri" />
  </div>

  <!-- Platforms -->
  <div class="mb-5">
    <label class="block text-xs text-muted mb-2">Platforms Included</label>
    <div class="flex flex-wrap gap-2">
      {#each platformOptions as p}
        <button
          type="button"
          class="px-3 py-1 rounded-full text-xs border transition-colors
            {getPlatforms(editing).includes(p)
              ? 'bg-accent/15 border-accent text-accent'
              : 'border-border text-muted hover:text-white'}"
          on:click={() => editing && togglePlatform(editing, p)}
        >{p.replace(/_/g,' ')}</button>
      {/each}
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

<!-- List -->
{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if packages.length === 0}
  <EmptyState title="No packages" detail="Create your first service package." icon="◈" />
{:else}
  <div class="space-y-2">
    {#each packages as pkg}
      <div class="card p-4 {pkg.active ? '' : 'opacity-50'}">
        <div class="flex items-center gap-4">
          <!-- Identity -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1.5">
              <span class="font-medium text-white text-sm">{pkg.name}</span>
              {#if !pkg.active}<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">inactive</span>{/if}
              <span class="text-xs font-mono text-muted">{pkg.slug}</span>
            </div>
            <!-- Counts -->
            <div class="flex items-center gap-3 text-xs text-muted mb-2">
              <span class="text-white font-medium">{pkg.posts_per_month}/mo</span>
              {#if pkg.images_per_month > 0}<span>{pkg.images_per_month} img</span>{/if}
              {#if pkg.videos_per_month > 0}<span>{pkg.videos_per_month} vid</span>{/if}
              {#if pkg.reels_per_month > 0}<span>{pkg.reels_per_month} reel</span>{/if}
              {#if pkg.blog_posts_per_month > 0}<span>{pkg.blog_posts_per_month} blog</span>{/if}
              <span class="text-border">·</span>
              <span>{freqLabel(pkg.posting_frequency)}</span>
              {#if pkg.cadence_notes}<span class="text-muted">({pkg.cadence_notes})</span>{/if}
            </div>
            <!-- Platforms -->
            <div class="flex flex-wrap gap-1">
              {#each getPlatforms(pkg) as p}
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-surface border border-border text-muted">{p.replace(/_/g,' ')}</span>
              {/each}
            </div>
          </div>
          <!-- Actions -->
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
