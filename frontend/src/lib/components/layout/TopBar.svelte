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
</script>

<header class="h-14 border-b border-border bg-surface flex items-center justify-between px-4 shrink-0">
  <div class="flex items-center gap-3">
    <button class="btn-icon" on:click={() => sidebarOpen.update((v) => !v)} aria-label="Toggle sidebar">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect y="2" width="16" height="1.5" rx="1"/>
        <rect y="7.25" width="16" height="1.5" rx="1"/>
        <rect y="12.5" width="16" height="1.5" rx="1"/>
      </svg>
    </button>
    {#if title}
      <h1 class="text-sm font-medium text-white">{title}</h1>
    {/if}
  </div>

  <div class="flex items-center gap-2 relative">
    <!-- User menu -->
    <button
      class="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-card transition-colors"
      on:click={() => (menuOpen = !menuOpen)}
    >
      <div class="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-semibold">
        {($userStore?.name?.[0] ?? '?').toUpperCase()}
      </div>
      <span class="text-sm text-white">{$userStore?.name ?? ''}</span>
      <span class="text-xs text-muted capitalize">{$userStore?.role ?? ''}</span>
    </button>

    {#if menuOpen}
    <!-- Backdrop -->
    <button class="fixed inset-0 z-10" on:click={() => (menuOpen = false)} aria-label="Close menu" />
    <!-- Dropdown -->
    <div class="absolute right-0 top-10 z-20 w-44 bg-card border border-border rounded-lg shadow-xl py-1">
      <a href="/settings" class="flex items-center gap-2 px-4 py-2 text-sm text-muted hover:text-white hover:bg-surface">
        Settings
      </a>
      <div class="border-t border-border my-1" />
      <button
        on:click={logout}
        class="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-surface"
      >
        Sign out
      </button>
    </div>
    {/if}
  </div>
</header>
