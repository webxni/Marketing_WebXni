<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { postsApi } from '$lib/api';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { toast } from '$lib/stores/ui';
  import type { Post } from '$lib/types';

  let post: Post | null = null;
  let loading = true;
  let saving = false;

  // Core fields
  let title = '';
  let publishDate = '';
  let masterCaption = '';

  // Captions
  let cap_facebook = '';
  let cap_instagram = '';
  let cap_linkedin = '';
  let cap_x = '';
  let cap_threads = '';
  let cap_tiktok = '';
  let cap_pinterest = '';
  let cap_bluesky = '';
  let cap_google_business = '';
  // GBP multi-location
  let cap_gbp_la = '';
  let cap_gbp_wa = '';
  let cap_gbp_or = '';

  // Blog content
  let blog_content = '';
  let seo_title = '';
  let meta_description = '';
  let target_keyword = '';
  let post_slug = '';

  // YouTube
  let youtube_title = '';
  let youtube_description = '';

  // Video / Reel
  let video_script = '';
  let ai_video_prompt = '';

  // Image
  let ai_image_prompt = '';

  // Canva
  let canva_link = '';

  let activeTab: 'captions' | 'blog' | 'media' = 'captions';

  $: isBlog       = post?.content_type === 'blog';
  $: isYoutube    = post ? JSON.parse(post.platforms ?? '[]').includes('youtube') : false;
  $: isVideo      = post?.content_type === 'video' || post?.content_type === 'reel';
  $: isImage      = post?.content_type === 'image';
  $: isGbp        = post ? JSON.parse(post.platforms ?? '[]').includes('google_business') : false;

  onMount(async () => {
    try {
      const r = await postsApi.get($page.params.id);
      post = r.post;
      // Core
      title          = post.title ?? '';
      publishDate    = post.publish_date ?? '';
      masterCaption  = post.master_caption ?? '';
      // Captions
      cap_facebook        = post.cap_facebook       ?? '';
      cap_instagram       = post.cap_instagram      ?? '';
      cap_linkedin        = post.cap_linkedin       ?? '';
      cap_x               = post.cap_x              ?? '';
      cap_threads         = post.cap_threads        ?? '';
      cap_tiktok          = post.cap_tiktok         ?? '';
      cap_pinterest       = post.cap_pinterest      ?? '';
      cap_bluesky         = post.cap_bluesky        ?? '';
      cap_google_business = post.cap_google_business ?? '';
      cap_gbp_la          = post.cap_gbp_la          ?? '';
      cap_gbp_wa          = post.cap_gbp_wa          ?? '';
      cap_gbp_or          = post.cap_gbp_or          ?? '';
      // Blog
      blog_content    = post.blog_content    ?? '';
      seo_title       = post.seo_title       ?? '';
      meta_description = post.meta_description ?? '';
      target_keyword  = post.target_keyword  ?? '';
      post_slug       = post.slug            ?? '';
      // YouTube
      youtube_title       = post.youtube_title       ?? '';
      youtube_description = post.youtube_description ?? '';
      // Video
      video_script    = post.video_script   ?? '';
      ai_video_prompt = post.ai_video_prompt ?? '';
      // Image
      ai_image_prompt = post.ai_image_prompt ?? '';
      // Canva
      canva_link = post.canva_link ?? '';

      // Default tab based on content type
      if (isBlog) activeTab = 'blog';
      else if (isVideo || isImage || isYoutube) activeTab = 'media';
    } catch { toast.error('Failed to load post'); }
    finally { loading = false; }
  });

  async function save() {
    saving = true;
    try {
      await postsApi.update($page.params.id, {
        title:               title || null,
        publish_date:        publishDate || null,
        master_caption:      masterCaption || null,
        cap_facebook:        cap_facebook || null,
        cap_instagram:       cap_instagram || null,
        cap_linkedin:        cap_linkedin || null,
        cap_x:               cap_x || null,
        cap_threads:         cap_threads || null,
        cap_tiktok:          cap_tiktok || null,
        cap_pinterest:       cap_pinterest || null,
        cap_bluesky:         cap_bluesky || null,
        cap_google_business: cap_google_business || null,
        cap_gbp_la:          cap_gbp_la          || null,
        cap_gbp_wa:          cap_gbp_wa          || null,
        cap_gbp_or:          cap_gbp_or          || null,
        blog_content:        blog_content || null,
        seo_title:           seo_title || null,
        meta_description:    meta_description || null,
        target_keyword:      target_keyword || null,
        slug:                post_slug || null,
        youtube_title:       youtube_title || null,
        youtube_description: youtube_description || null,
        video_script:        video_script || null,
        ai_image_prompt:     ai_image_prompt || null,
        ai_video_prompt:     ai_video_prompt || null,
        canva_link:          canva_link || null,
      });
      toast.success('Post saved');
      goto(`/posts/${$page.params.id}`);
    } catch (e) { toast.error(String(e)); }
    finally { saving = false; }
  }
