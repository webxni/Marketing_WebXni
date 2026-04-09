<script lang="ts">
  import { goto } from '$app/navigation';
  import { clientsApi } from '$lib/api';
  import { toast } from '$lib/stores/ui';

  let saving = false;

  let canonical_name = '';
  let slug = '';
  let packageField = '';
  let status = 'active';
  let language = 'en';
  let manual_only = false;
  let requires_approval_from = '';
  let upload_post_profile = '';
  let wp_domain = '';
  let notes = '';

  const packages = ['starter','growth','premium','enterprise'];
  const languages = ['en','es','fr','pt'];

  // Auto-generate slug from name
  function generateSlug() {
    if (!slug) {
      slug = canonical_name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }
  }

  async function save() {
    if (!canonical_name.trim()) { toast.error('Name is required'); return; }
    if (!slug.trim()) { toast.error('Slug is required'); return; }
    saving = true;
    try {
      const r = await clientsApi.create({
        canonical_name:         canonical_name.trim(),
        slug:                   slug.trim(),
        package:                packageField || null,
        status,
        language,
        manual_only:            manual_only ? 1 : 0,
        requires_approval_from: requires_approval_from || null,
        upload_post_profile:    upload_post_profile || null,
        wp_domain:              wp_domain || null,
        notes:                  notes || null,
      });
      toast.success(`Client "${canonical_name}" created`);
      goto(`/clients/${r.client.slug}`);
    } catch (e) { toast.error(String(e)); }
    finally { saving = false; }
  }
</script>

<svelte:head><title>New Client — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <div class="flex items-center gap-2 text-xs text-muted mb-1">
      <a href="/clients" class="hover:text-white">Clients</a>
      <span>/</span>
      <span>New</span>
    </div>
    <h1 class="page-title">Add Client</h1>
  </div>
  <div class="flex gap-2">
    <a href="/clients" class="btn-ghost btn-sm">Cancel</a>
    <button class="btn-primary btn-sm" on:click={save} disabled={saving}>
      {saving ? 'Creating…' : 'Create Client'}
    </button>
  </div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <!-- Basic info -->
  <div class="card p-5">
    <h3 class="section-label mb-4">Basic Info</h3>
    <div class="space-y-4">
      <div>
        <label class="block text-xs text-muted mb-1.5">Business Name <span class="text-red-400">*</span></label>
        <input
          type="text"
          bind:value={canonical_name}
          on:blur={generateSlug}
          placeholder="Elite Team Builders Inc."
          class="input w-full"
        />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1.5">Slug <span class="text-red-400">*</span></label>
        <input type="text" bind:value={slug} placeholder="elite-team-builders" class="input w-full font-mono text-xs" />
        <p class="text-xs text-muted mt-1">Unique identifier. Auto-filled from name. Cannot be changed later.</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-muted mb-1.5">Package</label>
          <select bind:value={packageField} class="input w-full">
            <option value="">—</option>
            {#each packages as p}
              <option value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Language</label>
          <select bind:value={language} class="input w-full">
            {#each languages as l}
              <option value={l}>{l.toUpperCase()}</option>
            {/each}
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- Automation -->
  <div class="card p-5">
    <h3 class="section-label mb-4">Automation</h3>
    <div class="space-y-4">
      <div>
        <label class="block text-xs text-muted mb-1.5">Upload-Post Profile</label>
        <input type="text" bind:value={upload_post_profile} placeholder="profile-slug" class="input w-full font-mono text-xs" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1.5">WordPress Domain</label>
        <input type="text" bind:value={wp_domain} placeholder="example.com" class="input w-full" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1.5">Requires Approval From</label>
        <input type="text" bind:value={requires_approval_from} placeholder="e.g. Lee" class="input w-full" />
      </div>
      <div class="flex items-center gap-2">
        <input type="checkbox" bind:checked={manual_only} id="manual-only" class="rounded" />
        <label for="manual-only" class="text-xs text-muted cursor-pointer">Manual only (skip automation)</label>
      </div>
    </div>
  </div>

  <!-- Notes -->
  <div class="card p-5 lg:col-span-2">
    <h3 class="section-label mb-4">Notes</h3>
    <textarea bind:value={notes} rows="3" placeholder="Content restrictions, contact info, special instructions…" class="input w-full resize-none text-sm"></textarea>
  </div>
</div>
