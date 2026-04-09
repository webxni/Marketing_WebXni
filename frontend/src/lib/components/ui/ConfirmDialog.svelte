<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Modal from './Modal.svelte';

  export let open         = false;
  export let title        = 'Are you sure?';
  export let message      = '';
  export let confirmLabel = 'Confirm';
  export let confirmClass = '';   // overrides danger default; e.g. 'btn-danger'
  export let danger       = false;

  const dispatch = createEventDispatcher<{ confirm: void; cancel: void }>();

  $: btnClass = confirmClass || (danger ? 'btn-danger' : 'btn-primary');
</script>

<Modal bind:open {title} width="max-w-sm">
  <p class="text-sm text-muted" slot="body">{message}</p>
  <svelte:fragment slot="footer">
    <button class="btn-secondary btn-sm" on:click={() => { open = false; dispatch('cancel'); }}>Cancel</button>
    <button
      class="{btnClass} btn-sm"
      on:click={() => { open = false; dispatch('confirm'); }}
    >{confirmLabel}</button>
  </svelte:fragment>
</Modal>
