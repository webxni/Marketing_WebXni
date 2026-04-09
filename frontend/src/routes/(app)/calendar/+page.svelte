<script lang="ts">
  import { onMount } from 'svelte';
  import { postsApi, clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { currentMonth, lastNMonths } from '$lib/utils';
  import type { Post, Client } from '$lib/types';

  let posts: Post[] = [];
  let clients: Client[] = [];
  let loading = true;
  let selectedMonth = currentMonth();
  let selectedClient = '';

  const months = lastNMonths(6);

  // Calendar grid
  $: calendarData = buildCalendar(selectedMonth, posts);

  function buildCalendar(month: string, allPosts: Post[]) {
    const [y, m] = month.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay  = new Date(y, m, 0);
    const startDow = firstDay.getDay(); // 0=Sun

    const days: { date: number; iso: string; posts: Post[]; today: boolean }[] = [];

    // Leading empty cells
    for (let i = 0; i < startDow; i++) days.push({ date: 0, iso: '', posts: [], today: false });

    const todayStr = new Date().toISOString().slice(0, 10);

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const iso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayPosts = allPosts.filter(p => p.publish_date?.slice(0, 10) === iso);
      days.push({ date: d, iso, posts: dayPosts, today: iso === todayStr });
    }

    return days;
  }

  async function load() {
    loading = true;
    try {
      const [y, mo] = selectedMonth.split('-');
      const params: Record<string, string> = {
        from: `${selectedMonth}-01`,
        to:   `${selectedMonth}-31`,
        limit: '200',
      };
      if (selectedClient) params.client = selectedClient;
      const r = await postsApi.list(params);
      posts = r.posts;
    } finally { loading = false; }
  }

  onMount(async () => {
    const r = await clientsApi.list('active');
    clients = r.clients;
    load();
  });

  $: selectedMonth, selectedClient, load();

  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const statusDot: Record<string, string> = {
    draft: 'bg-gray-500', approved: 'bg-blue-500', ready: 'bg-cyan-500',
    scheduled: 'bg-yellow-400', posted: 'bg-green-500', failed: 'bg-red-500',
  };
</script>

<svelte:head><title>Calendar — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Content Calendar</h1>
    <p class="page-subtitle">Scheduled posts by date</p>
  </div>
  <div class="flex items-center gap-3">
    <select bind:value={selectedClient} class="input text-sm w-44">
      <option value="">All clients</option>
      {#each clients as c}
        <option value={c.slug}>{c.canonical_name}</option>
      {/each}
    </select>
    <select bind:value={selectedMonth} class="input text-sm w-36">
      {#each months as m}
        <option value={m.value}>{m.label}</option>
      {/each}
    </select>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else}
  <!-- Legend -->
  <div class="flex flex-wrap gap-4 mb-4 text-xs text-muted">
    {#each Object.entries(statusDot) as [status, cls]}
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full {cls}"></span>
        <span class="capitalize">{status}</span>
      </div>
    {/each}
  </div>

  <!-- Grid -->
  <div class="card overflow-hidden">
    <!-- Day headers -->
    <div class="grid grid-cols-7 border-b border-border">
      {#each dayNames as d}
        <div class="px-2 py-2 text-center text-xs font-medium text-muted">{d}</div>
      {/each}
    </div>

    <!-- Days -->
    <div class="grid grid-cols-7">
      {#each calendarData as cell, i}
        <div
          class="min-h-[100px] p-2 border-b border-r border-border
            {cell.today ? 'bg-accent/5' : ''}
            {cell.date === 0 ? 'bg-surface' : ''}"
          class:border-accent={cell.today}
        >
          {#if cell.date > 0}
            <div class="text-xs font-medium mb-1
              {cell.today ? 'text-accent' : 'text-muted'}
            ">{cell.date}</div>
            <div class="space-y-1">
              {#each cell.posts.slice(0, 3) as post}
                <a
                  href="/posts/{post.id}"
                  class="flex items-center gap-1 text-[10px] leading-tight hover:text-accent truncate"
                  title="{post.title ?? '(untitled)'} · {post.client_name ?? ''}"
                >
                  <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 {statusDot[post.status ?? 'draft'] ?? 'bg-gray-500'}"></span>
                  <span class="text-muted truncate">{post.title ?? '(untitled)'}</span>
                </a>
              {/each}
              {#if cell.posts.length > 3}
                <div class="text-[10px] text-muted">+{cell.posts.length - 3} more</div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- Month total -->
  <div class="mt-4 text-xs text-muted text-right">{posts.length} posts scheduled this month</div>
{/if}
