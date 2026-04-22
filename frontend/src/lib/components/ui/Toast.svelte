<script lang="ts">
  import { toasts, removeToast } from '$lib/stores/ui';

  // SVG icon paths for each type
  const icons: Record<string, string> = {
    success: 'M20 6L9 17l-5-5',        // checkmark
    error:   'M18 6L6 18M6 6l12 12',   // X
    info:    'M12 16v-4M12 8h.01',     // i
    warning: 'M12 9v4M12 17h.01',      // !
  };

  const colors: Record<string, string> = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    error:   'border-red-500/30     bg-red-500/10     text-red-400',
    info:    'border-sky-500/30     bg-sky-500/10     text-sky-400',
    warning: 'border-amber-500/30   bg-amber-500/10   text-amber-400',
  };
</script>

<div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none" style="max-width: min(380px, calc(100vw - 2rem))">
  {#each $toasts as t (t.id)}
    <div
      class="pointer-events-auto flex items-start gap-3 pl-3 pr-3 py-3 rounded-xl border
             text-sm shadow-2xl animate-slide-in w-full {colors[t.type]}"
    >
      <!-- Icon circle -->
      <div class="shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d={icons[t.type]} />
          {#if t.type === 'warning' || t.type === 'info'}
            <circle cx="12" cy="12" r="10"/>
          {/if}
        </svg>
      </div>
      <span class="flex-1 text-white text-sm leading-relaxed">{t.message}</span>
      <button
        on:click={() => removeToast(t.id)}
        class="opacity-50 hover:opacity-100 transition-opacity mt-0.5 shrink-0"
        aria-label="Dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  {/each}
</div>

<style>
  @keyframes slide-in {
    from { opacity: 0; transform: translateX(1rem) scale(0.97); }
    to   { opacity: 1; transform: translateX(0) scale(1); }
  }
  .animate-slide-in { animation: slide-in 0.2s ease-out; }
</style>
