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
  let testingWp = false;
  let wpTestResult: { ok: boolean; user?: { name: string }; error?: string } | null = null;

  // ── Basic fields ────────────────────────────────────────────────────────────
  let canonical_name = '';
  let slug_field = '';
  let packageField = '';
  let status = '';
  let language = '';
  let manual_only = false;
  let requires_approval_from = '';
  let notes = '';
  let brand_json = '';
  let brand_json_error = '';

  // ── Upload-Post ─────────────────────────────────────────────────────────────
  let upload_post_profile = '';

  // ── WordPress ───────────────────────────────────────────────────────────────
  let wp_base_url = '';
  let wp_admin_url = '';
  let wp_rest_base = '/wp-json/wp/v2';
  let wp_username = '';
  let wp_application_password = '';
  let wp_default_post_status = 'draft';
  let wp_default_author_id = '';
  let wp_default_category_ids = '';
  let wp_template_key = '';
  let wp_featured_image_mode = 'upload';
  let wp_excerpt_mode = 'auto';

  const packages   = ['starter','growth','premium','enterprise'];
  const statuses   = ['active','inactive','paused'];
  const languages  = ['en','es','fr','pt'];
  const postStatuses = ['draft','publish'];
  const imgModes   = ['upload','url','none'];
  const excerptModes = ['auto','manual','none'];

  onMount(async () => {
    try {
      const r = await clientsApi.get($page.params.slug ?? '');
      client = r.client;
      // Basic
      canonical_name           = client.canonical_name;
      slug_field               = client.slug;
      packageField             = client.package ?? '';
      status                   = client.status ?? 'active';
      language                 = client.language ?? 'en';
      manual_only              = client.manual_only === 1;
      requires_approval_from   = client.requires_approval_from ?? '';
      notes                    = client.notes ?? '';
      brand_json               = client.brand_json ? JSON.stringify(JSON.parse(client.brand_json), null, 2) : '';
      // Upload-Post
      upload_post_profile      = client.upload_post_profile ?? '';
      // WordPress
      wp_base_url              = client.wp_base_url ?? client.wp_domain ?? '';
      wp_admin_url             = client.wp_admin_url ?? '';
      wp_rest_base             = client.wp_rest_base ?? '/wp-json/wp/v2';
      wp_username              = client.wp_username ?? '';
      wp_application_password  = client.wp_application_password ?? '';
      wp_default_post_status   = client.wp_default_post_status ?? 'draft';
      wp_default_author_id     = client.wp_default_author_id?.toString() ?? '';
      wp_default_category_ids  = client.wp_default_category_ids ?? '';
      wp_template_key          = client.wp_template_key ?? client.wp_template ?? '';
      wp_featured_image_mode   = client.wp_featured_image_mode ?? 'upload';
      wp_excerpt_mode          = client.wp_excerpt_mode ?? 'auto';
    } catch { toast.error('Failed to load client'); }
    finally { loading = false; }
  });

  function validateBrandJson() {
    if (!brand_json.trim()) { brand_json_error = ''; return true; }
    try { JSON.parse(brand_json); brand_json_error = ''; return true; }
    catch { brand_json_error = 'Invalid JSON'; return false; }
  }

  async function testWordPress() {
    testingWp = true;
    wpTestResult = null;
    try {
      wpTestResult = await clientsApi.wpTest($page.params.slug ?? '');
    } catch (e) {
      wpTestResult = { ok: false, error: String(e) };
    } finally {
      testingWp = false;
    }
  }

  async function save() {
    if (!validateBrandJson()) return;
    saving = true;
    try {
      await clientsApi.update($page.params.slug ?? '', {
        canonical_name,
        package:                  packageField || null,
        status,
        language:                 language || null,
        manual_only:              manual_only ? 1 : 0,
        requires_approval_from:   requires_approval_from || null,
        upload_post_profile:      upload_post_profile || null,
        notes:                    notes || null,
        brand_json:               brand_json.trim() ? brand_json.trim() : null,
        // WordPress
        wp_base_url:              wp_base_url || null,
        wp_admin_url:             wp_admin_url || null,
        wp_rest_base:             wp_rest_base || '/wp-json/wp/v2',
        wp_username:              wp_username || null,
        wp_application_password:  wp_application_password || null,
        wp_default_post_status:   wp_default_post_status || 'draft',
        wp_default_author_id:     wp_default_author_id ? parseInt(wp_default_author_id, 10) : null,
        wp_default_category_ids:  wp_default_category_ids || null,
        wp_template_key:          wp_template_key || null,
        wp_featured_image_mode:   wp_featured_image_mode || 'upload',
        wp_excerpt_mode:          wp_excerpt_mode || 'auto',
      });
      toast.success('Client updated');
      goto(`/clients/${$page.params.slug ?? ''}`);
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

    <!-- Basic Info -->
    <div class="card p-5">
      <h3 class="section-label mb-4">Basic Info</h3>
      <div class="space-y-4">
        <div>
          <label for="canonical_name" class="block text-xs text-muted mb-1.5">Canonical Name <span class="text-red-400">*</span></label>
          <input id="canonical_name" type="text" bind:value={canonical_name} class="input w-full" />
        </div>
        <div>
          <label for="slug" class="block text-xs text-muted mb-1.5">Slug</label>
          <input id="slug" type="text" value={slug_field} class="input w-full opacity-50 cursor-not-allowed" readonly />
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

    <!-- Upload-Post / Automation -->
    <div class="card p-5">
      <h3 class="section-label mb-4">Automation</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-xs text-muted mb-1.5">Upload-Post Profile</label>
          <input type="text" bind:value={upload_post_profile} placeholder="Elite_Team_Builders" class="input w-full font-mono text-xs" />
          <p class="text-xs text-muted mt-1">Must match exact profile slug in Upload-Post dashboard.</p>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Requires Approval From</label>
          <input type="text" bind:value={requires_approval_from} placeholder="e.g. Lee" class="input w-full" />
        </div>
        <div class="flex items-center gap-2">
          <input type="checkbox" bind:checked={manual_only} id="manual-only" class="rounded" />
          <label for="manual-only" class="text-xs text-muted cursor-pointer">Manual only (skip automation entirely)</label>
        </div>
      </div>
    </div>

    <!-- WordPress Integration -->
    <div class="card p-5 lg:col-span-2">
      <div class="flex items-center justify-between mb-4">
        <h3 class="section-label">WordPress Integration</h3>
        <button
          class="btn-secondary btn-sm text-xs"
          on:click={testWordPress}
          disabled={testingWp}
        >
          {testingWp ? 'Testing…' : 'Test Connection'}
        </button>
      </div>

      {#if wpTestResult}
        <div class="mb-4 px-3 py-2 rounded-lg text-xs {wpTestResult.ok ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}">
          {#if wpTestResult.ok}
            Connected as <strong>{wpTestResult.user?.name}</strong>
          {:else}
            Connection failed: {wpTestResult.error}
          {/if}
        </div>
      {/if}

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-muted mb-1.5">Site URL (wp_base_url)</label>
          <input type="url" bind:value={wp_base_url} placeholder="https://example.com" class="input w-full" />
          <p class="text-xs text-muted mt-1">Main WordPress site URL without trailing slash.</p>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Admin URL (optional)</label>
          <input type="url" bind:value={wp_admin_url} placeholder="https://example.com/wp-admin" class="input w-full" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">REST Base</label>
          <input type="text" bind:value={wp_rest_base} placeholder="/wp-json/wp/v2" class="input w-full font-mono text-xs" />
          <p class="text-xs text-muted mt-1">Default: /wp-json/wp/v2</p>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">WP Username</label>
          <input type="text" bind:value={wp_username} placeholder="admin" class="input w-full" autocomplete="off" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Application Password</label>
          <input
            type="password"
            bind:value={wp_application_password}
            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
            class="input w-full font-mono text-xs"
            autocomplete="new-password"
          />
          <p class="text-xs text-muted mt-1">Generate in WP Admin → Users → Application Passwords.</p>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Default Post Status</label>
          <select bind:value={wp_default_post_status} class="input w-full">
            {#each postStatuses as s}
              <option value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Default Author ID</label>
          <input type="number" bind:value={wp_default_author_id} placeholder="1" class="input w-full" />
          <p class="text-xs text-muted mt-1">Get from WP → Users. Use Test Connection first.</p>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Default Category IDs (JSON array)</label>
          <input type="text" bind:value={wp_default_category_ids} placeholder="[1, 5, 12]" class="input w-full font-mono text-xs" />
          <p class="text-xs text-muted mt-1">e.g. [1, 5] — use Pull Categories to find IDs.</p>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Template Key</label>
          <input type="text" bind:value={wp_template_key} placeholder="etb" class="input w-full font-mono text-xs" />
          <p class="text-xs text-muted mt-1">References a saved wp_templates entry.</p>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Featured Image Mode</label>
          <select bind:value={wp_featured_image_mode} class="input w-full">
            {#each imgModes as m}
              <option value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Excerpt Mode</label>
          <select bind:value={wp_excerpt_mode} class="input w-full">
            {#each excerptModes as m}
              <option value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            {/each}
          </select>
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
        placeholder='&#123;"primary_color":"#000","font":"Inter"&#125;'
        class="input w-full resize-none font-mono text-xs"
        class:border-red-500={brand_json_error}
        on:blur={validateBrandJson}
      ></textarea>
      {#if brand_json_error}
        <p class="text-xs text-red-400 mt-1">{brand_json_error}</p>
      {:else}
        <p class="text-xs text-muted mt-1">JSON object with brand metadata (colors, fonts, phone, cta_text…)</p>
      {/if}
    </div>

  </div>
{/if}
