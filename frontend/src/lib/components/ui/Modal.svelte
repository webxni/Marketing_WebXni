<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let open  = false;
  export let title = '';
  export let width = 'max-w-lg';

  const dispatch = createEventDispatcher();
  function close() { open = false; dispatch('close'); }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={keydown} />

{#if open}
<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  <!-- Backdrop -->
  <button class="absolute inset-0 bg-black/60 backdrop-blur-sm" on:click={close} aria-label="Close" />

  <!-- Dialog -->
  <div class="relative {width} w-full bg-card border border-border rounded-xl shadow-2xl">
    <!-- Header -->
    {#if title}
    <div class="flex items-center justify-between px-5 py-4 border-b border-border">
      <h2 class="font-semibold text-white">{title}</h2>
      <button on:click={close} class="btn-icon text-muted hover:text-white">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    {/if}

    <!-- Body — supports both default slot and named "body" slot -->
    <div class="p-5">
      <slot name="body" />
      <slot />
    </div>

    <!-- Footer -->
    {#if $$slots.footer}
    <div class="px-5 py-4 border-t border-border flex justify-end gap-3">
      <slot name="footer" />
    </div>
    {/if}
  </div>
</div>
{/if}
