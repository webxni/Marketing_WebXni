<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { postsApi, clientsApi, assetsApi } from '$lib/api';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { toast } from '$lib/stores/ui';
  import { getCompatiblePlatforms, getDefaultPlatforms, getIncompatiblePlatforms, normalizeContentType } from '$lib/platforms';
  import type { Client } from '$lib/types';

  let clients: Client[] = [];
  let loading = true;
  let submitting = false;
  let uploading = false;

  // Form state
  let clientSlug = '';
  let title = '';
  let contentType: 'text' | 'image' | 'video' | 'reel' | 'blog' | 'google_business' = 'image';
  let publishDate = '';
  let selectedPlatforms: string[] = [];
  let clientConfiguredPlatforms: string[] = [];
  let allowPlatformOverride = false;
  let masterCaption = '';
  let assetFile: FileList | null = null;
  let assetPreviewUrl = '';
  let assetR2Key = '';
  let dryRun = false;

  // Content fields — shown based on contentType
  let blog_content = '';
  let seo_title = '';
  let meta_description = '';
  let target_keyword = '';
  let post_slug = '';
  let youtube_title = '';
  let youtube_description = '';
  let video_script = '';
  let ai_image_prompt = '';
  let ai_video_prompt = '';

  $: isBlog    = contentType === 'blog';
  $: isYoutube = selectedPlatforms.includes('youtube');
  $: isVideo   = contentType === 'video' || contentType === 'reel';
  $: isImage   = contentType === 'image';
  $: incompatiblePlatforms = getIncompatiblePlatforms(contentType, selectedPlatforms);

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

  // GBP multi-location captions (ETB)
  let cap_gbp_la = '';
  let cap_gbp_wa = '';
  let cap_gbp_or = '';

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
    if (!clientSlug) { toast.error('Select a client before uploading a file'); return; }
    const clientRecord = clients.find(c => c.slug === clientSlug);
    if (!clientRecord) { toast.error('Client not found'); return; }
    uploading = true;
    try {
      const r = await assetsApi.upload(assetFile[0], clientRecord.id);
      assetR2Key = r.r2_key;
      assetPreviewUrl = r.url ?? '';
      toast.success('Asset uploaded');
    } catch { toast.error('Upload failed'); }
    finally { uploading = false; }
  }

  async function submit(action: 'draft' | 'publish') {
    if (!clientSlug) { toast.error('Select a client'); return; }
    if (selectedPlatforms.length === 0) { toast.error('Select at least one platform'); return; }
    if (incompatiblePlatforms.length > 0 && !allowPlatformOverride) {
      toast.error(`Incompatible platforms selected for ${normalizeContentType(contentType)}: ${incompatiblePlatforms.join(', ')}`);
      return;
    }
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
        cap_gbp_la:           cap_gbp_la || null,
        cap_gbp_wa:           cap_gbp_wa || null,
        cap_gbp_or:           cap_gbp_or || null,
      } : {};

      const contentFields = {
        blog_content:        isBlog    ? (blog_content || null)        : null,
        seo_title:           isBlog    ? (seo_title || null)           : null,
        meta_description:    isBlog    ? (meta_description || null)    : null,
        target_keyword:      isBlog    ? (target_keyword || null)      : null,
        slug:                isBlog    ? (post_slug || null)           : null,
        youtube_title:       isYoutube ? (youtube_title || null)       : null,
        youtube_description: isYoutube ? (youtube_description || null) : null,
        video_script:        isVideo   ? (video_script || null)        : null,
        ai_image_prompt:     isImage   ? (ai_image_prompt || null)     : null,
        ai_video_prompt:     isVideo   ? (ai_video_prompt || null)     : null,
      };
      const r = await postsApi.create({
        client_slug:      clientSlug,
        title:            title || null,
        content_type:     contentType,
        platforms:        JSON.stringify(selectedPlatforms),
        publish_date:     publishDate || null,
        master_caption:   masterCaption,
        asset_r2_key:     assetR2Key || null,
        dry_run:          dryRun,
        status:           action === 'draft' ? 'draft' : 'pending_approval',
        allow_platform_override: allowPlatformOverride,
        ...captionFields,
        ...gbpFields,
        ...contentFields,
      });
      toast.success(action === 'draft' ? 'Post saved as draft' : 'Post submitted for review');
      goto(`/posts/${r.post.id}`);
    } catch (e) { toast.error(String(e)); }
    finally { submitting = false; }
  }

  onMount(async () => {
    try {
      const r = await clientsApi.list('active');
      clients = r.clients;
      // Pre-fill publish date if ?date=YYYY-MM-DD was passed from the calendar
      const url = new URL(window.location.href);
      const dateParam = url.searchParams.get('date');
      if (dateParam && !publishDate) publishDate = `${dateParam}T09:00`;
    } finally { loading = false; }
  });

  $: if (assetFile && assetFile[0]) uploadAsset();

  // Auto-populate platforms when client changes
  let prevClientSlug = '';
  $: if (clientSlug && clientSlug !== prevClientSlug) {
    prevClientSlug = clientSlug;
    clientsApi.getPlatforms(clientSlug)
      .then(r => {
        const active = r.platforms.filter(p => !(p as unknown as { paused?: number }).paused);
        clientConfiguredPlatforms = active.map(p => p.platform);
        selectedPlatforms = getDefaultPlatforms(contentType, clientConfiguredPlatforms);
      })
      .catch(() => { /* ignore — user can select manually */ });
  }

  $: if (clientConfiguredPlatforms.length > 0 && !allowPlatformOverride) {
    const compatibleSelection = getCompatiblePlatforms(contentType, selectedPlatforms);
    const nextPlatforms = compatibleSelection.length > 0
      ? compatibleSelection
      : getDefaultPlatforms(contentType, clientConfiguredPlatforms);
    if (JSON.stringify(nextPlatforms) !== JSON.stringify(selectedPlatforms)) {
      selectedPlatforms = nextPlatforms;
    }
  }
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
              <option value="google_business">Google Business post</option>
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

    <!-- Blog content -->
    {#if isBlog}
    <div class="card p-5">
      <h3 class="section-label mb-4">Blog Content</h3>
      <div class="space-y-4">
        <div>
          <label for="blog_content" class="block text-xs text-muted mb-1.5">Body (HTML) <span class="text-red-400">*</span></label>
          <textarea
            id="blog_content"
            bind:value={blog_content}
            rows="12"
            placeholder="<p>Write your blog post body here. You can use HTML tags.</p>"
            class="input w-full resize-y font-mono text-xs"
          ></textarea>
          <p class="text-xs text-muted mt-1">HTML is passed directly to WordPress REST API. Paste from your editor or write manually.</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="seo_title" class="block text-xs text-muted mb-1.5">SEO Title</label>
            <input id="seo_title" type="text" bind:value={seo_title} placeholder="SEO-optimized title…" class="input w-full" />
          </div>
          <div>
            <label for="target_keyword" class="block text-xs text-muted mb-1.5">Target Keyword</label>
            <input id="target_keyword" type="text" bind:value={target_keyword} placeholder="e.g. locksmith los angeles" class="input w-full" />
          </div>
          <div>
            <label for="post_slug" class="block text-xs text-muted mb-1.5">Post Slug (optional)</label>
            <input id="post_slug" type="text" bind:value={post_slug} placeholder="locksmith-los-angeles" class="input w-full font-mono text-xs" />
            <p class="text-xs text-muted mt-1">Leave blank — WordPress will auto-generate from title.</p>
          </div>
          <div>
            <label for="meta_description" class="block text-xs text-muted mb-1.5">Meta Description</label>
            <input id="meta_description" type="text" bind:value={meta_description} placeholder="150-character summary for search engines…" class="input w-full" />
          </div>
        </div>
      </div>
    </div>
    {/if}

    <!-- YouTube content -->
    {#if isYoutube}
    <div class="card p-5">
      <h3 class="section-label mb-4">YouTube</h3>
      <div class="space-y-4">
        <div>
          <label for="youtube_title" class="block text-xs text-muted mb-1.5">Video Title</label>
          <input id="youtube_title" type="text" bind:value={youtube_title} placeholder="How to… | Client Name" class="input w-full" />
        </div>
        <div>
          <label for="youtube_description" class="block text-xs text-muted mb-1.5">Video Description</label>
          <textarea id="youtube_description" bind:value={youtube_description} rows="5" placeholder="Full YouTube description with hashtags, links…" class="input w-full resize-none text-sm"></textarea>
        </div>
      </div>
    </div>
    {/if}

    <!-- Video / Reel content -->
    {#if isVideo}
    <div class="card p-5">
      <h3 class="section-label mb-4">Video / Reel</h3>
      <div class="space-y-4">
        <div>
          <label for="video_script" class="block text-xs text-muted mb-1.5">Script / Voiceover</label>
          <textarea id="video_script" bind:value={video_script} rows="6" placeholder="Hook line…&#10;Body content…&#10;Call to action…" class="input w-full resize-none text-sm"></textarea>
        </div>
        <div>
          <label for="ai_video_prompt" class="block text-xs text-muted mb-1.5">AI Video Prompt (optional)</label>
          <textarea id="ai_video_prompt" bind:value={ai_video_prompt} rows="3" placeholder="Describe the scene, style, and mood for AI video generation…" class="input w-full resize-none text-xs font-mono"></textarea>
        </div>
      </div>
    </div>
    {/if}

    <!-- Image prompt -->
    {#if isImage}
    <div class="card p-5">
      <h3 class="section-label mb-4">Image Prompt (optional)</h3>
      <label for="ai_image_prompt" class="block text-xs text-muted mb-1.5">AI Image Generation Prompt</label>
      <textarea id="ai_image_prompt" bind:value={ai_image_prompt} rows="3" placeholder="Describe the image: style, subject, colors, mood…" class="input w-full resize-none text-xs font-mono"></textarea>
      <p class="text-xs text-muted mt-1">Used when AI image generation is triggered for this post.</p>
    </div>
    {/if}

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

        <!-- Multi-location overrides -->
        <div class="border-t border-border pt-4 space-y-3">
          <p class="text-xs text-muted">Multi-location caption overrides (optional — leave blank to use master caption for all locations)</p>
          <div>
            <label class="block text-xs text-muted mb-1.5">GBP — Los Angeles</label>
            <textarea bind:value={cap_gbp_la} rows="2" placeholder="Leave blank for default…" class="input w-full resize-none font-mono text-xs"></textarea>
          </div>
          <div>
            <label class="block text-xs text-muted mb-1.5">GBP — Washington</label>
            <textarea bind:value={cap_gbp_wa} rows="2" placeholder="Leave blank for default…" class="input w-full resize-none font-mono text-xs"></textarea>
          </div>
          <div>
            <label class="block text-xs text-muted mb-1.5">GBP — Oregon</label>
            <textarea bind:value={cap_gbp_or} rows="2" placeholder="Leave blank for default…" class="input w-full resize-none font-mono text-xs"></textarea>
          </div>
        </div>

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
      {#if incompatiblePlatforms.length > 0}
        <div class="mb-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
          {normalizeContentType(contentType)} is not compatible with: {incompatiblePlatforms.join(', ')}.
        </div>
      {/if}
      <label class="mb-3 flex items-center gap-2 text-xs text-muted cursor-pointer">
        <input type="checkbox" bind:checked={allowPlatformOverride} class="rounded" />
        Allow manual incompatible platform override
      </label>
      <div class="space-y-1">
        {#each allPlatforms as p}
          <button
            type="button"
            class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md transition-colors text-left
              {selectedPlatforms.includes(p)
                ? 'bg-accent/10 border border-accent/30 text-white'
                : 'border border-transparent hover:bg-surface text-muted hover:text-white'}"
            on:click={() => togglePlatform(p)}
          >
            <span class="w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center
              {selectedPlatforms.includes(p) ? 'bg-accent border-accent' : 'border-border'}">
              {#if selectedPlatforms.includes(p)}
                <svg class="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="currentColor">
                  <path d="M1 4l3 3 5-6"/>
                </svg>
              {/if}
            </span>
            <PlatformBadge platform={p} size="sm" />
          </button>
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
