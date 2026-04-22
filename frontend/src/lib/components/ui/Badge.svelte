<script lang="ts">
  import { statusClass } from '$lib/utils';

  export let status: string | null | undefined = undefined;
  export let cls: string = '';

  $: computed = status ? statusClass(status) : cls;

  // Humanize raw status strings — e.g. "pending_approval" → "Pending Review"
  const LABELS: Record<string, string> = {
    draft:            'Draft',
    pending_approval: 'Pending Review',
    approved:         'Approved',
    ready:            'Ready',
    scheduled:        'Scheduled',
    posted:           'Posted',
    failed:           'Failed',
    blocked:          'Blocked',
    cancelled:        'Cancelled',
    running:          'Running',
    completed:        'Completed',
    pending:          'Pending',
    sent:             'Sent',
    active:           'Active',
    inactive:         'Inactive',
    ok:               'OK',
    skipped:          'Skipped',
    idempotent:       'Sent',
  };

  $: label = status ? (LABELS[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : '';
</script>

<span class={computed || 'badge-draft'}>
  {#if $$slots.default}<slot />{:else}{label}{/if}
</span>
