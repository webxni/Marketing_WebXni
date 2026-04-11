<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { clientsApi, packagesApi } from '$lib/api';
  import { toast } from '$lib/stores/ui';
  import type { Package } from '$lib/types';

  let saving = false;

  let canonical_name = '';
  let slug = '';
  let packageField = '';
  let status = 'active';
  let language = 'en';
  let manual_only = false;
  let requires_approval_from = '';
  let upload_post_profile = '';
  let wp_base_url = '';
  let wp_username = '';
  let wp_application_password = '';
  let notes = '';

  let dbPackages: Package[] = [];
  const languages = ['en','es','fr','pt'];

  onMount(async () => {
    try { const r = await packagesApi.list(); dbPackages = r.packages; } catch {}
  });

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
        canonical_name:          canonical_name.trim(),
        slug:                    slug.trim(),
        package:                 packageField || null,
        status,
        language,
        manual_only:             manual_only ? 1 : 0,
        requires_approval_from:  requires_approval_from || null,
        upload_post_profile:     upload_post_profile || null,
        wp_base_url:             wp_base_url || null,
        wp_username:             wp_username || null,
        wp_application_password: wp_application_password || null,
        notes:                   notes || null,
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
        <label for="canonical_name" class="block text-xs text-muted mb-1.5">Business Name <span class="text-red-400">*</span></label>
        <input
          id="canonical_name"
          type="text"
          bind:value={canonical_name}
          on:blur={generateSlug}
          placeholder="Elite Team Builders Inc."
          class="input w-full"
        />
      </div>
      <div>
        <label for="slug" class="block text-xs text-muted mb-1.5">Slug <span class="text-red-400">*</span></label>
        <input id="slug" type="text" bind:value={slug} placeholder="elite-team-builders" class="input w-full font-mono text-xs" />
        <p class="text-xs text-muted mt-1">Unique identifier. Auto-filled from name. Cannot be changed later.</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="package" class="block text-xs text-muted mb-1.5">Package</label>
          <select id="package" bind:value={packageField} class="input w-full">
            <option value="">—</option>
            {#each dbPackages as p}
              <option value={p.slug}>{p.name}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="language" class="block text-xs text-muted mb-1.5">Language</label>
          <select id="language" bind:value={language} class="input w-full">
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
        <label for="upload_post_profile" class="block text-xs text-muted mb-1.5">Upload-Post Profile</label>
        <input id="upload_post_profile" type="text" bind:value={upload_post_profile} placeholder="Elite_Team_Builders" class="input w-full font-mono text-xs" />
        <p class="text-xs text-muted mt-1">Exact profile slug from Upload-Post dashboard.</p>
      </div>
      <div>
        <label for="wp_base_url" class="block text-xs text-muted mb-1.5">WordPress Site URL</label>
        <input id="wp_base_url" type="url" bind:value={wp_base_url} placeholder="https://example.com" class="input w-full" />
      </div>
      <div>
        <label for="wp_username" class="block text-xs text-muted mb-1.5">WP Username</label>
        <input id="wp_username" type="text" bind:value={wp_username} placeholder="admin" class="input w-full" autocomplete="off" />
      </div>
      <div>
        <label for="wp_application_password" class="block text-xs text-muted mb-1.5">WP Application Password</label>
        <input id="wp_application_password" type="password" bind:value={wp_application_password} placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" class="input w-full font-mono text-xs" autocomplete="new-password" />
        <p class="text-xs text-muted mt-1">Generate in WP Admin → Users → Application Passwords. Full config in client edit.</p>
      </div>
      <div>
        <label for="requires_approval_from" class="block text-xs text-muted mb-1.5">Requires Approval From</label>
        <input id="requires_approval_from" type="text" bind:value={requires_approval_from} placeholder="e.g. Lee" class="input w-full" />
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
    <textarea id="notes" bind:value={notes} rows="3" placeholder="Content restrictions, contact info, special instructions…" class="input w-full resize-none text-sm"></textarea>
  </div>
</div>
