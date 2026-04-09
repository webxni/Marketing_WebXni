<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { postsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { formatDate, formatDateTime, parsePlatforms } from '$lib/utils';
  import type { Post, PostPlatform } from '$lib/types';

  let post: Post | null = null;
  let platforms: PostPlatform[] = [];
  let loading = true;
  let activeTab: 'overview' | 'captions' | 'platforms' | 'blog' = 'overview';
  let showApproveConfirm = false;
  let showRejectConfirm = false;
  let showReadyConfirm = false;

  function setTab(key: string) { activeTab = key as typeof activeTab; }

  async function load() {
    loading = true;
    try {
      const r = await postsApi.get($page.params.id);
      post = r.post;
      platforms = r.platforms ?? [];
    } finally { loading = false; }
  }

  onMount(load);

  async function approve() {
    if (!post) return;
    try { await postsApi.approve(post.id); toast.success('Post approved'); load(); }
    catch { toast.error('Failed to approve'); }
  }

  async function reject() {
    if (!post) return;
    try { await postsApi.reject(post.id); toast.success('Post rejected'); load(); }
    catch { toast.error('Failed to reject'); }
  }

  async function markReady() {
    if (!post) return;
    try { await postsApi.markReady(post.id); toast.success('Marked as Ready for Automation'); load(); }
    catch { toast.error('Failed to update'); }
  }

  async function retryFailed() {
    if (!post) return;
    try { await postsApi.retry(post.id); toast.success('Retrying failed platforms'); load(); }
    catch { toast.error('Failed to retry'); }
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
      {#if post.status === 'draft' && can('posts.approve')}
        <button class="btn-primary btn-sm" on:click={() => (showApproveConfirm = true)}>Approve</button>
        <button class="btn-danger btn-sm" on:click={() => (showRejectConfirm = true)}>Reject</button>
      {/if}
      {#if post.status === 'approved' && can('automation.trigger')}
        <button class="btn-primary btn-sm" on:click={() => (showReadyConfirm = true)}>Mark Ready</button>
      {/if}
      {#if post.status === 'failed' && can('automation.trigger')}
        <button class="btn-secondary btn-sm" on:click={retryFailed}>Retry Failed</button>
      {/if}
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex border-b border-border mb-6">
    {#each [
      { key: 'overview',  label: 'Overview'  },
      { key: 'captions',  label: 'Captions'  },
      { key: 'platforms', label: 'Platforms' },
      { key: 'blog',      label: 'Blog'      },
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
    <div class="card p-5">
      <h3 class="section-label mb-4">Details</h3>
      <dl class="space-y-3">
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Post ID</dt>
          <dd class="text-xs font-mono text-white">{post.id}</dd>
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
      <div class="flex flex-wrap gap-2">
        {#each parsePlatforms(post.platforms) as p}
          <PlatformBadge platform={p} />
        {/each}
      </div>

      <div class="mt-4 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted">Ready for Automation</span>
          <span class="text-xs {post.ready_for_automation ? 'text-green-400' : 'text-muted'}">
            {post.ready_for_automation ? 'Yes' : 'No'}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted">Asset Delivered</span>
          <span class="text-xs {post.asset_delivered ? 'text-green-400' : 'text-muted'}">
            {post.asset_delivered ? 'Yes' : 'No'}
          </span>
        </div>
        {#if post.skarleth_status}
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted">Skarleth Status</span>
          <span class="text-xs text-white">{post.skarleth_status}</span>
        </div>
        {/if}
      </div>

      {#if post.error_log}
      <div class="mt-4">
        <h4 class="text-xs text-muted mb-2">Error Log</h4>
        <pre class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2 overflow-auto max-h-32">{post.error_log}</pre>
      </div>
      {/if}
    </div>

    {#if post.master_caption}
    <div class="card p-5 md:col-span-2">
      <h3 class="section-label mb-3">Master Caption</h3>
      <p class="text-sm text-white whitespace-pre-wrap">{post.master_caption}</p>
    </div>
    {/if}
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
    {#if post.youtube_title}
    <div class="card p-4">
      <h4 class="text-xs font-medium text-muted mb-2">YouTube Title</h4>
      <p class="text-sm text-white">{post.youtube_title}</p>
      {#if post.youtube_description}
      <p class="text-xs text-muted mt-2 whitespace-pre-wrap">{post.youtube_description}</p>
      {/if}
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

  <!-- Blog tab -->
  {#if activeTab === 'blog'}
  <div class="space-y-4">
    {#if post.seo_title || post.meta_description}
    <div class="card p-4">
      <h3 class="section-label mb-3">SEO</h3>
      {#if post.seo_title}<p class="text-sm font-medium text-white mb-1">{post.seo_title}</p>{/if}
      {#if post.meta_description}<p class="text-xs text-muted">{post.meta_description}</p>{/if}
    </div>
    {/if}
    {#if post.blog_content}
    <div class="card p-5">
      <h3 class="section-label mb-3">Blog Content</h3>
      <div class="prose prose-invert prose-sm max-w-none text-sm text-white">
        {@html post.blog_content}
      </div>
    </div>
    {:else}
    <div class="card p-8 text-center text-sm text-muted">No blog content generated yet.</div>
    {/if}
  </div>
  {/if}
{/if}

<ConfirmDialog
  open={showApproveConfirm}
  title="Approve Post"
  message="This will mark the post as Approved and send it to the review queue."
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
  open={showReadyConfirm}
  title="Mark Ready for Automation"
  message="This will set the post as Ready for Automation. The next posting run will pick it up."
  confirmLabel="Mark Ready"
  on:confirm={() => { showReadyConfirm = false; markReady(); }}
  on:cancel={() => (showReadyConfirm = false)}
/>
