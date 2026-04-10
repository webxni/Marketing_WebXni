<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { postsApi, clientsApi, assetsApi } from '$lib/api';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { toast } from '$lib/stores/ui';
  import type { Client } from '$lib/types';

  let clients: Client[] = [];
  let loading = true;
  let submitting = false;
  let uploading = false;

  // Form state
  let clientSlug = '';
  let title = '';
  let contentType: 'text' | 'image' | 'video' | 'reel' | 'blog' = 'image';
  let publishDate = '';
  let selectedPlatforms: string[] = [];
  let masterCaption = '';
  let assetFile: FileList | null = null;
  let assetPreviewUrl = '';
  let assetR2Key = '';
  let dryRun = false;

  // GBP advanced fields — only shown when google_business is selected
  let gbp_topic_type = 'STANDARD';
  let gbp_cta_type = '';
  let gbp_cta_url = '';
  let gbp_event_title = '';
  let gbp_event_start_date = '';
  let gbp_event_start_time = '';
  let gbp_event_end_date = '';
  let gbp_event_end_time = '';
  let gbp_coupon_code = '';
  let gbp_redeem_url = '';
  let gbp_terms = '';

  $: gbpSelected = selectedPlatforms.includes('google_business');
  $: showEventFields = gbpSelected && gbp_topic_type === 'EVENT';
  $: showOfferFields = gbpSelected && gbp_topic_type === 'OFFER';
  $: showCtaUrl = gbpSelected && gbp_cta_type && gbp_cta_type !== 'CALL';

  const allPlatforms = [
    'facebook','instagram','linkedin','x','threads',
    'tiktok','pinterest','bluesky','youtube','google_business','website_blog'
  ];

  const captions: Record<string, string> = {};
  let expandedCaption = '';

  function togglePlatform(p: string) {
    if (selectedPlatforms.includes(p)) selectedPlatforms = selectedPlatforms.filter(x => x !== p);
    else selectedPlatforms = [...selectedPlatforms, p];
  }

  function selectAll()   { selectedPlatforms = [...allPlatforms]; }
  function clearAll()    { selectedPlatforms = []; }
  function fillFromMaster() {
    for (const p of selectedPlatforms) if (!captions[p]) captions[p] = masterCaption;
  }

  async function uploadAsset() {
    if (!assetFile || !assetFile[0]) return;
    uploading = true;
    try {
      const r = await assetsApi.upload(assetFile[0]);
      assetR2Key = r.r2_key;
      assetPreviewUrl = r.url;
      toast.success('Asset uploaded');
    } catch { toast.error('Upload failed'); }
    finally { uploading = false; }
  }

  async function submit(action: 'draft' | 'publish') {
    if (!clientSlug) { toast.error('Select a client'); return; }
    if (selectedPlatforms.length === 0) { toast.error('Select at least one platform'); return; }
    if (!masterCaption.trim()) { toast.error('Master caption is required'); return; }
    submitting = true;
    try {
      const captionFields: Record<string, string> = {};
      for (const p of selectedPlatforms) {
        const key = `cap_${p}` as string;
        captionFields[key] = captions[p] || masterCaption;
      }
      const gbpFields = gbpSelected ? {
        gbp_topic_type:       gbp_topic_type || null,
        gbp_cta_type:         gbp_cta_type || null,
        gbp_cta_url:          gbp_cta_url || null,
        gbp_event_title:      gbp_event_title || null,
        gbp_event_start_date: gbp_event_start_date || null,
        gbp_event_start_time: gbp_event_start_time || null,
        gbp_event_end_date:   gbp_event_end_date || null,
        gbp_event_end_time:   gbp_event_end_time || null,
        gbp_coupon_code:      gbp_coupon_code || null,
        gbp_redeem_url:       gbp_redeem_url || null,
        gbp_terms:            gbp_terms || null,
      } : {};

      const r = await postsApi.create({
        client_slug:      clientSlug,
        title:            title || null,
        content_type:     contentType,
        platforms:        JSON.stringify(selectedPlatforms),
        publish_date:     publishDate || null,
        master_caption:   masterCaption,
        asset_r2_key:     assetR2Key || null,
        dry_run:          dryRun,
        status:           action === 'draft' ? 'draft' : 'approved',
        ...captionFields,
        ...gbpFields,
      });
      toast.success(action === 'draft' ? 'Post saved as draft' : 'Post submitted for publishing');
      goto(`/posts/${r.post.id}`);
    } catch (e) { toast.error(String(e)); }
    finally { submitting = false; }
  }

  onMount(async () => {
    try {
      const r = await clientsApi.list('active');
      clients = r.clients;
    } finally { loading = false; }
  });

  $: if (assetFile && assetFile[0]) uploadAsset();
</script>

