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

  const DAYS = [
    { key: 'monday',    short: 'Mon' },
    { key: 'tuesday',   short: 'Tue' },
    { key: 'wednesday', short: 'Wed' },
    { key: 'thursday',  short: 'Thu' },
    { key: 'friday',    short: 'Fri' },
    { key: 'saturday',  short: 'Sat' },
    { key: 'sunday',    short: 'Sun' },
  ];

  const platformOptions = [
    'facebook','instagram','linkedin','x','threads',
    'tiktok','pinterest','bluesky','youtube','google_business','website_blog',
  ];

  const frequencyOptions = [
    { value: 'daily',     label: 'Daily',     desc: 'Every day' },
    { value: 'weekly',    label: 'Weekly',    desc: 'Every week on selected days' },
    { value: 'biweekly',  label: 'Biweekly',  desc: 'Every 2 weeks on selected days' },
  ];

  function newPackage(): Partial<Package> {
    return {
      slug: '', name: '',
      images_per_month: 4, videos_per_month: 0,
      reels_per_month: 0, blog_posts_per_month: 0,
      platforms_included: '[]',
      posting_frequency: 'weekly',
      posting_days: '["monday","wednesday","friday"]',
      sort_order: 0,
    };
  }

  function editPackage(pkg: Package) { editing = { ...pkg }; showForm = true; }
  function cancelEdit()              { editing = null; showForm = false; }

  // ─── Platform helpers ────────────────────────────────────────────
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

  // ─── Day helpers ─────────────────────────────────────────────────
  function getSelectedDays(pkg: Partial<Package>): string[] {
    if (!pkg.posting_days) return [];
    try { return JSON.parse(pkg.posting_days); } catch { return []; }
  }

  function toggleDay(pkg: Partial<Package>, day: string) {
    const cur = getSelectedDays(pkg);
    const dayOrder = DAYS.map(d => d.key);
    const next = cur.includes(day) ? cur.filter(x => x !== day) : [...cur, day];
    // Keep canonical order Mon→Sun
    next.sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
    pkg.posting_days = JSON.stringify(next);
    editing = editing;
  }

  // ─── Estimated posts/month ───────────────────────────────────────
  function estimatePostsPerMonth(pkg: Partial<Package>): number {
    const freq = pkg.posting_frequency ?? 'weekly';
    if (freq === 'daily') return 30;
    const days = getSelectedDays(pkg).length;
    if (days === 0) return 0;
    if (freq === 'weekly')   return Math.round(days * 4.33);
    if (freq === 'biweekly') return Math.round(days * 2.17);
    return 0;
  }

  function contentTotal(pkg: Partial<Package>): number {
    return (pkg.images_per_month ?? 0) + (pkg.videos_per_month ?? 0)
         + (pkg.reels_per_month ?? 0)  + (pkg.blog_posts_per_month ?? 0);
  }

  // ─── Save ────────────────────────────────────────────────────────
  async function save() {
    if (!editing) return;
    if (!editing.name?.trim()) { toast.error('Name is required'); return; }
    if (!editing.slug?.trim()) {
      editing.slug = editing.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }
    if (editing.posting_frequency !== 'daily' && getSelectedDays(editing).length === 0) {
      toast.error('Select at least one posting day'); return;
    }
    if (contentTotal(editing) === 0) {
      toast.error('Add at least one content type (images, videos, reels, or blogs)'); return;
    }
    // Persist the auto-calculated estimate into posts_per_month
    editing.posts_per_month = estimatePostsPerMonth(editing);

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
    try { await packagesApi.update(pkg.id, { active: pkg.active ? 0 : 1 }); load(); }
    catch { toast.error('Failed'); }
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

  // ─── Display helpers ─────────────────────────────────────────────
  function freqLabel(v: string) {
    return frequencyOptions.find(o => o.value === v)?.label ?? v;
  }

  function formatDays(raw: string | null): string {
    if (!raw) return '—';
    try {
      const days: string[] = JSON.parse(raw);
      if (days.length === 7) return 'Every day';
      if (days.length === 0) return '—';
      return days.map(d => DAYS.find(x => x.key === d)?.short ?? d).join(' · ');
    } catch { return raw; }
  }

  function formatCounts(pkg: Package): string {
    const parts: string[] = [];
    if (pkg.images_per_month     > 0) parts.push(`${pkg.images_per_month} img`);
    if (pkg.videos_per_month     > 0) parts.push(`${pkg.videos_per_month} vid`);
    if (pkg.reels_per_month      > 0) parts.push(`${pkg.reels_per_month} reel`);
    if (pkg.blog_posts_per_month > 0) parts.push(`${pkg.blog_posts_per_month} blog`);
    return parts.join(' · ') || '—';
  }

  /** Returns a short ordered sequence of content-type labels for preview (max 14) */
  function cyclePreview(pkg: Partial<Package>): string[] {
    const img  = pkg.images_per_month     ?? 0;
    const vid  = pkg.videos_per_month     ?? 0;
    const reel = pkg.reels_per_month      ?? 0;
    const blog = pkg.blog_posts_per_month ?? 0;
    const raw  = [
      ...Array(img).fill('img'),
      ...Array(vid).fill('vid'),
      ...Array(reel).fill('reel'),
      ...Array(blog).fill('blog'),
    ];
    return raw.slice(0, 14);
  }

  $: showDayPicker = editing?.posting_frequency !== 'daily';
  $: estimate      = editing ? estimatePostsPerMonth(editing) : 0;
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

<!-- ── Form ───────────────────────────────────────────────────── -->
{#if showForm && editing}
<div class="card p-5 mb-6">
  <h3 class="section-label mb-4">{editing.id ? 'Edit Package' : 'New Package'}</h3>

  <!-- Name + Slug -->
  <div class="grid grid-cols-2 gap-4 mb-5">
    <div>
      <label class="block text-xs text-muted mb-1" for="pkgName">Name <span class="text-red-400">*</span></label>
      <input id="pkgName" type="text" bind:value={editing.name} class="input w-full" placeholder="Premium Social" />
    </div>
    <div>
      <label class="block text-xs text-muted mb-1" for="pkgSlug">Slug</label>
      <input id="pkgSlug" type="text" bind:value={editing.slug} class="input w-full font-mono text-sm" placeholder="auto-generated" />
    </div>
  </div>

  <!-- Frequency + Day picker -->
  <div class="mb-5">
    <label class="block text-xs text-muted mb-2">Posting Frequency</label>
    <div class="flex gap-2 flex-wrap mb-3">
      {#each frequencyOptions as opt}
        <button
          type="button"
          class="px-4 py-2 rounded-lg border text-sm transition-colors
            {editing.posting_frequency === opt.value
              ? 'bg-accent/15 border-accent text-accent'
              : 'border-border text-muted hover:text-white hover:border-border/60'}"
          on:click={() => { if (editing) editing.posting_frequency = opt.value; editing = editing; }}
        >
          <span class="font-medium">{opt.label}</span>
          <span class="block text-xs opacity-70 mt-0.5">{opt.desc}</span>
        </button>
      {/each}
    </div>

    {#if showDayPicker}
    <div>
      <label class="block text-xs text-muted mb-2">Posting Days</label>
      <div class="flex gap-1.5 flex-wrap">
        {#each DAYS as day}
          <button
            type="button"
            class="w-12 py-2 rounded-lg border text-xs font-medium transition-colors
              {getSelectedDays(editing).includes(day.key)
                ? 'bg-accent/15 border-accent text-accent'
                : 'border-border text-muted hover:text-white hover:border-border/60'}"
            on:click={() => editing && toggleDay(editing, day.key)}
          >{day.short}</button>
        {/each}
      </div>
      {#if getSelectedDays(editing).length === 0}
        <p class="text-xs text-orange-400 mt-1.5">Select at least one day.</p>
      {/if}
    </div>
    {/if}
  </div>

  <!-- Content counts per cycle -->
  <div class="mb-5">
    <div class="flex items-center justify-between mb-2">
      <label class="block text-xs text-muted">Content per Cycle</label>
      <span class="text-xs text-muted">
        Total: <span class="text-white font-medium">{contentTotal(editing)}</span>
        {#if contentTotal(editing) > 0 && getSelectedDays(editing).length > 0 && editing.posting_frequency !== 'daily'}
          <span class="text-muted ml-1">
            (repeats every {getSelectedDays(editing).length} post{getSelectedDays(editing).length === 1 ? '' : 's'})
          </span>
        {/if}
      </span>
    </div>
    <div class="grid grid-cols-4 gap-3">
      <div class="bg-card rounded-lg p-3 border border-border">
        <div class="text-xs text-muted mb-1.5">🖼️ Images</div>
        <input type="number" bind:value={editing.images_per_month} class="input w-full text-sm text-center" min="0" max="99" />
      </div>
      <div class="bg-card rounded-lg p-3 border border-border">
        <div class="text-xs text-muted mb-1.5">🎥 Videos</div>
        <input type="number" bind:value={editing.videos_per_month} class="input w-full text-sm text-center" min="0" max="99" />
      </div>
      <div class="bg-card rounded-lg p-3 border border-border">
        <div class="text-xs text-muted mb-1.5">⚡ Reels</div>
        <input type="number" bind:value={editing.reels_per_month} class="input w-full text-sm text-center" min="0" max="99" />
      </div>
      <div class="bg-card rounded-lg p-3 border border-border">
        <div class="text-xs text-muted mb-1.5">📝 Blogs</div>
        <input type="number" bind:value={editing.blog_posts_per_month} class="input w-full text-sm text-center" min="0" max="99" />
      </div>
    </div>

    <!-- Estimated output -->
    <div class="mt-3 px-4 py-2.5 rounded-lg bg-surface border border-border flex items-center justify-between">
      <span class="text-xs text-muted">Estimated posts/month</span>
      <span class="text-sm font-semibold text-white">
        {estimate > 0 ? `~${estimate} posts` : '—'}
      </span>
    </div>

    <!-- Cycle preview -->
    {#if contentTotal(editing) > 0 && estimate > 0}
    <div class="mt-2 px-4 py-2.5 rounded-lg bg-surface border border-border">
      <p class="text-xs text-muted mb-1.5">Content distribution preview</p>
      <div class="flex flex-wrap gap-1">
        {#each cyclePreview(editing) as t}
          <span class="text-xs px-1.5 py-0.5 rounded
            {t === 'img'  ? 'bg-blue-500/15 text-blue-400'
           : t === 'vid'  ? 'bg-purple-500/15 text-purple-400'
           : t === 'reel' ? 'bg-pink-500/15 text-pink-400'
           : 'bg-green-500/15 text-green-400'}">
            {t}
          </span>
        {/each}
        {#if contentTotal(editing) > 14}<span class="text-xs text-muted">…</span>{/if}
      </div>
    </div>
    {/if}
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

<!-- ── List ───────────────────────────────────────────────────── -->
{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if packages.length === 0}
  <EmptyState title="No packages" detail="Create your first service package." icon="◈" />
{:else}
  <div class="space-y-2">
    {#each packages as pkg}
      <div class="card p-4 {pkg.active ? '' : 'opacity-50'}">
        <div class="flex items-center gap-4">
          <div class="flex-1 min-w-0">
            <!-- Name + status -->
            <div class="flex items-center gap-2 mb-2">
              <span class="font-medium text-white text-sm">{pkg.name}</span>
              {#if !pkg.active}
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">inactive</span>
              {/if}
              <span class="text-xs font-mono text-muted">{pkg.slug}</span>
            </div>

            <!-- Scheduling -->
            <div class="flex items-center gap-3 text-xs mb-1.5">
              <span class="text-white font-medium">{freqLabel(pkg.posting_frequency)}</span>
              {#if pkg.posting_frequency !== 'daily'}
                <span class="text-muted">{formatDays(pkg.posting_days)}</span>
              {/if}
              <span class="text-border">·</span>
              <span class="text-accent font-medium">~{pkg.posts_per_month}/mo</span>
            </div>

            <!-- Content mix -->
            <div class="flex items-center gap-2 flex-wrap text-xs text-muted">
              <span>{formatCounts(pkg)}</span>
              {#if getPlatforms(pkg).length > 0}
                <span class="text-border">·</span>
                {#each getPlatforms(pkg) as p}
                  <span class="px-1.5 py-0.5 rounded-full bg-surface border border-border text-muted text-[10px]">{p.replace(/_/g,' ')}</span>
                {/each}
              {/if}
            </div>
          </div>

          {#if can('settings.view')}
            <div class="flex gap-1 shrink-0">
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
