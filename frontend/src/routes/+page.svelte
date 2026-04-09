<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { userStore } from '$lib/stores/auth';
  import { authApi } from '$lib/api';

  onMount(async () => {
    try {
      const { user } = await authApi.me();
      userStore.set(user);
      goto('/dashboard');
    } catch {
      goto('/login');
    }
  });
</script>

<div class="flex items-center justify-center h-screen bg-bg">
  <div class="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
</div>
