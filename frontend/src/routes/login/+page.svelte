<script lang="ts">
  import { goto } from '$app/navigation';
  import { authApi, ApiError } from '$lib/api';
  import { userStore } from '$lib/stores/auth';

  let email    = '';
  let password = '';
  let error    = '';
  let loading  = false;

  async function submit() {
    if (!email || !password) { error = 'Email and password are required.'; return; }
    loading = true;
    error   = '';
    try {
      const { user } = await authApi.login(email, password);
      userStore.set(user);
      goto('/dashboard');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Login failed. Please try again.';
    } finally {
      loading = false;
    }
  }

  function keydown(e: KeyboardEvent) { if (e.key === 'Enter') submit(); }
</script>

<svelte:head><title>Sign in — WebXni Marketing</title></svelte:head>

<div class="min-h-screen bg-bg flex flex-col items-center justify-center p-4">
  <div class="w-full max-w-sm">
    <!-- Logo -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent/10 mb-4">
        <span class="text-accent text-xl font-bold">W</span>
      </div>
      <h1 class="text-xl font-semibold text-white">WebXni Marketing</h1>
      <p class="text-sm text-muted mt-1">Sign in to your account</p>
    </div>

    <!-- Card -->
    <div class="card p-6">
      <form on:submit|preventDefault={submit} class="space-y-4">
        <div>
          <label for="email" class="block text-xs font-medium text-muted mb-1.5">Email</label>
          <input
            id="email"
            type="email"
            bind:value={email}
            on:keydown={keydown}
            placeholder="you@example.com"
            class="input w-full"
            autocomplete="email"
            required
          />
        </div>

        <div>
          <label for="password" class="block text-xs font-medium text-muted mb-1.5">Password</label>
          <input
            id="password"
            type="password"
            bind:value={password}
            on:keydown={keydown}
            placeholder="••••••••"
            class="input w-full"
            autocomplete="current-password"
            required
          />
        </div>

        {#if error}
          <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
            {error}
          </div>
        {/if}

        <button type="submit" class="btn-primary w-full justify-center py-2.5" disabled={loading}>
          {#if loading}
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          {:else}
            Sign in
          {/if}
        </button>
      </form>
    </div>

    <p class="text-center text-xs text-muted mt-6">
      WebXni Marketing Platform v2.0
    </p>
  </div>
</div>
