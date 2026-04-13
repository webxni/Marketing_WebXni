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
  ];

  const CONTENT_TYPES = [
    { key: 'image', label: 'img',  color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
    { key: 'video', label: 'vid',  color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
    { key: 'reel',  label: 'reel', color: 'bg-pink-500/20 text-pink-300 border-pink-500/40' },
    { key: 'blog',  label: 'blog', color: 'bg-green-500/20 text-green-300 border-green-500/40' },
  ];

  const platformOptions = [
    'facebook','instagram','linkedin','x','threads',
    'tiktok','pinterest','bluesky','youtube','google_business','website_blog',
  ];

  function newPackage(): Partial<Package> {
    return {
      slug: '', name: '',
      images_per_month: 0, videos_per_month: 0,
      reels_per_month: 0, blog_posts_per_month: 0,
      platforms_included: '[]',
      posting_frequency: 'weekly',
      posting_days: '[]',
      weekly_schedule: '{}',
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

  // ─── Weekly schedule helpers ─────────────────────────────────────
  function getSchedule(pkg: Partial<Package>): Record<string, string[]> {
    try {
      const raw = pkg.weekly_schedule;
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, string[]>;
      return {};
    } catch { return {}; }
  }

  function toggleScheduleType(day: string, type: string) {
    if (!editing) return;
    const sched = getSchedule(editing);
    const cur = sched[day] ?? [];
    if (cur.includes(type)) {
      const next = cur.filter(t => t !== type);
      if (next.length === 0) delete sched[day];
      else sched[day] = next;
    } else {
      sched[day] = [...cur, type];
    }
    editing.weekly_schedule = JSON.stringify(sched);
    // Keep posting_days in sync
    const DAYORDER = DAYS.map(d => d.key);
    editing.posting_days = JSON.stringify(
      Object.keys(sched).sort((a, b) => DAYORDER.indexOf(a) - DAYORDER.indexOf(b))
    );
    editing = editing;
  }

  function deriveCountsFromSchedule(sched: Record<string, string[]>): { images: number; videos: number; reels: number; blogs: number; total: number } {
    const counts = { images: 0, videos: 0, reels: 0, blogs: 0, total: 0 };
    for (const types of Object.values(sched)) {
      for (const t of types) {
        if (t === 'image') counts.images++;
        else if (t === 'video') counts.videos++;
        else if (t === 'reel') counts.reels++;
        else if (t === 'blog') counts.blogs++;
        counts.total++;
      }
    }
    return counts;
  }

  function estimateMonthly(sched: Record<string, string[]>): { images: number; videos: number; reels: number; blogs: number; total: number } {
    const weekly = deriveCountsFromSchedule(sched);
    const mult = 4.33;
    return {
      images: Math.round(weekly.images * mult),
      videos: Math.round(weekly.videos * mult),
      reels:  Math.round(weekly.reels  * mult),
      blogs:  Math.round(weekly.blogs  * mult),
      total:  Math.round(weekly.total  * mult),
    };
  }

  // ─── Save ────────────────────────────────────────────────────────
  async function save() {
    if (!editing) return;
    if (!editing.name?.trim()) { toast.error('Name is required'); return; }
    if (!editing.slug?.trim()) {
      editing.slug = editing.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }
    const sched = getSchedule(editing);
    const activeDays = Object.keys(sched);
    if (activeDays.length === 0) {
      toast.error('Add at least one content type to a day'); return;
    }

    // Derive counts from schedule
    const monthly = estimateMonthly(sched);
    editing.images_per_month     = monthly.images;
    editing.videos_per_month     = monthly.videos;
    editing.reels_per_month      = monthly.reels;
    editing.blog_posts_per_month = monthly.blogs;
    editing.posts_per_month      = monthly.total;

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
  function formatCounts(pkg: Package): string {
    const parts: string[] = [];
    if (pkg.images_per_month     > 0) parts.push(`${pkg.images_per_month} img`);
    if (pkg.videos_per_month     > 0) parts.push(`${pkg.videos_per_month} vid`);
    if (pkg.reels_per_month      > 0) parts.push(`${pkg.reels_per_month} reel`);
    if (pkg.blog_posts_per_month > 0) parts.push(`${pkg.blog_posts_per_month} blog`);
    return parts.join(' · ') || '—';
  }

  function getTypeColor(type: string): string {
    const ct = CONTENT_TYPES.find(c => c.key === type);
    return ct ? ct.color : 'bg-gray-500/20 text-gray-300 border-gray-500/40';
  }

  function getTypeLabel(type: string): string {
    const ct = CONTENT_TYPES.find(c => c.key === type);
    return ct ? ct.label : type;
  }

  function getPackageSchedule(pkg: Package): Record<string, string[]> {
    try {
      const raw = pkg.weekly_schedule;
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, string[]>;
      return {};
    } catch { return {}; }
  }

  $: editSchedule = editing ? getSchedule(editing) : {};
  $: editMonthly  = estimateMonthly(editSchedule);
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
      <label class="block text-xs text-muted mb-2">Sort Order</label>
      <input type="number" bind:value={editing.sort_order} class="input w-full text-sm" min="0" />
    </div>
  </div>

  <!-- Weekday Planner -->
  <div class="mb-5">
    <div class="flex items-center justify-between mb-2">
      <label class="block text-xs text-muted">Weekly Content Planner</label>
      {#if editMonthly.total > 0}
        <span class="text-xs text-muted">~<span class="text-white font-medium">{editMonthly.total}</span> posts/mo</span>
      {/if}
    </div>

    <!-- Day columns -->
    <div class="grid grid-cols-6 gap-2 mb-3">
      {#each DAYS as day}
        <div class="rounded-lg border border-border bg-surface p-2">
          <div class="text-xs font-medium text-center mb-2 {(editSchedule[day.key] ?? []).length > 0 ? 'text-white' : 'text-muted'}">{day.short}</div>
          <div class="flex flex-col gap-1">
            {#each CONTENT_TYPES as ct}
              <button
                type="button"
                class="w-full py-1 rounded border text-[10px] font-medium transition-colors
                  {(editSchedule[day.key] ?? []).includes(ct.key)
                    ? ct.color
                    : 'border-border/40 text-muted/50 hover:border-border hover:text-muted'}"
                on:click={() => toggleScheduleType(day.key, ct.key)}
              >{ct.label}</button>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <!-- Monthly totals derived from schedule -->
    {#if editMonthly.total > 0}
    <div class="px-4 py-3 rounded-lg bg-card border border-border">
      <p class="text-xs text-muted mb-2">Estimated monthly output (× 4.33 weeks)</p>
      <div class="flex gap-4 flex-wrap text-xs">
        {#if editMonthly.images > 0}<span class="text-blue-400">{editMonthly.images} images</span>{/if}
        {#if editMonthly.videos > 0}<span class="text-purple-400">{editMonthly.videos} videos</span>{/if}
        {#if editMonthly.reels  > 0}<span class="text-pink-400">{editMonthly.reels} reels</span>{/if}
        {#if editMonthly.blogs  > 0}<span class="text-green-400">{editMonthly.blogs} blogs</span>{/if}
        <span class="text-white font-medium ml-auto">~{editMonthly.total} total</span>
      </div>
    </div>
    {:else}
    <p class="text-xs text-muted/60 text-center py-2">Click content type chips above to assign types to each day.</p>
    {/if}
  </div>

  <!-- Slug (advanced) -->
  <div class="mb-5">
    <label class="block text-xs text-muted mb-1" for="pkgSlug">Slug</label>
    <input id="pkgSlug" type="text" bind:value={editing.slug} class="input w-full font-mono text-sm" placeholder="auto-generated from name" />
  </div>

  <!-- Cadence notes -->
  <div class="mb-5">
    <label class="block text-xs text-muted mb-1" for="pkgCadence">Cadence Notes (internal)</label>
    <input id="pkgCadence" type="text" bind:value={editing.cadence_notes} class="input w-full text-sm" placeholder="Optional description…" />
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
  <div class="space-y-3">
    {#each packages as pkg}
      {@const sched = getPackageSchedule(pkg)}
      {@const hasSched = Object.keys(sched).length > 0}
      <div class="card p-4 {pkg.active ? '' : 'opacity-50'}">
        <div class="flex items-start gap-4">
          <div class="flex-1 min-w-0">
            <!-- Name + meta -->
            <div class="flex items-center gap-2 mb-2">
              <span class="font-medium text-white text-sm">{pkg.name}</span>
              {#if !pkg.active}
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">inactive</span>
              {/if}
              <span class="text-xs font-mono text-muted">{pkg.slug}</span>
              <span class="text-border">·</span>
              <span class="text-accent text-xs font-medium">~{pkg.posts_per_month}/mo</span>
            </div>

            <!-- Weekday schedule grid (when available) -->
            {#if hasSched}
            <div class="flex gap-1.5 flex-wrap mb-2">
              {#each DAYS as day}
                {#if sched[day.key]}
                  <div class="flex flex-col items-center gap-0.5">
                    <span class="text-[9px] text-muted uppercase tracking-wide">{day.short}</span>
                    <div class="flex gap-0.5">
                      {#each sched[day.key] as type}
                        <span class="px-1 py-0.5 rounded border text-[9px] font-medium {getTypeColor(type)}">{getTypeLabel(type)}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
            {:else}
            <!-- Legacy display -->
            <div class="flex items-center gap-3 text-xs mb-1.5">
              <span class="text-muted">{formatCounts(pkg)}</span>
            </div>
            {/if}

            <!-- Content mix summary -->
            <div class="text-xs text-muted">{formatCounts(pkg)}</div>
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