</script>

<svelte:head><title>Edit {post?.title ?? 'Post'} — WebXni</title></svelte:head>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if post}
  <!-- Header -->
  <div class="page-header">
    <div>
      <div class="flex items-center gap-2 text-xs text-muted mb-1">
        <a href="/posts" class="hover:text-white">Posts</a>
        <span>/</span>
        <a href="/posts/{post.id}" class="hover:text-white truncate max-w-xs">{post.title ?? post.id}</a>
        <span>/</span>
        <span>Edit</span>
      </div>
      <h1 class="page-title">Edit Post</h1>
    </div>
    <div class="flex gap-2">
      <a href="/posts/{post.id}" class="btn-ghost btn-sm">Cancel</a>
      <button class="btn-primary btn-sm" on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  </div>

  <!-- Core fields always visible -->
  <div class="card p-5 mb-6">
    <h3 class="section-label mb-4">Post Details</h3>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="md:col-span-2">
        <label for="title" class="block text-xs text-muted mb-1.5">Title</label>
        <input id="title" type="text" bind:value={title} placeholder="Post title…" class="input w-full" />
      </div>
      <div>
        <label for="publish_date" class="block text-xs text-muted mb-1.5">Publish Date</label>
        <input id="publish_date" type="datetime-local" bind:value={publishDate} class="input w-full" />
      </div>
      <div class="md:col-span-3">
        <label for="canva_link" class="block text-xs text-muted mb-1.5">Canva Link (optional)</label>
        <input id="canva_link" type="url" bind:value={canva_link} placeholder="https://www.canva.com/design/…" class="input w-full" />
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex border-b border-border mb-6">
    <button
      class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
             {activeTab === 'captions' ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}"
      on:click={() => activeTab = 'captions'}
    >Captions</button>
    {#if isBlog}
    <button
      class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
             {activeTab === 'blog' ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}"
      on:click={() => activeTab = 'blog'}
    >Blog Content</button>
    {/if}
    {#if isVideo || isImage || isYoutube}
    <button
      class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
             {activeTab === 'media' ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}"
      on:click={() => activeTab = 'media'}
    >Media / Production</button>
    {/if}
  </div>

  <!-- Captions tab -->
  {#if activeTab === 'captions'}
  <div class="space-y-5">
    <div class="card p-5">
      <h3 class="section-label mb-4">Master Caption</h3>
      <label for="master_caption" class="sr-only">Master Caption</label>
      <textarea
        id="master_caption"
        bind:value={masterCaption}
        rows="5"
        placeholder="Master caption used as fallback for all platforms…"
        class="input w-full resize-none font-mono text-xs"
      ></textarea>
      <p class="text-xs text-muted mt-1">{masterCaption.length} characters</p>
    </div>

    <div class="card p-5">
      <h3 class="section-label mb-4">Platform Captions</h3>
      <p class="text-xs text-muted mb-4">Leave blank to use master caption.</p>
      <div class="space-y-4">
        <div>
          <label for="cap_facebook" class="block text-xs text-muted mb-1.5">Facebook</label>
          <textarea id="cap_facebook" bind:value={cap_facebook} rows="3" placeholder="Leave blank to use master caption…" class="input w-full resize-none font-mono text-xs"></textarea>
        </div>
        <div>
          <label for="cap_instagram" class="block text-xs text-muted mb-1.5">Instagram</label>
          <textarea id="cap_instagram" bind:value={cap_instagram} rows="3" placeholder="Leave blank to use master caption…" class="input w-full resize-none font-mono text-xs"></textarea>
        </div>
        <div>
          <label for="cap_linkedin" class="block text-xs text-muted mb-1.5">LinkedIn</label>
          <textarea id="cap_linkedin" bind:value={cap_linkedin} rows="3" placeholder="Leave blank to use master caption…" class="input w-full resize-none font-mono text-xs"></textarea>
        </div>
        <div>
          <label for="cap_x" class="block text-xs text-muted mb-1.5">X / Twitter</label>
          <textarea id="cap_x" bind:value={cap_x} rows="3" placeholder="Leave blank to use master caption…" class="input w-full resize-none font-mono text-xs"></textarea>
        </div>
        <div>
          <label for="cap_threads" class="block text-xs text-muted mb-1.5">Threads</label>
          <textarea id="cap_threads" bind:value={cap_threads} rows="3" placeholder="Leave blank to use master caption…" class="input w-full resize-none font-mono text-xs"></textarea>
        </div>
        <div>
          <label for="cap_tiktok" class="block text-xs text-muted mb-1.5">TikTok</label>
          <textarea id="cap_tiktok" bind:value={cap_tiktok} rows="3" placeholder="Leave blank to use master caption…" class="input w-full resize-none font-mono text-xs"></textarea>
        </div>
        <div>
          <label for="cap_pinterest" class="block text-xs text-muted mb-1.5">Pinterest</label>
          <textarea id="cap_pinterest" bind:value={cap_pinterest} rows="3" placeholder="Leave blank to use master caption…" class="input w-full resize-none font-mono text-xs"></textarea>
        </div>
        <div>
          <label for="cap_bluesky" class="block text-xs text-muted mb-1.5">Bluesky</label>
          <textarea id="cap_bluesky" bind:value={cap_bluesky} rows="3" placeholder="Leave blank to use master caption…" class="input w-full resize-none font-mono text-xs"></textarea>
        </div>
        <div>
          <label for="cap_google_business" class="block text-xs text-muted mb-1.5">Google Business</label>
          <textarea id="cap_google_business" bind:value={cap_google_business} rows="3" placeholder="Leave blank to use master caption…" class="input w-full resize-none font-mono text-xs"></textarea>
        </div>
        {#if isGbp}
        <div class="pt-3 border-t border-border">
          <p class="text-xs text-muted mb-3">GBP multi-location overrides (leave blank to use Google Business caption above)</p>
          <div class="space-y-3">
            <div>
              <label for="cap_gbp_la" class="block text-xs text-muted mb-1.5">GBP — Los Angeles</label>
              <textarea id="cap_gbp_la" bind:value={cap_gbp_la} rows="3" placeholder="Leave blank to use Google Business caption…" class="input w-full resize-none font-mono text-xs"></textarea>
            </div>
            <div>
              <label for="cap_gbp_wa" class="block text-xs text-muted mb-1.5">GBP — Washington</label>
              <textarea id="cap_gbp_wa" bind:value={cap_gbp_wa} rows="3" placeholder="Leave blank to use Google Business caption…" class="input w-full resize-none font-mono text-xs"></textarea>
            </div>
            <div>
              <label for="cap_gbp_or" class="block text-xs text-muted mb-1.5">GBP — Oregon</label>
              <textarea id="cap_gbp_or" bind:value={cap_gbp_or} rows="3" placeholder="Leave blank to use Google Business caption…" class="input w-full resize-none font-mono text-xs"></textarea>
            </div>
          </div>
        </div>
        {/if}
      </div>
    </div>
  </div>
  {/if}

  <!-- Blog Content tab -->
  {#if activeTab === 'blog' && isBlog}
  <div class="space-y-5">
    <div class="card p-5">
      <h3 class="section-label mb-4">Blog Body (HTML)</h3>
      <label for="blog_content" class="sr-only">Blog Content</label>
      <textarea
        id="blog_content"
        bind:value={blog_content}
        rows="20"
        placeholder="<p>Write or paste your blog post HTML here…</p>"
        class="input w-full resize-y font-mono text-xs"
      ></textarea>
      <p class="text-xs text-muted mt-1">HTML is sent directly to WordPress REST API. Supports all standard HTML tags.</p>
    </div>

    <div class="card p-5">
      <h3 class="section-label mb-4">SEO</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label for="seo_title" class="block text-xs text-muted mb-1.5">SEO Title</label>
          <input id="seo_title" type="text" bind:value={seo_title} placeholder="Keyword-rich page title…" class="input w-full" />
          <p class="text-xs text-muted mt-1">{seo_title.length}/60 characters</p>
        </div>
        <div>
          <label for="target_keyword" class="block text-xs text-muted mb-1.5">Target Keyword</label>
          <input id="target_keyword" type="text" bind:value={target_keyword} placeholder="e.g. locksmith los angeles" class="input w-full" />
        </div>
        <div>
          <label for="meta_description" class="block text-xs text-muted mb-1.5">Meta Description</label>
          <input id="meta_description" type="text" bind:value={meta_description} placeholder="150-character summary…" class="input w-full" />
          <p class="text-xs text-muted mt-1">{meta_description.length}/155 characters</p>
        </div>
        <div>
          <label for="post_slug" class="block text-xs text-muted mb-1.5">URL Slug</label>
          <input id="post_slug" type="text" bind:value={post_slug} placeholder="keyword-rich-url-slug" class="input w-full font-mono text-xs" />
          <p class="text-xs text-muted mt-1">Leave blank — WordPress auto-generates from title.</p>
        </div>
      </div>
    </div>
  </div>
  {/if}

  <!-- Media / Production tab -->
  {#if activeTab === 'media'}
  <div class="space-y-5">
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
          <textarea id="youtube_description" bind:value={youtube_description} rows="6" placeholder="Full description with timestamps, links, hashtags…" class="input w-full resize-none text-sm"></textarea>
        </div>
      </div>
    </div>
    {/if}

    {#if isVideo}
    <div class="card p-5">
      <h3 class="section-label mb-4">Script / Voiceover</h3>
      <label for="video_script" class="sr-only">Video Script</label>
      <textarea
        id="video_script"
        bind:value={video_script}
        rows="10"
        placeholder="Hook line…&#10;&#10;Body content…&#10;&#10;Call to action: Call us at 555-1234"
        class="input w-full resize-none text-sm"
      ></textarea>
    </div>
    <div class="card p-5">
      <h3 class="section-label mb-4">AI Video Prompt (optional)</h3>
      <label for="ai_video_prompt" class="sr-only">AI Video Prompt</label>
      <textarea
        id="ai_video_prompt"
        bind:value={ai_video_prompt}
        rows="4"
        placeholder="Describe the scene, style, and mood for AI video generation…"
        class="input w-full resize-none text-xs font-mono"
      ></textarea>
    </div>
    {/if}

    {#if isImage}
    <div class="card p-5">
      <h3 class="section-label mb-4">AI Image Prompt (optional)</h3>
      <label for="ai_image_prompt" class="sr-only">AI Image Prompt</label>
      <textarea
        id="ai_image_prompt"
        bind:value={ai_image_prompt}
        rows="4"
        placeholder="Describe the image: style, subject, colors, mood, text overlay…"
        class="input w-full resize-none text-xs font-mono"
      ></textarea>
      <p class="text-xs text-muted mt-1">Used when AI image generation is triggered for this post.</p>
    </div>
    {/if}
  </div>
  {/if}

  <!-- Sticky bottom save bar -->
  <div class="mt-8 flex justify-end gap-3">
    <a href="/posts/{post.id}" class="btn-ghost btn-sm">Cancel</a>
    <button class="btn-primary btn-sm" on:click={save} disabled={saving}>
      {saving ? 'Saving…' : 'Save Changes'}
    </button>
  </div>
{/if}
