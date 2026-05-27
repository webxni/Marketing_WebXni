<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  export let from = '';
  export let to = '';

  const dispatch = createEventDispatcher<{ change: { from: string; to: string } }>();

  let open = false;
  let pendingFrom = '';
  let pendingTo = '';
  let selectingEnd = false;
  let hoverDate = '';
  let activePreset = '';
  let container: HTMLDivElement;

  const today = new Date();
  const todayStr = ymd(today);
  let calYear = today.getFullYear();
  let calMonth = today.getMonth();

  function ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function monday(d: Date): Date {
    const dow = d.getDay();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (dow === 0 ? 6 : dow - 1));
  }

  const presets: Array<{ id: string; label: string; fn: () => { from: string; to: string } }> = [
    { id: 'today',      label: 'Today',
      fn: () => ({ from: todayStr, to: todayStr }) },
    { id: 'yesterday',  label: 'Yesterday',
      fn: () => { const s = ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)); return { from: s, to: s }; } },
    { id: 'this_week',  label: 'This week',
      fn: () => { const m = monday(today); return { from: ymd(m), to: ymd(new Date(m.getFullYear(), m.getMonth(), m.getDate() + 6)) }; } },
    { id: 'last7',      label: 'Last 7 days',
      fn: () => ({ from: ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)), to: todayStr }) },
    { id: 'last_week',  label: 'Last week',
      fn: () => { const m = monday(today); const pm = new Date(m.getFullYear(), m.getMonth(), m.getDate() - 7); return { from: ymd(pm), to: ymd(new Date(m.getFullYear(), m.getMonth(), m.getDate() - 1)) }; } },
    { id: 'last14',     label: 'Last 14 days',
      fn: () => ({ from: ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13)), to: todayStr }) },
    { id: 'this_month', label: 'This month',
      fn: () => ({ from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0)) }) },
    { id: 'last30',     label: 'Last 30 days',
      fn: () => ({ from: ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)), to: todayStr }) },
    { id: 'last_month', label: 'Last month',
      fn: () => ({ from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)) }) },
    { id: 'all',        label: 'All time',
      fn: () => ({ from: '', to: '' }) },
  ];

  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  $: calDays = (() => {
    const first = new Date(calYear, calMonth, 1);
    const count = new Date(calYear, calMonth + 1, 0).getDate();
    const pad = (first.getDay() + 6) % 7;
    const cells: (string | null)[] = Array(pad).fill(null);
    for (let d = 1; d <= count; d++) cells.push(ymd(new Date(calYear, calMonth, d)));
    return cells;
  })();

  $: monthLabel = new Date(calYear, calMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  $: triggerLabel = (() => {
    if (!from && !to) return 'All dates';
    const f = from, t = to || from;
    if (f === t) return fmtShort(f);
    if (f.slice(0, 7) === t.slice(0, 7)) {
      const [y, m] = f.split('-').map(Number);
      const mo = new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short' });
      return `${mo} ${+f.slice(8)} – ${+t.slice(8)}, ${y}`;
    }
    return `${fmtShort(f)} – ${fmtShort(t)}`;
  })();

  function fmtShort(s: string): string {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function cellCls(date: string): string {
    const ef = pendingFrom, et = pendingTo;
    if (ef && date === ef && date === et) return 'bg-accent text-white font-semibold rounded-full';
    if (ef && date === ef)               return 'bg-accent text-white font-semibold rounded-full';
    if (et && date === et)               return 'bg-accent text-white font-semibold rounded-full';
    if (ef && et && date > ef && date < et) return 'bg-accent/20 text-[#8ab4f8] rounded-none';
    if (ef && !et && selectingEnd && hoverDate && date > ef && date <= hoverDate)
                                         return 'bg-accent/10 text-[#8ab4f8] rounded-none';
    if (date === todayStr)               return 'text-[#8ab4f8] ring-1 ring-inset ring-accent/40 rounded-full';
    return 'text-muted hover:bg-white/5 hover:text-white rounded-full';
  }

  function clickDay(date: string) {
    if (!pendingFrom || (pendingFrom && pendingTo)) {
      pendingFrom = date; pendingTo = ''; selectingEnd = true;
    } else {
      if (date < pendingFrom) { pendingTo = pendingFrom; pendingFrom = date; }
      else pendingTo = date;
      selectingEnd = false;
      activePreset = '';
    }
  }

  function applyPreset(p: typeof presets[0]) {
    const r = p.fn();
    from = r.from; to = r.to;
    pendingFrom = from; pendingTo = to;
    activePreset = p.id;
    dispatch('change', { from, to });
    closePanel();
  }

  function applyPending() {
    let f = pendingFrom, t = pendingTo;
    if (f && t && f > t) { [f, t] = [t, f]; }
    from = f; to = t;
    dispatch('change', { from, to });
    closePanel();
  }

  function clearRange() {
    from = ''; to = '';
    pendingFrom = ''; pendingTo = '';
    activePreset = 'all';
    dispatch('change', { from: '', to: '' });
    closePanel();
  }

  function closePanel() {
    open = false; selectingEnd = false; hoverDate = '';
  }

  function toggle() {
    if (open) { pendingFrom = from; pendingTo = to; closePanel(); return; }
    pendingFrom = from; pendingTo = to;
    if (from) { const [y, m] = from.split('-').map(Number); calYear = y; calMonth = m - 1; }
    else { calYear = today.getFullYear(); calMonth = today.getMonth(); }
    open = true;
  }

  function onOutside(e: MouseEvent) {
    if (open && container && !container.contains(e.target as Node)) {
      pendingFrom = from; pendingTo = to; closePanel();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) { pendingFrom = from; pendingTo = to; closePanel(); }
  }

  onMount(() => {
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
  });
  onDestroy(() => {
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
  });
</script>

<div class="relative" bind:this={container}>
  <!-- Trigger button -->
  <button
    type="button"
    class="input text-sm w-full flex items-center gap-2 cursor-pointer select-none"
    on:click={toggle}
  >
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="text-muted shrink-0">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
    <span class="flex-1 text-left truncate {from || to ? 'text-white' : 'text-muted'}">{triggerLabel}</span>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
      class="text-muted shrink-0 transition-transform {open ? 'rotate-180' : ''}">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </button>

  <!-- Dropdown -->
  {#if open}
  <div
    class="absolute top-full mt-1 z-50 flex rounded-xl border border-border shadow-2xl overflow-hidden"
    style="background:#161b22; left:0; min-width:460px;"
  >
    <!-- Presets -->
    <div class="flex flex-col border-r border-border py-2 shrink-0" style="min-width:136px;">
      {#each presets as p}
        <button
          type="button"
          class="px-4 py-1.5 text-left text-xs transition-colors {activePreset === p.id
            ? 'bg-accent/15 text-[#8ab4f8] font-medium'
            : 'text-muted hover:bg-white/5 hover:text-white'}"
          on:click={() => applyPreset(p)}
        >{p.label}</button>
      {/each}
    </div>

    <!-- Calendar -->
    <div class="flex flex-col p-3 flex-1">
      <!-- Month nav -->
      <div class="flex items-center justify-between mb-2">
        <button type="button" class="p-1.5 rounded hover:bg-white/5 text-muted hover:text-white transition-colors"
          on:click={() => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="text-sm font-medium text-white">{monthLabel}</span>
        <button type="button" class="p-1.5 rounded hover:bg-white/5 text-muted hover:text-white transition-colors"
          on:click={() => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <!-- Day-of-week headers -->
      <div class="grid grid-cols-7 mb-0.5">
        {#each DAYS as d}
          <div class="text-center text-[10px] text-muted font-medium py-1">{d}</div>
        {/each}
      </div>

      <!-- Day grid -->
      <div class="grid grid-cols-7" on:mouseleave={() => (hoverDate = '')}>
        {#each calDays as cell}
          {#if cell === null}
            <div class="h-8"></div>
          {:else}
            <button
              type="button"
              class="h-8 w-full flex items-center justify-center text-xs transition-colors {cellCls(cell)}"
              on:click={() => clickDay(cell)}
              on:mouseenter={() => { if (selectingEnd) hoverDate = cell; }}
            >{+cell.slice(8)}</button>
          {/if}
        {/each}
      </div>

      <!-- Footer -->
      <div class="mt-3 pt-3 border-t border-border space-y-2">
        <div class="flex items-center gap-2">
          <input
            type="date"
            bind:value={pendingFrom}
            class="input text-xs flex-1"
            on:change={() => { activePreset = ''; if (pendingFrom && !pendingTo) selectingEnd = true; }}
          />
          <span class="text-muted text-xs shrink-0">–</span>
          <input
            type="date"
            bind:value={pendingTo}
            class="input text-xs flex-1"
            on:change={() => { activePreset = ''; selectingEnd = false; }}
          />
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn-ghost btn-sm text-xs flex-1" on:click={clearRange}>Clear</button>
          <button type="button" class="btn-primary btn-sm text-xs flex-1" on:click={applyPending}>Apply</button>
        </div>
      </div>
    </div>
  </div>
  {/if}
</div>
