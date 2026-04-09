<script lang="ts">
  export let title  = 'Nothing here yet';
  export let detail = '';
  export let icon   = '◌';
</script>

<div class="flex flex-col items-center justify-center py-16 text-center">
  <div class="text-4xl mb-4 text-border">{icon}</div>
  <div class="text-sm font-medium text-white mb-1">{title}</div>
  {#if detail}
    <div class="text-xs text-muted max-w-xs">{detail}</div>
  {/if}
  {#if $$slots.action}
    <div class="mt-4"><slot name="action"/></div>
  {/if}
</div>
