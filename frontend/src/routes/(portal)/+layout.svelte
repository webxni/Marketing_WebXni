<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { userStore } from '$lib/stores/auth';
  import { authApi } from '$lib/api';

  let ready = false;

  onMount(async () => {
    if (!$userStore) {
      try {
        const { user } = await authApi.me();
        userStore.set(user);
      } catch {
        goto('/login');
        return;
      }
    }
    // Non-client roles don't belong here — redirect to the main app
    if ($userStore && $userStore.role !== 'client') {
      goto('/dashboard');
      return;
    }
    ready = true;
  });

  async function logout() {
    await authApi.logout();
    userStore.clear();
    goto('/login');
  }

  $: pathname = $page.url.pathname;
</script>

{#if ready}
  <div class="min-h-screen bg-bg flex flex-col">
    <!-- Top bar -->
    <header class="h-14 bg-surface border-b border-border flex items-center justify-between px-6 shrink-0">
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-md bg-accent flex items-center justify-center text-white text-xs font-bold">W</div>
        <span class="font-semibold text-white text-sm">WebXni Portal</span>
      </div>

      <nav class="flex items-center gap-1">
        <a
          href="/portal"
          class="px-3 py-1.5 rounded-md text-sm transition-colors
                 {pathname === '/portal' ? 'bg-accent/10 text-accent font-medium' : 'text-muted hover:text-white hover:bg-card'}"
        >Overview</a>
        <a
          href="/portal/posts"
          class="px-3 py-1.5 rounded-md text-sm transition-colors
                 {pathname.startsWith('/portal/posts') ? 'bg-accent/10 text-accent font-medium' : 'text-muted hover:text-white hover:bg-card'}"
        >Posts</a>
        <a
          href="/portal/report"
          class="px-3 py-1.5 rounded-md text-sm transition-colors
                 {pathname.startsWith('/portal/report') ? 'bg-accent/10 text-accent font-medium' : 'text-muted hover:text-white hover:bg-card'}"
        >Report</a>
      </nav>

      <div class="flex items-center gap-3">
        <span class="text-xs text-muted">{$userStore?.name ?? ''}</span>
        <button class="btn-ghost btn-sm text-xs" on:click={logout}>Sign out</button>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto p-6">
      <slot />
    </main>
  </div>
{:else}
  <div class="flex h-screen items-center justify-center bg-bg">
    <div class="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
  </div>
{/if}