<svelte:head><title>New Post — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <div class="flex items-center gap-2 text-xs text-muted mb-1">
      <a href="/posts" class="hover:text-white">Posts</a>
      <span>/</span>
      <span>New Post</span>
    </div>
    <h1 class="page-title">Create Post</h1>
  </div>
  <div class="flex items-center gap-2">
    <label class="flex items-center gap-2 text-xs text-muted cursor-pointer">
      <input type="checkbox" bind:checked={dryRun} class="rounded" />
      Dry run
    </label>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else}
<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
  <!-- Left: main form -->
  <div class="lg:col-span-2 space-y-5">

    <!-- Client + Meta -->
    <div class="card p-5">
      <h3 class="section-label mb-4">Post Details</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-xs text-muted mb-1.5">Client <span class="text-red-400">*</span></label>
          <select bind:value={clientSlug} class="input w-full">
            <option value="">Select client…</option>
            {#each clients as c}
              <option value={c.slug}>{c.canonical_name}</option>
            {/each}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-muted mb-1.5">Title (optional)</label>
            <input type="text" bind:value={title} placeholder="Post title…" class="input w-full" />
          </div>
          <div>
            <label class="block text-xs text-muted mb-1.5">Content Type</label>
            <select bind:value={contentType} class="input w-full">
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="reel">Reel</option>
              <option value="text">Text only</option>
              <option value="blog">Blog post</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-xs text-muted mb-1.5">Publish Date</label>
          <input type="datetime-local" bind:value={publishDate} class="input w-full" />
        </div>
      </div>
    </div>

    <!-- Asset Upload -->
    {#if contentType !== 'text' && contentType !== 'blog'}
    <div class="card p-5">
      <h3 class="section-label mb-4">Asset</h3>
      {#if assetPreviewUrl}
        <div class="mb-3">
          {#if contentType === 'video' || contentType === 'reel'}
            <video src={assetPreviewUrl} controls class="w-full rounded-lg max-h-48 bg-surface"></video>
          {:else}
            <img src={assetPreviewUrl} alt="Preview" class="w-full rounded-lg max-h-48 object-contain bg-surface" />
          {/if}
          <p class="text-xs text-muted mt-1">{assetR2Key}</p>
        </div>
      {/if}
      <label class="block">
        <span class="btn-secondary btn-sm cursor-pointer inline-flex items-center gap-2">
          {#if uploading}<Spinner size="sm" />{/if}
          {uploading ? 'Uploading…' : assetR2Key ? 'Replace file' : 'Upload file'}
        </span>
        <input
          type="file"
          accept="image/*,video/*"
          class="hidden"
          on:change={(e) => { assetFile = e.currentTarget.files; }}
        />
      </label>
    </div>
    {/if}

    <!-- Master Caption -->
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="section-label">Master Caption</h3>
        <button class="btn-ghost btn-sm text-xs" on:click={fillFromMaster}>
          Fill selected platforms
        </button>
      </div>
      <textarea
        bind:value={masterCaption}
        rows="5"
        placeholder="Write your master caption here. This will be used as fallback for all platforms."
        class="input w-full resize-none font-mono text-xs"
      ></textarea>
      <p class="text-xs text-muted mt-1">{masterCaption.length} characters</p>
    </div>

    <!-- Per-platform captions -->
    {#if selectedPlatforms.length > 0}
    <div class="card p-5">
      <h3 class="section-label mb-4">Platform Captions</h3>
      <p class="text-xs text-muted mb-4">Leave blank to use master caption. Click tab to expand.</p>
      <div class="space-y-3">
        {#each selectedPlatforms as p}
          <div class="border border-border rounded-lg overflow-hidden">
            <button
              class="w-full flex items-center justify-between px-3 py-2 bg-surface hover:bg-card text-left"
              on:click={() => expandedCaption = expandedCaption === p ? '' : p}
            >
              <div class="flex items-center gap-2">
                <PlatformBadge platform={p} size="sm" />
                {#if captions[p]}
                  <span class="text-xs text-green-400">custom</span>
                {:else}
                  <span class="text-xs text-muted">using master</span>
                {/if}
              </div>
              <span class="text-muted text-xs">{expandedCaption === p ? '▲' : '▼'}</span>
            </button>
            {#if expandedCaption === p}
            <div class="p-3 bg-bg">
              <textarea
                bind:value={captions[p]}
                rows="4"
                placeholder="Leave blank to use master caption…"
                class="input w-full resize-none font-mono text-xs"
              ></textarea>
            </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
    {/if}
    <!-- Google Business Profile advanced fields -->
    {#if gbpSelected}
    <div class="card p-5">
      <h3 class="section-label mb-4">Google Business Profile</h3>
      <div class="space-y-4">

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-muted mb-1.5">Post Type</label>
            <select bind:value={gbp_topic_type} class="input w-full">
              <option value="STANDARD">Standard</option>
              <option value="EVENT">Event</option>
              <option value="OFFER">Offer</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-muted mb-1.5">Call to Action</label>
            <select bind:value={gbp_cta_type} class="input w-full">
              <option value="">None</option>
              <option value="LEARN_MORE">Learn More</option>
              <option value="BOOK">Book</option>
              <option value="ORDER">Order Online</option>
              <option value="SHOP">Shop</option>
              <option value="SIGN_UP">Sign Up</option>
              <option value="CALL">Call Now</option>
            </select>
          </div>
        </div>

        {#if showCtaUrl}
        <div>
          <label class="block text-xs text-muted mb-1.5">CTA URL <span class="text-red-400">*</span></label>
          <input type="url" bind:value={gbp_cta_url} placeholder="https://…" class="input w-full" />
        </div>
        {/if}

        {#if showEventFields}
        <div class="border border-border rounded-lg p-4 space-y-3">
          <p class="text-xs text-accent font-medium">Event Details</p>
          <div>
            <label class="block text-xs text-muted mb-1.5">Event Title <span class="text-red-400">*</span></label>
            <input type="text" bind:value={gbp_event_title} placeholder="Grand Opening…" class="input w-full" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-muted mb-1.5">Start Date <span class="text-red-400">*</span></label>
              <input type="date" bind:value={gbp_event_start_date} class="input w-full" />
            </div>
            <div>
              <label class="block text-xs text-muted mb-1.5">Start Time</label>
              <input type="time" bind:value={gbp_event_start_time} class="input w-full" />
            </div>
            <div>
              <label class="block text-xs text-muted mb-1.5">End Date <span class="text-red-400">*</span></label>
              <input type="date" bind:value={gbp_event_end_date} class="input w-full" />
            </div>
            <div>
              <label class="block text-xs text-muted mb-1.5">End Time</label>
              <input type="time" bind:value={gbp_event_end_time} class="input w-full" />
            </div>
          </div>
        </div>
        {/if}

        {#if showOfferFields}
        <div class="border border-border rounded-lg p-4 space-y-3">
          <p class="text-xs text-accent font-medium">Offer Details</p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-muted mb-1.5">Coupon Code</label>
              <input type="text" bind:value={gbp_coupon_code} placeholder="SAVE20" class="input w-full font-mono" />
            </div>
            <div>
              <label class="block text-xs text-muted mb-1.5">Redeem URL</label>
              <input type="url" bind:value={gbp_redeem_url} placeholder="https://…" class="input w-full" />
            </div>
          </div>
          <div>
            <label class="block text-xs text-muted mb-1.5">Terms & Conditions</label>
            <textarea bind:value={gbp_terms} rows="2" placeholder="Offer valid until…" class="input w-full resize-none text-xs"></textarea>
          </div>
        </div>
        {/if}

      </div>
    </div>
    {/if}

  </div>

  <!-- Right: platform selector + actions -->
  <div class="space-y-5">
    <div class="card p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="section-label">Platforms</h3>
        <div class="flex gap-1">
          <button class="btn-ghost btn-sm text-[10px]" on:click={selectAll}>All</button>
          <button class="btn-ghost btn-sm text-[10px]" on:click={clearAll}>None</button>
        </div>
      </div>
      <div class="space-y-1.5">
        {#each allPlatforms as p}
          <label class="flex items-center gap-2.5 p-2 rounded-md cursor-pointer hover:bg-surface transition-colors
            {selectedPlatforms.includes(p) ? 'bg-accent/5 border border-accent/20' : 'border border-transparent'}">
            <input
              type="checkbox"
              checked={selectedPlatforms.includes(p)}
              on:change={() => togglePlatform(p)}
              class="rounded accent-violet-500"
            />
            <PlatformBadge platform={p} size="sm" />
          </label>
        {/each}
      </div>
      <p class="text-xs text-muted mt-2">{selectedPlatforms.length} selected</p>
    </div>

    <!-- Actions -->
    <div class="card p-5 space-y-2">
      <h3 class="section-label mb-3">Actions</h3>
      {#if dryRun}
        <div class="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2 mb-2">
          Dry run mode — post will be validated but not published
        </div>
      {/if}
      <button
        class="btn-primary w-full justify-center"
        on:click={() => submit('publish')}
        disabled={submitting}
      >
        {submitting ? 'Saving…' : dryRun ? 'Dry Run' : 'Submit for Approval'}
      </button>
      <button
        class="btn-secondary w-full justify-center"
        on:click={() => submit('draft')}
        disabled={submitting}
      >
        Save as Draft
      </button>
      <a href="/posts" class="btn-ghost w-full justify-center text-center block">Cancel</a>
    </div>
  </div>
</div>
{/if}
