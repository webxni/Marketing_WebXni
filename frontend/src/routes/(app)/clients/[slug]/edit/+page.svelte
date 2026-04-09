<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { clientsApi } from '$lib/api';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { toast } from '$lib/stores/ui';
  import type { Client } from '$lib/types';

  let client: Client | null = null;
  let loading = true;
  let saving = false;

  // Form fields
  let canonical_name = '';
  let slug_field = '';
  let packageField = '';
  let status = '';
  let language = '';
  let manual_only = false;
  let requires_approval_from = '';
  let upload_post_profile = '';
  let wp_domain = '';
  let notes = '';
  let brand_json = '';
  let brand_json_error = '';

  const packages = ['starter','growth','premium','enterprise'];
  const statuses = ['active','inactive','paused'];
  const languages = ['en','es','fr','pt'];

  onMount(async () => {
    try {
      const r = await clientsApi.get(($page.params.slug ?? ''));
      client = r.client;
      // Pre-fill form
      canonical_name           = client.canonical_name;
      slug_field               = client.slug;
      packageField             = client.package ?? '';
      status                   = client.status ?? 'active';
      language                 = client.language ?? 'en';
      manual_only              = client.manual_only === 1;
      requires_approval_from   = client.requires_approval_from ?? '';
      upload_post_profile      = client.upload_post_profile ?? '';
      wp_domain                = client.wp_domain ?? '';
      notes                    = client.notes ?? '';
      brand_json               = client.brand_json ? JSON.stringify(JSON.parse(client.brand_json), null, 2) : '';
    } catch { toast.error('Failed to load client'); }
    finally { loading = false; }
  });

  function validateBrandJson() {
    if (!brand_json.trim()) { brand_json_error = ''; return true; }
    try { JSON.parse(brand_json); brand_json_error = ''; return true; }
    catch (e) { brand_json_error = 'Invalid JSON'; return false; }
  }

  async function save() {
    if (!validateBrandJson()) return;
    saving = true;
    try {
      await clientsApi.update(($page.params.slug ?? ''), {
        canonical_name,
        package:                 packageField || null,
        status,
        language:                language || null,
        manual_only:             manual_only ? 1 : 0,
        requires_approval_from:  requires_approval_from || null,
        upload_post_profile:     upload_post_profile || null,
        wp_domain:               wp_domain || null,
        notes:                   notes || null,
        brand_json:              brand_json.trim() ? brand_json.trim() : null,
      });
      toast.success('Client updated');
      goto(`/clients/${($page.params.slug ?? '')}`);
    } catch (e) { toast.error(String(e)); }
    finally { saving = false; }
  }
</script>

<svelte:head><title>Edit {client?.canonical_name ?? 'Client'} — WebXni</title></svelte:head>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if client}
  <div class="page-header">
    <div>
      <div class="flex items-center gap-2 text-xs text-muted mb-1">
        <a href="/clients" class="hover:text-white">Clients</a>
        <span>/</span>
        <a href="/clients/{client.slug}" class="hover:text-white">{client.canonical_name}</a>
        <span>/</span>
        <span>Edit</span>
      </div>
      <h1 class="page-title">Edit Client</h1>
    </div>
    <div class="flex gap-2">
      <a href="/clients/{client.slug}" class="btn-ghost btn-sm">Cancel</a>
      <button class="btn-primary btn-sm" on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Basic info -->
    <div class="card p-5">
      <h3 class="section-label mb-4">Basic Info</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-xs text-muted mb-1.5">Canonical Name <span class="text-red-400">*</span></label>
          <input type="text" bind:value={canonical_name} class="input w-full" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Slug</label>
          <input type="text" value={slug_field} class="input w-full opacity-50 cursor-not-allowed" readonly />
          <p class="text-xs text-muted mt-1">Slug cannot be changed after creation.</p>
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
            <label class="block text-xs text-muted mb-1.5">Status</label>
            <select bind:value={status} class="input w-full">
              {#each statuses as s}
                <option value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              {/each}
            </select>
          </div>
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

    <!-- Automation config -->
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
    <div class="card p-5">
      <h3 class="section-label mb-4">Notes</h3>
      <textarea bind:value={notes} rows="4" placeholder="Internal notes about this client…" class="input w-full resize-none text-sm"></textarea>
    </div>

    <!-- Brand JSON -->
    <div class="card p-5">
      <h3 class="section-label mb-4">Brand JSON</h3>
      <textarea
        bind:value={brand_json}
        rows="8"
        placeholder="&#123;&quot;primary_color&quot;:&quot;#000&quot;,&quot;font&quot;:&quot;Inter&quot;&#125;"
        class="input w-full resize-none font-mono text-xs"
        class:border-red-500={brand_json_error}
        on:blur={validateBrandJson}
      ></textarea>
      {#if brand_json_error}
        <p class="text-xs text-red-400 mt-1">{brand_json_error}</p>
      {:else}
        <p class="text-xs text-muted mt-1">JSON object with brand metadata (colors, fonts, etc.)</p>
      {/if}
    </div>
  </div>
{/if}
