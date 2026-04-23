<!--
  MediaGallery — multi-image uploader + previews for image posts.

  Two modes:
    • post mode (postId + clientId set): uploads go directly to the post with
      auto-assigned sort_order. Delete / reorder persist to the server.
    • draft mode (clientId only): uploads are created unattached. The parent
      tracks `value` (PostAsset[]) and passes the ids into POST /api/posts as
      `asset_ids` so the backend attaches them on create.

  The component is view-only when `readonly` is set — used by approvals and
  post detail when the viewer should see all images but not mutate the set.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { assetsApi, type PostAsset } from '$lib/api';
  import { toast } from '$lib/stores/ui';
  import Spinner from './Spinner.svelte';

  export let value: PostAsset[] = [];
  export let clientId: string | null = null;
  export let postId: string | null = null;
  export let readonly = false;
  /** Hide the uploader even when editable — useful in approvals detail view. */
  export let showUploader = true;
  /** Accept attribute passed to <input type="file">. */
  export let accept = 'image/*';

  const dispatch = createEventDispatcher<{
    change:  { assets: PostAsset[] };
    reorder: { assets: PostAsset[] };
  }>();

  let fileInput: HTMLInputElement | null = null;
  let uploading = false;
  let lightboxUrl: string | null = null;

  function urlFor(a: PostAsset): string {
    return a.url ?? `/api/assets/preview?key=${encodeURIComponent(a.r2_key)}`;
  }
  function isVideo(a: PostAsset): boolean {
    const ct = (a.content_type ?? '').toLowerCase();
    if (ct.startsWith('video/')) return true;
    return /\.(mp4|mov|webm|avi)$/i.test(a.filename ?? a.r2_key ?? '');
  }

  async function onFileSelect(ev: Event) {
    const target = ev.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;
    if (!clientId) { toast.error('Select a client before uploading'); target.value = ''; return; }

    uploading = true;
    try {
      const list = Array.from(files);
      const res = await assetsApi.upload(list, clientId, postId ?? undefined);
      const added = (res.assets ?? []).map((a, i) => ({
        ...a,
        sort_order: value.length + i,
      }));
      value = [...value, ...added];
      dispatch('change', { assets: value });
      toast.success(`${added.length} file${added.length === 1 ? '' : 's'} uploaded`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      uploading = false;
      target.value = '';
    }
  }

  async function removeAsset(asset: PostAsset) {
    if (readonly) return;
    try {
      await assetsApi.delete(asset.id);
      value = value.filter(a => a.id !== asset.id).map((a, i) => ({ ...a, sort_order: i }));
      dispatch('change', { assets: value });
      toast.success('Image removed');
    } catch (err) {
      toast.error('Failed to remove');
    }
  }

  async function move(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= value.length) return;
    const next = value.slice();
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    value = next.map((a, i) => ({ ...a, sort_order: i }));
    dispatch('reorder', { assets: value });
    // Persist if we have a post_id
    if (postId) {
      try {
        await assetsApi.reorder(postId, value.map(a => a.id));
      } catch {
        toast.error('Failed to save new order');
      }
    }
  }
</script>

<div class="space-y-3">
  {#if value.length > 0}
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {#each value as asset, idx (asset.id)}
        <div class="relative group rounded-lg overflow-hidden bg-surface aspect-square border border-border/40">
          {#if isVideo(asset)}
            <video
              src={urlFor(asset)}
              class="w-full h-full object-cover bg-black"
              muted
              playsinline
              preload="metadata"
            />
          {:else}
            <button
              type="button"
              class="w-full h-full cursor-zoom-in focus:outline-none"
              on:click={() => lightboxUrl = urlFor(asset)}
            >
              <img
                src={urlFor(asset)}
                alt={asset.filename ?? `Image ${idx + 1}`}
                class="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          {/if}

          <!-- Order badge (always shown) -->
          <span class="absolute top-1 left-1 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded font-semibold">
            {idx + 1}{#if idx === 0} · primary{/if}
          </span>

          {#if !readonly}
            <div class="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                class="text-white bg-black/70 hover:bg-black/90 rounded w-6 h-6 flex items-center justify-center text-xs"
                disabled={idx === 0}
                title="Move up"
                on:click|stopPropagation={() => move(idx, -1)}
              >↑</button>
              <button
                type="button"
                class="text-white bg-black/70 hover:bg-black/90 rounded w-6 h-6 flex items-center justify-center text-xs"
                disabled={idx === value.length - 1}
                title="Move down"
                on:click|stopPropagation={() => move(idx, 1)}
              >↓</button>
              <button
                type="button"
                class="text-white bg-red-600/80 hover:bg-red-600 rounded w-6 h-6 flex items-center justify-center text-xs"
                title="Remove"
                on:click|stopPropagation={() => removeAsset(asset)}
              >✕</button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if !readonly && showUploader}
    <label
      class="block border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer
             hover:border-accent/60 hover:bg-accent/5 transition-colors"
    >
      <input
        bind:this={fileInput}
        type="file"
        {accept}
        multiple
        class="hidden"
        disabled={uploading || !clientId}
        on:change={onFileSelect}
      />
      {#if uploading}
        <div class="flex items-center justify-center gap-2 text-sm text-muted">
          <Spinner size="sm" /> Uploading…
        </div>
      {:else if !clientId}
        <p class="text-xs text-muted">Select a client first to enable uploads</p>
      {:else if value.length === 0}
        <p class="text-sm text-muted">Click to upload images (you can select multiple)</p>
      {:else}
        <p class="text-sm text-muted">+ Add more images</p>
      {/if}
    </label>
  {/if}
</div>

{#if lightboxUrl}
  <button
    type="button"
    class="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-zoom-out"
    on:click={() => (lightboxUrl = null)}
  >
    <img src={lightboxUrl} alt="Full-size preview" class="max-w-[95vw] max-h-[95vh] object-contain" />
  </button>
{/if}
