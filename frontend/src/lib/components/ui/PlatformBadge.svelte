<script lang="ts">
  import { PLATFORM_META } from '$lib/types';
  export let platform: string;
  export let small = false;
  export let size: 'sm' | 'md' = 'md';  // 'sm' is alias for small=true

  $: meta   = PLATFORM_META[platform] ?? { label: platform, color: '#888' };
  $: isSmall = small || size === 'sm';
</script>

<span
  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium border"
  class:text-[10px]={isSmall}
  class:text-xs={!isSmall}
  style="border-color: {meta.color}22; background: {meta.color}18; color: {meta.color};"
>
  {meta.label}
</span>
