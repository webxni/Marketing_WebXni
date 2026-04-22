<script lang="ts">
  export let title  = 'Nothing here yet';
  export let detail = '';
  export let icon   = '◌';
</script>

<div class="flex flex-col items-center justify-center py-20 text-center px-6">
  <!-- Icon container with a subtle glow ring -->
  <div class="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center mb-5 text-xl text-muted shadow-inner">
    {icon}
  </div>
  <div class="text-sm font-semibold text-white mb-2">{title}</div>
  {#if detail}
    <div class="text-sm text-muted max-w-sm leading-relaxed">{detail}</div>
  {/if}
  {#if $$slots.action}
    <div class="mt-5"><slot name="action"/></div>
  {/if}
</div>
