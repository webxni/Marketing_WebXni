<script lang="ts">
  import { statusClass } from '$lib/utils';
  export let status: string | null | undefined = undefined;
  export let cls: string = '';
  $: computed = status ? statusClass(status) : cls;
  $: label = status ?? '';
</script>

<span class={computed || 'badge-draft'}>
  {#if $$slots.default}<slot />{:else}{label}{/if}
</span>
