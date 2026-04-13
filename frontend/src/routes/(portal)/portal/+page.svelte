<script lang="ts">
  import { onMount } from 'svelte';
  import { portalApi } from '$lib/api';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { PortalSummary, PortalFeedback } from '$lib/api/portal';
  import { PLATFORM_META } from '$lib/types';

  let data: PortalSummary | null = null;
  let feedback: PortalFeedback[] = [];
  let loading = true;
  let error   = '';

  // Feedback form
  let fbCategory  = 'other';
  let fbSentiment = 'neutral';
  let fbMessage   = '';
  let fbSubmitting = false;
  let fbSuccess    = false;

  const categories = [
    { value: 'content_quality', label: 'Content Quality' },
    { value: 'timing',          label: 'Post Timing' },
    { value: 'platform_issue',  label: 'Platform Issue' },
    { value: 'design',          label: 'Design / Media' },
    { value: 'other',           label: 'Other' },
  ];

  const sentiments = [
    { value: 'positive', label: '👍 Positive', cls: 'border-green-500/40 bg-green-500/10 text-green-400' },
    { value: 'neutral',  label: '😐 Neutral',  cls: 'border-border bg-card text-muted' },
    { value: 'negative', label: '👎 Negative', cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
  ];

  onMount(async () => {
    try {
      const [s, f] = await Promise.all([
        portalApi.summary(),
        portalApi.getFeedback().catch(() => ({ feedback: [] as PortalFeedback[] })),
      ]);
      data     = s;
      feedback = f.feedback;
    } catch (e) {
      error = 'Failed to load dashboard.';
    } finally {
      loading = false;
    }
  });

  async function submitFeedback() {
    if (!fbMessage.trim()) return;
    fbSubmitting = true;
    try {
      await portalApi.submitFeedback({ category: fbCategory, sentiment: fbSentiment, message: fbMessage });
      fbSuccess  = true;
      fbMessage  = '';
      fbCategory = 'other';
      fbSentiment = 'neutral';
      const f = await portalApi.getFeedback().catch(() => ({ feedback: [] as PortalFeedback[] }));
      feedback = f.feedback;
      setTimeout(() => { fbSuccess = false; }, 4000);
    } catch {
      // silent — form state handles it
    } finally {
      fbSubmitting = false;
    }
  }

  function platformLabel(p: string) { return PLATFORM_META[p]?.label ?? p; }
  function platformColor(p: string) { return PLATFORM_META[p]?.color ?? '#888'; }

  function parsePlatforms(raw: string): string[] {
    try { return JSON.parse(raw); } catch { return []; }
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function statusCls(s: string) {
    if (s === 'posted')    return 'bg-green-500/10 text-green-400';
    if (s === 'scheduled') return 'bg-accent/10 text-accent';
    if (s === 'approved' || s === 'ready') return 'bg-yellow-500/10 text-yellow-400';
    return 'bg-card text-muted';
  }

  function sentimentCls(s: string) {
    if (s === 'positive') return 'text-green-400';
    if (s === 'negative') return 'text-red-400';
    return 'text-muted';
  }

  function sentimentIcon(s: string) {
    if (s === 'positive') return '👍';
    if (s === 'negative') return '👎';
    return '😐';
  }

  function timeAgo(ts: number) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60)   return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
</script>

<svelte:head><title>{data?.client.canonical_name ?? 'Portal'} — WebXni</title></svelte:head>

{#if loading}
  <div class="flex justify-center py-24"><Spinner size="lg" /></div>
{:else if error}
  <div class="max-w-4xl mx-auto">
    <div class="card p-8 text-center text-red-400">{error}</div>
  </div>
{:else if data}
  <div class="max-w-5xl mx-auto space-y-6">

    <!-- ── Header ──────────────────────────────────────────────────── -->
    <div class="card p-6">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-4">
          <!-- Avatar / Logo -->
          <div
            class="w-14 h-14 rounded-xl flex items-center justify-center text-white text-xl font-bold shrink-0"
            style="background:{data.client.brand_primary_color ?? '#1a73e8'}22; color:{data.client.brand_primary_color ?? '#1a73e8'}"
          >
            {data.client.canonical_name[0]}
          </div>
          <div>
            <h1 class="text-lg font-semibold text-white">{data.client.canonical_name}</h1>
            <div class="flex flex-wrap items-center gap-2 mt-1">
              {#if data.client.industry}
                <span class="text-xs text-muted bg-card px-2 py-0.5 rounded-full border border-border">
                  {data.client.industry}
                </span>
              {/if}
              {#if data.client.state}
                <span class="text-xs text-muted">📍 {data.client.state}</span>
              {/if}
            </div>
          </div>
        </div>
        <div class="text-right">
          <p class="text-xs text-muted">Report period</p>
          <p class="text-sm font-medium text-white">
            {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      <!-- Active platforms -->
      {#if data.active_platforms.length > 0}
      <div class="mt-4 pt-4 border-t border-border">
        <p class="text-xs text-muted mb-2">Active platforms</p>
        <div class="flex flex-wrap gap-2">
          {#each data.active_platforms as p}
            <span
              class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
              style="border-color:{platformColor(p)}44; background:{platformColor(p)}15; color:{platformColor(p)}"
            >
              {platformLabel(p)}
            </span>
          {/each}
        </div>
      </div>
      {/if}
    </div>

    <!-- ── Stats ───────────────────────────────────────────────────── -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="card p-5 text-center">
        <div class="text-3xl font-bold text-white">{data.summary.total}</div>
        <div class="text-xs text-muted mt-1.5 font-medium">Total Posts</div>
        <div class="text-xs text-muted mt-0.5">this month</div>
      </div>
      <div class="card p-5 text-center">
        <div class="text-3xl font-bold text-green-400">{data.summary.published}</div>
        <div class="text-xs text-muted mt-1.5 font-medium">Published</div>
        <div class="text-xs text-muted mt-0.5">
          {data.summary.total > 0 ? Math.round(data.summary.published / data.summary.total * 100) : 0}% success
        </div>
      </div>
      <div class="card p-5 text-center">
        <div class="text-3xl font-bold text-accent">{data.summary.scheduled}</div>
        <div class="text-xs text-muted mt-1.5 font-medium">Upcoming</div>
        <div class="text-xs text-muted mt-0.5">ready to post</div>
      </div>
      <div class="card p-5 text-center">
        <div class="text-3xl font-bold {data.summary.failed > 0 ? 'text-red-400' : 'text-muted'}">{data.summary.failed}</div>
        <div class="text-xs text-muted mt-1.5 font-medium">Failed</div>
        <div class="text-xs text-muted mt-0.5">needs review</div>
      </div>
    </div>

    <!-- ── Two-column layout ───────────────────────────────────────── -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

      <!-- Left: platform breakdown + recent posts -->
      <div class="lg:col-span-2 space-y-6">

        <!-- Platform breakdown -->
        {#if data.by_platform.length > 0}
        <div class="card">
          <div class="px-5 py-3.5 border-b border-border">
            <h2 class="text-sm font-semibold text-white">Platform Activity</h2>
          </div>
          <div class="px-5 py-2 divide-y divide-border">
            {#each data.by_platform as row}
            <div class="py-2.5 flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:{platformColor(row.platform)}"></span>
                <span class="text-sm text-white">{platformLabel(row.platform)}</span>
              </div>
              <div class="flex items-center gap-3">
                <span class="text-xs text-muted capitalize">{row.status.replace('_', ' ')}</span>
                <span class="text-sm font-semibold text-white w-6 text-right">{row.count}</span>
              </div>
            </div>
            {/each}
          </div>
        </div>
        {/if}

        <!-- Recent content -->
        {#if data.recent_posts.length > 0}
        <div class="card">
          <div class="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h2 class="text-sm font-semibold text-white">Recent Content</h2>
            <a href="/portal/posts" class="text-xs text-accent hover:underline font-medium">View all →</a>
          </div>
          <div class="divide-y divide-border">
            {#each data.recent_posts as post}
            <div class="px-5 py-3.5">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-white truncate">{post.title || '(untitled)'}</p>
                  <div class="flex flex-wrap items-center gap-2 mt-1.5">
                    <span class="text-xs text-muted">{fmtDate(post.publish_date)}</span>
                    {#each parsePlatforms(post.platforms).slice(0, 3) as p}
                      <span
                        class="text-xs px-1.5 py-0.5 rounded"
                        style="background:{platformColor(p)}18; color:{platformColor(p)}"
                      >{platformLabel(p)}</span>
                    {/each}
                    {#if parsePlatforms(post.platforms).length > 3}
                      <span class="text-xs text-muted">+{parsePlatforms(post.platforms).length - 3}</span>
                    {/if}
                  </div>
                </div>
                <span class="text-xs shrink-0 capitalize px-2 py-0.5 rounded-full {statusCls(post.status)}">
                  {post.status.replace('_', ' ')}
                </span>
              </div>
            </div>
            {/each}
          </div>
        </div>
        {/if}
      </div>

      <!-- Right: contact info + feedback -->
      <div class="space-y-6">

        <!-- Client info card -->
        <div class="card">
          <div class="px-5 py-3.5 border-b border-border">
            <h2 class="text-sm font-semibold text-white">Account Info</h2>
          </div>
          <div class="px-5 py-4 space-y-3">
            {#if data.client.email}
              <div>
                <p class="text-xs text-muted">Email</p>
                <p class="text-sm text-white mt-0.5">{data.client.email}</p>
              </div>
            {/if}
            {#if data.client.phone}
              <div>
                <p class="text-xs text-muted">Phone</p>
                <p class="text-sm text-white mt-0.5">{data.client.phone}</p>
              </div>
            {/if}
            {#if data.client.industry}
              <div>
                <p class="text-xs text-muted">Industry</p>
                <p class="text-sm text-white mt-0.5">{data.client.industry}</p>
              </div>
            {/if}
            {#if data.client.package}
              <div>
                <p class="text-xs text-muted">Package</p>
                <p class="text-sm text-white mt-0.5 capitalize">{data.client.package}</p>
              </div>
            {/if}
            {#if !data.client.email && !data.client.phone && !data.client.industry}
              <p class="text-xs text-muted">No contact information on file.</p>
            {/if}
          </div>
        </div>

        <!-- Feedback form -->
        <div class="card">
          <div class="px-5 py-3.5 border-b border-border">
            <h2 class="text-sm font-semibold text-white">Send Feedback</h2>
            <p class="text-xs text-muted mt-0.5">Share thoughts on your content</p>
          </div>
          <div class="px-5 py-4 space-y-3">
            {#if fbSuccess}
              <div class="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
                <p class="text-sm text-green-400 font-medium">Thank you for your feedback!</p>
                <p class="text-xs text-muted mt-0.5">We'll review it shortly.</p>
              </div>
            {:else}
              <div>
                <label class="block text-xs text-muted mb-1.5" for="fbCategory">Category</label>
                <select id="fbCategory" bind:value={fbCategory} class="input w-full text-sm">
                  {#each categories as c}
                    <option value={c.value}>{c.label}</option>
                  {/each}
                </select>
              </div>

              <div>
                <p class="text-xs text-muted mb-1.5">How are we doing?</p>
                <div class="flex gap-2">
                  {#each sentiments as s}
                    <button
                      class="flex-1 text-xs py-1.5 px-2 rounded-md border transition-all {fbSentiment === s.value ? s.cls : 'border-border text-muted hover:border-border/80'}"
                      on:click={() => (fbSentiment = s.value)}
                    >{s.label}</button>
                  {/each}
                </div>
              </div>

              <div>
                <label class="block text-xs text-muted mb-1.5" for="fbMessage">Message</label>
                <textarea
                  id="fbMessage"
                  bind:value={fbMessage}
                  rows="3"
                  placeholder="Tell us what you think…"
                  class="input w-full resize-none text-sm"
                ></textarea>
              </div>

              <button
                class="btn-primary w-full justify-center text-sm py-2"
                on:click={submitFeedback}
                disabled={fbSubmitting || !fbMessage.trim()}
              >
                {fbSubmitting ? 'Sending…' : 'Send Feedback'}
              </button>
            {/if}
          </div>
        </div>

        <!-- Past feedback -->
        {#if feedback.length > 0}
        <div class="card">
          <div class="px-5 py-3.5 border-b border-border">
            <h2 class="text-sm font-semibold text-white">Your Feedback</h2>
          </div>
          <div class="divide-y divide-border max-h-64 overflow-y-auto">
            {#each feedback as fb}
            <div class="px-5 py-3">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs {sentimentCls(fb.sentiment)}">{sentimentIcon(fb.sentiment)} {fb.category.replace('_', ' ')}</span>
                <span class="text-xs text-muted">{timeAgo(fb.created_at)}</span>
              </div>
              <p class="text-xs text-white/80 leading-relaxed">{fb.message}</p>
            </div>
            {/each}
          </div>
        </div>
        {/if}

      </div>
    </div>
  </div>
{/if}
