<script lang="ts">
  import { sidebarOpen, toast } from '$lib/stores/ui';
  import { userStore } from '$lib/stores/auth';
  import { authApi } from '$lib/api';
  import { goto } from '$app/navigation';

  export let title = '';

  let menuOpen = false;

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      userStore.clear();
      goto('/login');
    }
  }

  $: initials = ($userStore?.name ?? '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
</script>

<header class="h-14 border-b border-border bg-surface flex items-center justify-between px-4 shrink-0 gap-4">
  <div class="flex items-center gap-3 min-w-0">
    <button class="btn-icon shrink-0" on:click={() => sidebarOpen.update((v) => !v)} aria-label="Toggle sidebar">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect y="2" width="16" height="1.5" rx="1"/>
        <rect y="7.25" width="16" height="1.5" rx="1"/>
        <rect y="12.5" width="16" height="1.5" rx="1"/>
      </svg>
    </button>
    {#if title}
      <h1 class="text-sm font-medium text-white truncate">{title}</h1>
    {/if}
  </div>

  <div class="flex items-center gap-2 relative shrink-0">
    <!-- User menu -->
    <button
      class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-card transition-colors"
      on:click={() => (menuOpen = !menuOpen)}
    >
      <!-- Avatar -->
      <div class="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold shrink-0 ring-1 ring-inset ring-accent/30">
        {initials}
      </div>
      <div class="hidden sm:block text-left">
        <div class="text-xs font-medium text-white leading-tight">{$userStore?.name ?? ''}</div>
        <div class="text-[10px] text-muted capitalize leading-tight">{$userStore?.role ?? ''}</div>
      </div>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="text-muted hidden sm:block">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>

    {#if menuOpen}
    <!-- Backdrop -->
    <button class="fixed inset-0 z-10" on:click={() => (menuOpen = false)} aria-label="Close menu" />
    <!-- Dropdown -->
    <div class="absolute right-0 top-11 z-20 w-48 bg-card border border-border rounded-xl shadow-2xl py-1.5 overflow-hidden">
      <div class="px-3 py-2 border-b border-border mb-1">
        <div class="text-xs font-medium text-white">{$userStore?.name ?? ''}</div>
        <div class="text-[11px] text-muted capitalize">{$userStore?.role ?? ''}</div>
      </div>
      <a href="/settings" class="flex items-center gap-2.5 px-3 py-2 text-sm text-muted hover:text-white hover:bg-surface transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
        Settings
      </a>
      <div class="border-t border-border my-1" />
      <button
        on:click={logout}
        class="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-surface transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
        </svg>
        Sign out
      </button>
    </div>
    {/if}
  </div>
</header>
