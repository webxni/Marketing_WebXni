<script lang="ts">
  import { toasts, removeToast } from '$lib/stores/ui';

  const icons: Record<string, string> = {
    success: '✓',
    error:   '✕',
    info:    'ℹ',
    warning: '⚠',
  };
  const colors: Record<string, string> = {
    success: 'border-green-500/30 bg-green-500/10 text-green-400',
    error:   'border-red-500/30   bg-red-500/10   text-red-400',
    info:    'border-blue-500/30  bg-blue-500/10  text-blue-400',
    warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400',
  };
</script>

<div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
  {#each $toasts as t (t.id)}
    <div
      class="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg border
             max-w-sm text-sm shadow-xl animate-slide-in {colors[t.type]}"
    >
      <span class="font-bold mt-0.5">{icons[t.type]}</span>
      <span class="flex-1 text-white">{t.message}</span>
      <button on:click={() => removeToast(t.id)} class="opacity-60 hover:opacity-100 mt-0.5">✕</button>
    </div>
  {/each}
</div>

<style>
  @keyframes slide-in {
    from { opacity: 0; transform: translateX(1rem); }
    to   { opacity: 1; transform: translateX(0); }
  }
  .animate-slide-in { animation: slide-in 0.2s ease-out; }
</style>
