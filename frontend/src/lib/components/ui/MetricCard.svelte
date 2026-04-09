<script lang="ts">
  export let label:    string;
  export let value:    string | number;
  export let subtext:  string = '';
  export let color:    'default' | 'success' | 'warning' | 'error' | 'info' = 'default';
  export let href:     string = '';

  const colorMap = {
    default: 'text-white',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error:   'text-red-400',
    info:    'text-blue-400',
  };
</script>

{#if href}
  <a {href} class="metric-card hover:border-accent/30 cursor-pointer transition-colors block">
    <div class="metric-label">{label}</div>
    <div class="metric-value mt-2 {colorMap[color]}">{value}</div>
    {#if subtext}<div class="text-xs text-muted mt-1">{subtext}</div>{/if}
  </a>
{:else}
  <div class="metric-card">
    <div class="metric-label">{label}</div>
    <div class="metric-value mt-2 {colorMap[color]}">{value}</div>
    {#if subtext}<div class="text-xs text-muted mt-1">{subtext}</div>{/if}
  </div>
{/if}
