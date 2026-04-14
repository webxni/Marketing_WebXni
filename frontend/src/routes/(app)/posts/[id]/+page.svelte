<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { postsApi, assetsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { formatDate, formatDateTime, parsePlatforms } from '$lib/utils';
  import { getCompatiblePlatforms, getIncompatiblePlatforms, normalizeContentType } from '$lib/platforms';
  import type { Post, PostPlatform } from '$lib/types';

  let post: Post | null = null;
  let platforms: PostPlatform[] = [];
  let loading = true;
  let activeTab: 'overview' | 'captions' | 'platforms' | 'blog' | 'diseno' = 'overview';
  let showApproveConfirm = false;
  let showRejectConfirm = false;
  let showDeleteConfirm = false;

  function setTab(key: string) { activeTab = key as typeof activeTab; }

  async function load() {
    loading = true;
    try {
      const postId = $page.params.id;
      if (!postId) return;
      const r = await postsApi.get(postId);
      post = r.post;
      platforms = r.platforms ?? [];
    } finally { loading = false; }
  }

  onMount(load);

  async function submitForReview() {
    if (!post) return;
    try { await postsApi.update(post.id, { status: 'pending_approval' }); toast.success('Post submitted for review'); load(); }
    catch { toast.error('Failed to submit'); }
  }

  async function approve() {
    if (!post) return;
    try { await postsApi.approve(post.id); toast.success('Approved — post is ready for automation'); load(); }
    catch { toast.error('Failed to approve'); }
  }

  async function reject() {
    if (!post) return;
    try { await postsApi.reject(post.id); toast.success('Post sent back to draft'); load(); }
    catch { toast.error('Failed to reject'); }
  }

  async function retryFailed() {
    if (!post) return;
    try { await postsApi.retry(post.id); toast.success('Retrying failed platforms'); load(); }
    catch { toast.error('Failed to retry'); }
  }

  async function toggleAssetDelivered() {
    if (!post) return;
    try {
      await postsApi.update(post.id, { asset_delivered: post.asset_delivered ? 0 : 1 });
      post = { ...post, asset_delivered: post.asset_delivered ? 0 : 1 };
      toast.success(post.asset_delivered ? 'Asset marked as delivered' : 'Asset marked as not delivered');
    } catch { toast.error('Failed to update'); }
  }

  let skarlethNotesEdit = false;
  let skarlethNotesDraft = '';
  function startEditNotes() { skarlethNotesDraft = post?.skarleth_notes ?? ''; skarlethNotesEdit = true; }
  async function saveNotes() {
    if (!post) return;
    try {
      await postsApi.update(post.id, { skarleth_notes: skarlethNotesDraft || null });
      post = { ...post, skarleth_notes: skarlethNotesDraft || null };
      skarlethNotesEdit = false;
      toast.success('Notes saved');
    } catch { toast.error('Failed to save'); }
  }

  let uploadingAsset = false;
  let assetFile: FileList | null = null;
  let translating = false;
  let translations: Record<string, string> | null = null;

  const allPlatforms = ['facebook','instagram','linkedin','x','threads','tiktok','pinterest','bluesky','google_business','youtube','website_blog'];
  const platformLabels: Record<string, string> = {
    facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X / Twitter',
    threads: 'Threads', tiktok: 'TikTok', pinterest: 'Pinterest', bluesky: 'Bluesky',
    google_business: 'Google Business', youtube: 'YouTube', website_blog: 'Website Blog',
  };
  let addPlatform = '';
  let generatingCaption = false;
  let allowAddPlatformOverride = false;

  // GBP settings edit state
  let editingGbp = false;
  let gbpTopicType    = '';
  let gbpCtaType      = '';
  let gbpCtaUrl       = '';
  let gbpEventTitle   = '';
  let gbpStartDate    = '';
  let gbpStartTime    = '';
  let gbpEndDate      = '';
  let gbpEndTime      = '';
  let gbpCouponCode   = '';
  let gbpRedeemUrl    = '';
  let gbpTerms        = '';
  let savingGbp       = false;

  const GBP_CTA_TYPES_EDIT = ['BOOK','ORDER','SHOP','LEARN_MORE','SIGN_UP','CALL'];

  function startEditGbp() {
    if (!post) return;
    gbpTopicType  = post.gbp_topic_type  ?? 'STANDARD';
    gbpCtaType    = post.gbp_cta_type    ?? '';
    gbpCtaUrl     = post.gbp_cta_url     ?? '';
    gbpEventTitle = post.gbp_event_title ?? '';
    gbpStartDate  = post.gbp_event_start_date ?? '';
    gbpStartTime  = post.gbp_event_start_time ?? '';
    gbpEndDate    = post.gbp_event_end_date   ?? '';
    gbpEndTime    = post.gbp_event_end_time   ?? '';
    gbpCouponCode = post.gbp_coupon_code ?? '';
    gbpRedeemUrl  = post.gbp_redeem_url  ?? '';
    gbpTerms      = post.gbp_terms       ?? '';
    editingGbp = true;
  }

  async function saveGbp() {
    if (!post) return;
    savingGbp = true;
    try {
      await postsApi.update(post.id, {
        gbp_topic_type:       gbpTopicType  || null,
        gbp_cta_type:         gbpCtaType    || null,
        gbp_cta_url:          gbpCtaUrl     || null,
        gbp_event_title:      gbpEventTitle || null,
        gbp_event_start_date: gbpStartDate  || null,
        gbp_event_start_time: gbpStartTime  || null,
        gbp_event_end_date:   gbpEndDate    || null,
        gbp_event_end_time:   gbpEndTime    || null,
        gbp_coupon_code:      gbpCouponCode || null,
        gbp_redeem_url:       gbpRedeemUrl  || null,
        gbp_terms:            gbpTerms      || null,
      });
      toast.success('GBP settings saved');
      editingGbp = false;
      load();
    } catch (e) { toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { savingGbp = false; }
  }

  $: gbpHasData = post && (post.gbp_topic_type || post.gbp_cta_type || post.gbp_event_title || post.gbp_coupon_code);
  $: gbpIsSelected = post && (JSON.parse(post.platforms ?? '[]') as string[]).includes('google_business');

  function getMissingPlatforms(p: typeof post): string[] {
    if (!p) return allPlatforms;
    const existing = JSON.parse(p.platforms ?? '[]') as string[];
    const missing = allPlatforms.filter(pl => !existing.includes(pl));
    return allowAddPlatformOverride ? missing : getCompatiblePlatforms(p.content_type, missing);
  }

  async function generateCaption() {
    if (!post || !addPlatform) return;
    const incompatible = getIncompatiblePlatforms(post.content_type, [addPlatform]);
    if (incompatible.length > 0 && !allowAddPlatformOverride) {
      toast.error(`${addPlatform} is incompatible with ${normalizeContentType(post.content_type)}`);
      return;
    }
    generatingCaption = true;
    try {
      await postsApi.generateCaption(post.id, addPlatform, allowAddPlatformOverride);
      toast.success(`${platformLabels[addPlatform] ?? addPlatform} caption generated`);
      addPlatform = '';
      load();
    } catch { toast.error('Generation failed'); }
    finally { generatingCaption = false; }
  }

  async function translateContext() {
    if (!post) return;
    translating = true;
    try {
      const r = await postsApi.translateContext(post.id);
      translations = r.translations;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Translation failed: ${msg}`);
    } finally { translating = false; }
  }

  async function uploadAsset() {
    if (!post || !assetFile || !assetFile[0]) return;
    uploadingAsset = true;
    try {
      const r = await assetsApi.upload(assetFile[0], post.client_id ?? undefined, post.id);
      await postsApi.update(post.id, { asset_r2_key: r.r2_key, asset_r2_bucket: r.bucket, asset_delivered: 1 });
      assetFile = null;
      toast.success('Asset uploaded and marked as delivered');
      load();
    } catch { toast.error('Upload failed'); }
    finally { uploadingAsset = false; }
  }

  async function deletePost() {
    if (!post) return;
    try {
      await postsApi.delete(post.id);
      toast.success('Post deleted');
      goto('/posts');
    } catch (e) { toast.error(String(e)); }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function postField(p: typeof post, key: string): string | null {
    return p ? (p as any)[key] ?? null : null;
  }

  const captionFields: { key: string; label: string }[] = [
    { key: 'cap_facebook',        label: 'Facebook' },
    { key: 'cap_instagram',       label: 'Instagram' },
    { key: 'cap_linkedin',        label: 'LinkedIn' },
    { key: 'cap_x',               label: 'X / Twitter' },
    { key: 'cap_threads',         label: 'Threads' },
    { key: 'cap_tiktok',          label: 'TikTok' },
    { key: 'cap_pinterest',       label: 'Pinterest' },
    { key: 'cap_bluesky',         label: 'Bluesky' },
    { key: 'cap_google_business', label: 'Google Business' },
  ];

  // Multi-location GBP caption overrides — currently only ETB.
  // To enable for future clients: check if client has >1 entry in client_gbp_locations.
  const gbpLocationFields: { key: string; label: string }[] = [
    { key: 'cap_gbp_la', label: 'GBP — Los Angeles' },
    { key: 'cap_gbp_wa', label: 'GBP — Washington' },
    { key: 'cap_gbp_or', label: 'GBP — Oregon' },
  ];
  $: showGbpLocations = post?.client_slug === 'elite-team-builders';

  // WordPress blog publishing
  let publishingBlog = false;
  let blogWarnings: string[] = [];

  // Helpers for extra WP fields not yet in the Post type (avoid casts in template)
  function wpPostId(p: typeof post): number | null   { return p ? (p as Post & { wp_post_id?: number }).wp_post_id ?? null : null; }
  function wpPostUrl(p: typeof post): string | null  { return p ? (p as Post & { wp_post_url?: string }).wp_post_url ?? null : null; }
  function wpPostStatus(p: typeof post): string | null { return p ? (p as Post & { wp_post_status?: string }).wp_post_status ?? null : null; }
  function wpMediaId(p: typeof post): number | null  { return p ? (p as Post & { wp_featured_media_id?: number }).wp_featured_media_id ?? null : null; }
  function blogExcerpt(p: typeof post): string | null { return p ? (p as Post & { blog_excerpt?: string }).blog_excerpt ?? null : null; }

  async function publishBlog(status: 'draft' | 'publish') {
    if (!post) return;
    publishingBlog = true;
    blogWarnings = [];
    try {
      const r = await postsApi.publishBlog(post.id, { status });
      if (r.warnings?.length) blogWarnings = r.warnings;
      toast.success(status === 'publish' ? 'Published to WordPress' : 'Saved as draft in WordPress');
      load();
    } catch (e) { toast.error(`WordPress error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { publishingBlog = false; }
  }

  async function updateBlog() {
    if (!post) return;
    publishingBlog = true;
    blogWarnings = [];
    try {
      const currentStatus = (post as Post & { wp_post_status?: string }).wp_post_status ?? 'draft';
      const r = await postsApi.publishBlog(post.id, {
        status: (currentStatus === 'publish' ? 'publish' : 'draft') as 'draft' | 'publish',
        force_update: true,
      });
      if (r.warnings?.length) blogWarnings = r.warnings;
      toast.success('WordPress post updated');
      load();
    } catch (e) { toast.error(`WordPress error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { publishingBlog = false; }
  }

  async function unpublishBlog() {
    if (!post) return;
    publishingBlog = true;
    try {
      await postsApi.unpublishBlog(post.id);
      toast.success('Reverted to draft in WordPress');
      load();
    } catch (e) { toast.error(`WordPress error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { publishingBlog = false; }
  }
</script>

<svelte:head><title>{post?.title ?? 'Post'} — WebXni</title></svelte:head>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if post}
  <!-- Header -->
  <div class="page-header">
    <div>
      <div class="flex items-center gap-2 text-xs text-muted mb-1">
        <a href="/posts" class="hover:text-white">Posts</a>
        <span>/</span>
        <span class="truncate max-w-xs">{post.title ?? post.id}</span>
      </div>
      <h1 class="page-title">{post.title ?? '(untitled)'}</h1>
      <div class="flex items-center gap-2 mt-1">
        <Badge status={post.status ?? 'draft'} />
        <span class="text-xs text-muted capitalize">{post.content_type ?? '—'}</span>
        <span class="text-xs text-muted">{post.client_name ?? post.client_slug ?? '—'}</span>
      </div>
    </div>
    <div class="flex gap-2">
      <a href="/posts/{post.id}/edit" class="btn-ghost btn-sm">Edit Content</a>
      {#if can('posts.delete')}
        <button class="btn-ghost btn-sm text-red-400" on:click={() => (showDeleteConfirm = true)}>Delete</button>
      {/if}
      {#if post.status === 'draft'}
        <button class="btn-primary btn-sm" on:click={submitForReview}>Submit for Review</button>
      {/if}
      {#if post.status === 'pending_approval' && can('posts.approve')}
        <button class="btn-primary btn-sm" on:click={() => (showApproveConfirm = true)}>Approve</button>
        <button class="btn-danger btn-sm" on:click={() => (showRejectConfirm = true)}>Reject</button>
      {/if}
      {#if post.status === 'failed' && can('automation.trigger')}
        <button class="btn-secondary btn-sm" on:click={retryFailed}>Retry Failed</button>
      {/if}
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex border-b border-border mb-6">
    {#each [
      { key: 'overview',  label: 'Overview'   },
      { key: 'captions',  label: 'Captions'   },
      { key: 'platforms', label: 'Platforms'  },
      { key: 'blog',      label: 'Blog'       },
      { key: 'diseno',    label: '🎨 Diseño'  },
    ] as tab}
      <button
        class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
               {activeTab === tab.key ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}"
        on:click={() => setTab(tab.key)}
      >{tab.label}</button>
    {/each}
  </div>

  <!-- Overview tab -->
  {#if activeTab === 'overview'}
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">

    <!-- Row 1: Media Asset + Master Caption side by side -->
    <div class="card p-4 flex flex-col">
      <h3 class="section-label mb-3">Media Asset</h3>
      {#if post.asset_r2_key}
        {#if post.content_type === 'video' || post.content_type === 'reel' || post.asset_type === 'video'}
          <video
            src="/api/assets/preview?key={encodeURIComponent(post.asset_r2_key)}"
            controls
            class="w-full rounded-lg bg-black"
            style="max-height: 360px;"
          >
            <track kind="captions" />
          </video>
        {:else}
          <img
            src="/api/assets/preview?key={encodeURIComponent(post.asset_r2_key)}"
            alt="Post asset"
            class="w-full rounded-lg object-contain bg-surface"
            style="max-height: 360px;"
          />
        {/if}
        <p class="text-xs text-muted mt-2 font-mono truncate">{post.asset_r2_key}</p>
      {:else}
        <div class="flex-1 flex items-center justify-center rounded-lg bg-surface border border-border" style="min-height: 180px;">
          <p class="text-xs text-muted">No asset uploaded</p>
        </div>
      {/if}
    </div>

    <div class="card p-5 flex flex-col">
      <h3 class="section-label mb-3">Master Caption</h3>
      {#if post.master_caption}
        <p class="text-sm text-white whitespace-pre-wrap flex-1">{post.master_caption}</p>
      {:else}
        <p class="text-xs text-muted italic">No master caption yet.</p>
      {/if}
    </div>

    <!-- Row 2: Details -->
    <div class="card p-5">
      <h3 class="section-label mb-4">Details</h3>
      <dl class="space-y-3">
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Post ID</dt>
          <dd class="text-xs font-mono text-white truncate ml-4">{post.id}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Client</dt>
          <dd class="text-xs text-white">
            <a href="/clients/{post.client_slug}" class="hover:text-accent">{post.client_name ?? post.client_slug ?? '—'}</a>
          </dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Publish Date</dt>
          <dd class="text-xs text-white">{post.publish_date ? formatDate(post.publish_date) : '—'}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Created</dt>
          <dd class="text-xs text-white">{formatDateTime(post.created_at)}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Updated</dt>
          <dd class="text-xs text-white">{formatDateTime(post.updated_at)}</dd>
        </div>
        {#if post.canva_link}
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Canva</dt>
          <dd class="text-xs"><a href={post.canva_link} target="_blank" class="text-accent hover:underline">Open design</a></dd>
        </div>
        {/if}
        {#if post.wp_post_url}
        <div class="flex justify-between">
          <dt class="text-xs text-muted">WordPress</dt>
          <dd class="text-xs"><a href={post.wp_post_url} target="_blank" class="text-accent hover:underline">View post</a></dd>
        </div>
        {/if}
      </dl>
    </div>

    <div class="card p-5">
      <h3 class="section-label mb-4">Platforms</h3>
      <div class="flex flex-wrap gap-2 mb-4">
        {#each parsePlatforms(post.platforms) as p}
          <PlatformBadge platform={p} />
        {/each}
      </div>

      <!-- GBP CTA inline when google_business is a platform -->
      {#if gbpIsSelected}
      <div class="border-t border-border pt-3">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-xs font-medium text-muted uppercase tracking-wide">GBP Settings</h4>
          {#if !editingGbp && can('posts.edit')}
            <button class="btn-ghost btn-sm text-xs" on:click={startEditGbp}>Edit</button>
          {/if}
        </div>

        {#if editingGbp}
        <div class="space-y-2">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs text-muted mb-1">Type</label>
              <select bind:value={gbpTopicType} class="input w-full text-xs">
                <option value="STANDARD">Standard</option>
                <option value="EVENT">Event</option>
                <option value="OFFER">Offer</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-muted mb-1">CTA</label>
              <select bind:value={gbpCtaType} class="input w-full text-xs">
                <option value="">None</option>
                {#each GBP_CTA_TYPES_EDIT as t}<option value={t}>{t}</option>{/each}
              </select>
            </div>
            {#if gbpCtaType && gbpCtaType !== 'CALL'}
            <div class="col-span-2">
              <label class="block text-xs text-muted mb-1">CTA URL</label>
              <input type="url" bind:value={gbpCtaUrl} placeholder="https://…" class="input w-full text-xs font-mono" />
            </div>
            {/if}
          </div>
          {#if gbpTopicType === 'EVENT'}
          <div class="border border-border rounded p-2 space-y-1.5">
            <p class="text-xs text-accent">Event</p>
            <input type="text" bind:value={gbpEventTitle} placeholder="Event title" class="input w-full text-xs" />
            <div class="grid grid-cols-2 gap-1.5">
              <input type="date" bind:value={gbpStartDate} class="input w-full text-xs" />
              <input type="time" bind:value={gbpStartTime} class="input w-full text-xs" />
              <input type="date" bind:value={gbpEndDate} class="input w-full text-xs" />
              <input type="time" bind:value={gbpEndTime} class="input w-full text-xs" />
            </div>
          </div>
          {/if}
          {#if gbpTopicType === 'OFFER'}
          <div class="border border-border rounded p-2 space-y-1.5">
            <p class="text-xs text-accent">Offer</p>
            <div class="grid grid-cols-2 gap-1.5">
              <input type="text" bind:value={gbpCouponCode} placeholder="Coupon code" class="input w-full text-xs font-mono" />
              <input type="url" bind:value={gbpRedeemUrl} placeholder="Redeem URL" class="input w-full text-xs font-mono" />
            </div>
            <input type="text" bind:value={gbpTerms} placeholder="Terms" class="input w-full text-xs" />
          </div>
          {/if}
          <div class="flex justify-end gap-2">
            <button class="btn-secondary btn-sm text-xs" on:click={() => (editingGbp = false)}>Cancel</button>
            <button class="btn-primary btn-sm text-xs" on:click={saveGbp} disabled={savingGbp}>
              {savingGbp ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {:else}
        <dl class="space-y-1 text-xs">
          <div class="flex gap-2"><dt class="text-muted w-20 flex-shrink-0">Type</dt><dd class="text-white">{post.gbp_topic_type ?? 'STANDARD'}</dd></div>
          {#if post.gbp_cta_type}
          <div class="flex gap-2"><dt class="text-muted w-20 flex-shrink-0">CTA</dt>
            <dd class="text-white flex items-center gap-1.5">
              <span class="px-1.5 py-0.5 bg-accent/20 text-accent rounded text-xs font-medium">{post.gbp_cta_type}</span>
              {#if post.gbp_cta_url}<a href={post.gbp_cta_url} target="_blank" class="text-accent hover:underline truncate max-w-xs">{post.gbp_cta_url}</a>{/if}
            </dd>
          </div>
          {/if}
          {#if post.gbp_event_title}<div class="flex gap-2"><dt class="text-muted w-20 flex-shrink-0">Event</dt><dd class="text-white">{post.gbp_event_title}</dd></div>{/if}
          {#if post.gbp_event_start_date}<div class="flex gap-2"><dt class="text-muted w-20 flex-shrink-0">Dates</dt><dd class="text-white">{post.gbp_event_start_date}{post.gbp_event_start_time ? ' ' + post.gbp_event_start_time : ''} → {post.gbp_event_end_date ?? '—'}</dd></div>{/if}
          {#if post.gbp_coupon_code}<div class="flex gap-2"><dt class="text-muted w-20 flex-shrink-0">Coupon</dt><dd class="text-white font-mono">{post.gbp_coupon_code}</dd></div>{/if}
          {#if post.gbp_redeem_url}<div class="flex gap-2"><dt class="text-muted w-20 flex-shrink-0">Redeem</dt><dd><a href={post.gbp_redeem_url} target="_blank" class="text-accent hover:underline text-xs truncate">{post.gbp_redeem_url}</a></dd></div>{/if}
          {#if post.gbp_terms}<div class="flex gap-2"><dt class="text-muted w-20 flex-shrink-0">Terms</dt><dd class="text-muted">{post.gbp_terms}</dd></div>{/if}
          {#if !gbpHasData}<p class="text-muted italic">No GBP settings — click Edit to configure.</p>{/if}
        </dl>
        {/if}
      </div>
      {/if}

      {#if post.error_log}
      <div class="mt-4 border-t border-border pt-3">
        <h4 class="text-xs text-muted mb-2">Error Log</h4>
        <pre class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2 overflow-auto max-h-32">{post.error_log}</pre>
      </div>
      {/if}
    </div>

  </div>
  {/if}

  <!-- Captions tab -->
  {#if activeTab === 'captions'}
  <div class="space-y-4">
    {#each captionFields as field}
      {#if postField(post, field.key)}
      <div class="card p-4">
        <h4 class="text-xs font-medium text-muted mb-2">{field.label}</h4>
        <p class="text-sm text-white whitespace-pre-wrap">{postField(post, field.key)}</p>
      </div>
      {/if}
    {/each}

    <!-- GBP multi-location overrides (Elite Team Builders only for now) -->
    {#if showGbpLocations}
    <div class="card p-4 border border-border/60">
      <h4 class="text-xs font-medium text-white mb-1">GBP Multi-Location Overrides</h4>
      <p class="text-xs text-muted mb-3">Leave blank to use the Google Business caption above.</p>
      <div class="space-y-3">
        {#each gbpLocationFields as field}
        <div>
          <p class="text-xs text-muted mb-1">{field.label}</p>
          {#if postField(post, field.key)}
            <p class="text-sm text-white whitespace-pre-wrap">{postField(post, field.key)}</p>
          {:else}
            <p class="text-xs text-muted italic">— using Google Business caption</p>
          {/if}
        </div>
        {/each}
      </div>
    </div>
    {/if}

    {#if post.youtube_title}
    <div class="card p-4">
      <h4 class="text-xs font-medium text-muted mb-2">YouTube Title</h4>
      <p class="text-sm text-white">{post.youtube_title}</p>
      {#if post.youtube_description}
      <p class="text-xs text-muted mt-2 whitespace-pre-wrap">{post.youtube_description}</p>
      {/if}
    </div>
    {/if}

    <!-- GBP Settings card — only shown when google_business is a platform -->
    {#if gbpIsSelected}
    <div class="card p-4 border border-border">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-xs font-medium text-white">Google Business Profile Settings</h4>
        {#if !editingGbp && can('posts.edit')}
          <button class="btn-ghost btn-sm text-xs" on:click={startEditGbp}>Edit GBP</button>
        {/if}
      </div>

      {#if editingGbp}
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs text-muted mb-1">Post Type</label>
            <select bind:value={gbpTopicType} class="input w-full text-sm">
              <option value="STANDARD">Standard</option>
              <option value="EVENT">Event</option>
              <option value="OFFER">Offer</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-muted mb-1">CTA Type</label>
            <select bind:value={gbpCtaType} class="input w-full text-sm">
              <option value="">None</option>
              {#each GBP_CTA_TYPES_EDIT as t}<option value={t}>{t}</option>{/each}
            </select>
          </div>
          {#if gbpCtaType && gbpCtaType !== 'CALL'}
          <div class="col-span-2">
            <label class="block text-xs text-muted mb-1">CTA URL <span class="text-red-400">*</span></label>
            <input type="url" bind:value={gbpCtaUrl} placeholder="https://…" class="input w-full text-sm font-mono" />
          </div>
          {/if}
        </div>

        {#if gbpTopicType === 'EVENT'}
        <div class="border border-border rounded-lg p-3 space-y-2">
          <p class="text-xs text-accent">Event Details</p>
          <input type="text" bind:value={gbpEventTitle} placeholder="Event title" class="input w-full text-sm" />
          <div class="grid grid-cols-2 gap-2">
            <input type="date" bind:value={gbpStartDate} class="input w-full text-sm" />
            <input type="time" bind:value={gbpStartTime} class="input w-full text-sm" />
            <input type="date" bind:value={gbpEndDate} class="input w-full text-sm" />
            <input type="time" bind:value={gbpEndTime} class="input w-full text-sm" />
          </div>
        </div>
        {/if}

        {#if gbpTopicType === 'OFFER'}
        <div class="border border-border rounded-lg p-3 space-y-2">
          <p class="text-xs text-accent">Offer Details</p>
          <div class="grid grid-cols-2 gap-2">
            <input type="text" bind:value={gbpCouponCode} placeholder="Coupon code" class="input w-full text-sm font-mono" />
            <input type="url" bind:value={gbpRedeemUrl} placeholder="Redeem URL" class="input w-full text-sm font-mono" />
          </div>
          <input type="text" bind:value={gbpTerms} placeholder="Terms & conditions" class="input w-full text-sm" />
        </div>
        {/if}

        <div class="flex justify-end gap-2">
          <button class="btn-secondary btn-sm text-xs" on:click={() => (editingGbp = false)}>Cancel</button>
          <button class="btn-primary btn-sm text-xs" on:click={saveGbp} disabled={savingGbp}>
            {savingGbp ? 'Saving…' : 'Save GBP'}
          </button>
        </div>
      </div>
      {:else}
      <dl class="space-y-1.5 text-xs">
        <div class="flex gap-3"><dt class="text-muted w-24 flex-shrink-0">Post Type</dt><dd class="text-white">{post.gbp_topic_type ?? 'STANDARD'}</dd></div>
        {#if post.gbp_cta_type}<div class="flex gap-3"><dt class="text-muted w-24 flex-shrink-0">CTA</dt><dd class="text-white">{post.gbp_cta_type}{post.gbp_cta_url ? ' → ' + post.gbp_cta_url : ''}</dd></div>{/if}
        {#if post.gbp_event_title}<div class="flex gap-3"><dt class="text-muted w-24 flex-shrink-0">Event</dt><dd class="text-white">{post.gbp_event_title}</dd></div>{/if}
        {#if post.gbp_event_start_date}<div class="flex gap-3"><dt class="text-muted w-24 flex-shrink-0">Dates</dt><dd class="text-white">{post.gbp_event_start_date} → {post.gbp_event_end_date ?? '—'}</dd></div>{/if}
        {#if post.gbp_coupon_code}<div class="flex gap-3"><dt class="text-muted w-24 flex-shrink-0">Coupon</dt><dd class="text-white font-mono">{post.gbp_coupon_code}</dd></div>{/if}
        {#if !gbpHasData}<p class="text-muted">No GBP settings configured. Click Edit GBP to add.</p>{/if}
      </dl>
      {/if}
    </div>
    {/if}

    <!-- Add caption for a new platform -->
    {#if getMissingPlatforms(post).length > 0}
    <div class="card p-4 border border-dashed border-border">
      <h4 class="text-xs font-medium text-muted mb-2">Generate caption for another platform</h4>
      <label class="mb-2 flex items-center gap-2 text-xs text-muted cursor-pointer">
        <input type="checkbox" bind:checked={allowAddPlatformOverride} class="rounded" />
        Allow incompatible platform override
      </label>
      <div class="flex gap-2">
        <select bind:value={addPlatform} class="input flex-1 text-sm" disabled={generatingCaption}>
          <option value="">Select platform…</option>
          {#each getMissingPlatforms(post) as pl}
          <option value={pl}>{platformLabels[pl] ?? pl}</option>
          {/each}
        </select>
        <button
          class="btn-primary btn-sm text-xs"
          disabled={!addPlatform || generatingCaption}
          on:click={generateCaption}
        >
          {generatingCaption ? 'Generating…' : '✦ Generate'}
        </button>
      </div>
    </div>
    {/if}
  </div>
  {/if}

  <!-- Platforms tab -->
  {#if activeTab === 'platforms'}
  <div class="card">
    {#if platforms.length === 0}
      <p class="text-sm text-muted text-center py-8">No platform tracking data yet.</p>
    {:else}
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Platform</th>
            <th>Status</th>
            <th>Tracking ID</th>
            <th>Published URL</th>
            <th>Error</th>
            <th>Attempted</th>
          </tr>
        </thead>
        <tbody>
          {#each platforms as pt}
            <tr>
              <td><PlatformBadge platform={pt.platform} /></td>
              <td><Badge status={pt.status ?? 'pending'} /></td>
              <td class="font-mono text-xs text-muted">{pt.tracking_id ?? '—'}</td>
              <td class="text-xs">
                {#if pt.real_url}
                  <a href={pt.real_url} target="_blank" class="text-accent hover:underline">View →</a>
                {:else}
                  <span class="text-muted">—</span>
                {/if}
              </td>
              <td class="text-xs text-red-400 max-w-xs truncate">{pt.error_message ?? '—'}</td>
              <td class="text-xs text-muted">{pt.attempted_at ? formatDate(pt.attempted_at) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {/if}
  </div>
  {/if}

  <!-- Diseño tab (for designer — in Spanish) -->
  {#if activeTab === 'diseno'}
  <div class="space-y-5">
    <!-- Header -->
    <div class="card p-5 border border-purple-500/20 bg-purple-500/5">
      <div class="flex items-start gap-3">
        <span class="text-2xl">🎨</span>
        <div>
          <h2 class="text-base font-semibold text-white">Sección para la Diseñadora</h2>
          <p class="text-xs text-muted mt-0.5">Instrucciones generadas por IA para crear el material visual de este post.</p>
        </div>
      </div>
    </div>

    <!-- Asset upload for designer -->
    <div class="card p-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-lg">📎</span>
        <h3 class="text-sm font-semibold text-white">Subir Archivo de Diseño</h3>
      </div>
      {#if post.asset_r2_key}
      <div class="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg mb-3">
        <span class="text-green-400 text-lg">✓</span>
        <div class="flex-1">
          <p class="text-xs text-green-400 font-medium">Archivo entregado</p>
          <p class="text-xs text-muted font-mono truncate">{post.asset_r2_key}</p>
        </div>
      </div>
      {/if}
      <label class="block">
        <span class="text-xs text-muted block mb-2">Sube la imagen o video terminado (JPG, PNG, MP4, MOV)</span>
        <input
          type="file"
          accept="image/*,video/*"
          class="block w-full text-sm text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-accent file:text-white hover:file:bg-blue-600 cursor-pointer"
          disabled={uploadingAsset}
          on:change={(e) => { assetFile = e.currentTarget.files; uploadAsset(); }}
        />
      </label>
      {#if uploadingAsset}
      <p class="text-xs text-accent mt-2">Subiendo archivo...</p>
      {/if}
    </div>

    {#if post.ai_image_prompt}
    <div class="card p-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-lg">🖼️</span>
        <h3 class="text-sm font-semibold text-white">Brief Visual — Imagen / Diseño</h3>
      </div>
      <p class="text-sm text-white/90 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-lg p-4 border border-white/10">{post.ai_image_prompt}</p>
      <div class="mt-3 flex gap-2">
        <span class="text-xs text-muted">Usa este prompt en:</span>
        <span class="text-xs text-purple-300 font-medium">Midjourney · Canva · Adobe Firefly · DALL-E</span>
      </div>
    </div>
    {/if}

    {#if post.ai_video_prompt}
    <div class="card p-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-lg">🎬</span>
        <h3 class="text-sm font-semibold text-white">Brief de Video</h3>
      </div>
      <p class="text-sm text-white/90 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-lg p-4 border border-white/10">{post.ai_video_prompt}</p>
      <div class="mt-3 flex gap-2">
        <span class="text-xs text-muted">Referencia para:</span>
        <span class="text-xs text-purple-300 font-medium">Reels · TikTok · YouTube Shorts</span>
      </div>
    </div>
    {/if}

    {#if post.video_script}
    <div class="card p-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-lg">🎙️</span>
        <h3 class="text-sm font-semibold text-white">Guión del Video</h3>
      </div>
      <pre class="text-sm text-white/90 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-lg p-4 border border-white/10 font-sans">{post.video_script}</pre>
    </div>
    {/if}

    {#if !post.ai_image_prompt && !post.ai_video_prompt && !post.video_script}
    <div class="card p-10 text-center">
      <span class="text-4xl block mb-3">🎨</span>
      <p class="text-sm text-muted mb-1">No hay prompts de diseño para este post.</p>
      <p class="text-xs text-muted">Los prompts se generan automáticamente cuando se crea contenido con IA.</p>
    </div>
    {/if}

    <!-- Post context summary for the designer -->
    {#if post.master_caption || post.content_type}
    <div class="card p-5 bg-white/3">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-xs font-medium text-muted uppercase tracking-wide">Contexto del Post</h3>
        <button
          class="btn-ghost btn-sm text-xs flex items-center gap-1.5"
          disabled={translating}
          on:click={translateContext}
        >
          {#if translating}
          <span class="text-accent">Traduciendo...</span>
          {:else}
          <span>🌐</span>
          <span>{translations ? 'Traducido ✓' : 'Traducir al Español'}</span>
          {/if}
        </button>
      </div>
      <div class="grid grid-cols-2 gap-3 text-xs">
        {#if post.content_type}
        <div>
          <span class="text-muted">Tipo de contenido:</span>
          <span class="text-white ml-1 capitalize">{post.content_type}</span>
        </div>
        {/if}
        {#if post.publish_date}
        <div>
          <span class="text-muted">Fecha de publicación:</span>
          <span class="text-white ml-1">{formatDate(post.publish_date)}</span>
        </div>
        {/if}
        {#if post.title}
        <div class="col-span-2">
          <span class="text-muted">Título del post:</span>
          <span class="text-white ml-1">{post.title}</span>
          {#if translations?.title}
          <p class="text-accent/90 mt-0.5 ml-1 italic">→ {translations.title}</p>
          {/if}
        </div>
        {/if}
        {#if post.master_caption}
        <div class="col-span-2">
          <span class="text-muted block mb-1">Caption principal:</span>
          <p class="text-white/80 italic bg-white/5 rounded p-2">{post.master_caption}</p>
          {#if translations?.master_caption}
          <p class="text-accent/90 italic bg-accent/5 border border-accent/20 rounded p-2 mt-1.5">→ {translations.master_caption}</p>
          {/if}
        </div>
        {/if}
      </div>
    </div>
    {/if}
  </div>
  {/if}

  <!-- Blog tab -->
  {#if activeTab === 'blog'}
  <div class="space-y-4">

    <!-- WordPress publish card -->
    {#if post.content_type === 'blog'}
    <div class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="section-label">WordPress</h3>
        {#if wpPostUrl(post)}
          <a href={wpPostUrl(post) ?? ''} target="_blank" rel="noopener" class="text-xs text-accent hover:underline truncate max-w-xs">{wpPostUrl(post)}</a>
        {/if}
      </div>

      <!-- Status row -->
      <div class="flex items-center gap-3 mb-4">
        {#if wpPostId(post)}
          <span class="text-xs px-2 py-0.5 rounded font-medium
            {wpPostStatus(post) === 'publish' ? 'bg-green-500/20 text-green-400' :
             wpPostStatus(post) === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
             'bg-surface text-muted'}">
            WP: {wpPostStatus(post) ?? 'draft'}
          </span>
          <span class="text-xs text-muted">ID #{wpPostId(post)}</span>
          {#if wpMediaId(post)}
            <span class="text-xs text-green-400/70">Featured image ✓</span>
          {:else}
            <span class="text-xs text-muted">No featured image</span>
          {/if}
        {:else}
          <span class="text-xs text-muted italic">Not yet published to WordPress</span>
        {/if}
      </div>

      <!-- Blog excerpt preview -->
      {#if blogExcerpt(post)}
      <div class="mb-4 bg-surface/50 rounded p-3">
        <p class="text-xs text-muted mb-1">Excerpt</p>
        <p class="text-xs text-white/80">{blogExcerpt(post)}</p>
      </div>
      {/if}

      <!-- Preflight warnings -->
      {#if blogWarnings.length > 0}
      <div class="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded p-3 space-y-1">
        {#each blogWarnings as w}
          <p class="text-xs text-yellow-400">⚠ {w}</p>
        {/each}
      </div>
      {/if}

      <!-- Action buttons -->
      <div class="flex items-center gap-2 flex-wrap">
        {#if !wpPostId(post)}
          <button class="btn-primary btn-sm" on:click={() => publishBlog('draft')} disabled={publishingBlog}>
            {publishingBlog ? 'Publishing…' : 'Push as Draft'}
          </button>
          <button class="btn-secondary btn-sm" on:click={() => publishBlog('publish')} disabled={publishingBlog}>
            {publishingBlog ? 'Publishing…' : 'Publish Live'}
          </button>
        {:else}
          <button class="btn-primary btn-sm" on:click={updateBlog} disabled={publishingBlog}>
            {publishingBlog ? 'Updating…' : 'Update WordPress'}
          </button>
          {#if wpPostStatus(post) === 'publish'}
            <button class="btn-ghost btn-sm text-yellow-400 hover:text-yellow-300" on:click={unpublishBlog} disabled={publishingBlog}>
              Revert to Draft
            </button>
          {:else}
            <button class="btn-secondary btn-sm" on:click={() => publishBlog('publish')} disabled={publishingBlog}>
              {publishingBlog ? 'Publishing…' : 'Publish Live'}
            </button>
          {/if}
        {/if}
      </div>
    </div>
    {/if}

    <!-- SEO card -->
    {#if post.seo_title || post.meta_description || post.target_keyword || post.slug}
    <div class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="section-label">SEO</h3>
        <a href="/posts/{post.id}/edit" class="btn-ghost btn-sm text-xs">Edit</a>
      </div>
      <dl class="space-y-2">
        {#if post.seo_title}
        <div><dt class="text-xs text-muted">SEO Title</dt><dd class="text-sm text-white mt-0.5">{post.seo_title}</dd></div>
        {/if}
        {#if post.target_keyword}
        <div><dt class="text-xs text-muted">Target Keyword</dt><dd class="text-sm text-white mt-0.5">{post.target_keyword}</dd></div>
        {/if}
        {#if post.meta_description}
        <div><dt class="text-xs text-muted">Meta Description</dt><dd class="text-xs text-muted mt-0.5">{post.meta_description}</dd></div>
        {/if}
        {#if post.slug}
        <div><dt class="text-xs text-muted">URL Slug</dt><dd class="text-xs font-mono text-white mt-0.5">/{post.slug}</dd></div>
        {/if}
      </dl>
    </div>
    {/if}

    <!-- Blog content -->
    {#if post.blog_content}
    <div class="card p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="section-label">Blog Content</h3>
        <a href="/posts/{post.id}/edit" class="btn-ghost btn-sm text-xs">Edit</a>
      </div>
      <div class="prose prose-invert prose-sm max-w-none text-sm text-white">
        {@html post.blog_content}
      </div>
    </div>
    {:else}
    <div class="card p-8 text-center">
      <p class="text-sm text-muted mb-3">No blog content yet.</p>
      <a href="/posts/{post.id}/edit" class="btn-primary btn-sm">Add Blog Content</a>
    </div>
    {/if}
  </div>
  {/if}
{/if}

<ConfirmDialog
  open={showApproveConfirm}
  title="Approve Post"
  message="This will approve the post and mark it ready for automation. The next posting run will pick it up."
  confirmLabel="Approve"
  on:confirm={() => { showApproveConfirm = false; approve(); }}
  on:cancel={() => (showApproveConfirm = false)}
/>
<ConfirmDialog
  open={showRejectConfirm}
  title="Reject Post"
  message="This will reject the post and send it back to Draft status."
  confirmLabel="Reject"
  confirmClass="btn-danger"
  on:confirm={() => { showRejectConfirm = false; reject(); }}
  on:cancel={() => (showRejectConfirm = false)}
/>
<ConfirmDialog
  open={showDeleteConfirm}
  title="Delete Post"
  message="This will permanently delete &quot;{post?.title ?? 'this post'}&quot; and all its platform records. This cannot be undone."
  confirmLabel="Delete"
  confirmClass="btn-danger"
  on:confirm={() => { showDeleteConfirm = false; deletePost(); }}
  on:cancel={() => (showDeleteConfirm = false)}
/>
