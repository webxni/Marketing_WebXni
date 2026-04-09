<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { userStore } from '$lib/stores/auth';
  import { authApi } from '$lib/api';
  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import TopBar from '$lib/components/layout/TopBar.svelte';

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
    ready = true;
  });
</script>

{#if ready}
  <div class="flex h-screen overflow-hidden">
    <Sidebar />
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <TopBar />
      <main class="flex-1 overflow-y-auto bg-bg p-6">
        <slot />
      </main>
    </div>
  </div>
{:else}
  <div class="flex h-screen items-center justify-center bg-bg">
    <div class="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
  </div>
{/if}
