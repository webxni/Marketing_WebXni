<script lang="ts">
  export let label:    string;
  export let value:    string | number;
  export let subtext:  string = '';
  export let color:    'default' | 'success' | 'warning' | 'error' | 'info' = 'default';
  export let href:     string = '';

  const colorMap = {
    default: 'text-white',
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    error:   'text-red-400',
    info:    'text-sky-400',
  };
</script>

{#if href}
  <a {href} class="metric-card hover:border-white/15 cursor-pointer transition-colors block group">
    <div class="metric-label mb-2">{label}</div>
    <div class="metric-value {colorMap[color]}">{value}</div>
    {#if subtext}<div class="text-[11px] text-muted mt-1.5">{subtext}</div>{/if}
    <div class="mt-2 text-[10px] text-muted/50 group-hover:text-accent/60 transition-colors">View →</div>
  </a>
{:else}
  <div class="metric-card">
    <div class="metric-label mb-2">{label}</div>
    <div class="metric-value {colorMap[color]}">{value}</div>
    {#if subtext}<div class="text-[11px] text-muted mt-1.5">{subtext}</div>{/if}
  </div>
{/if}
