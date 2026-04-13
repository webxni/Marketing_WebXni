<script lang="ts">
  import { goto } from '$app/navigation';
  import { authApi, ApiError } from '$lib/api';
  import { userStore } from '$lib/stores/auth';

  let step: 'credentials' | '2fa' = 'credentials';

  let email      = '';
  let password   = '';
  let totpToken  = '';
  let code       = '';
  let error      = '';
  let loading    = false;

  async function submitCredentials() {
    if (!email || !password) { error = 'Email and password are required.'; return; }
    loading = true; error = '';
    try {
      const res = await authApi.login(email, password);
      if ('requires_2fa' in res && res.requires_2fa) {
        totpToken = res.totp_token;
        step = '2fa';
      } else if ('user' in res) {
        userStore.set(res.user);
        goto(res.user.role === 'client' ? '/portal' : '/dashboard');
      }
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Login failed. Please try again.';
    } finally {
      loading = false;
    }
  }

  async function submitCode() {
    if (!code || code.length !== 6) { error = 'Enter the 6-digit code from your authenticator app.'; return; }
    loading = true; error = '';
    try {
      const { user } = await authApi.verify2fa(totpToken, code);
      userStore.set(user);
      goto(user.role === 'client' ? '/portal' : '/dashboard');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Invalid code. Please try again.';
      code = '';
    } finally {
      loading = false;
    }
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter') step === '2fa' ? submitCode() : submitCredentials();
  }
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
      <p class="text-sm text-muted mt-1">
        {step === '2fa' ? 'Two-factor authentication' : 'Sign in to your account'}
      </p>
    </div>

    <!-- Card -->
    <div class="card p-6">
      {#if step === 'credentials'}
        <form on:submit|preventDefault={submitCredentials} class="space-y-4">
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
      {:else}
        <div class="space-y-4">
          <p class="text-xs text-muted">
            Open your authenticator app and enter the 6-digit code for <strong class="text-white">{email}</strong>.
          </p>

          <div>
            <label for="code" class="block text-xs font-medium text-muted mb-1.5">Authentication code</label>
            <input
              id="code"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="6"
              bind:value={code}
              on:keydown={keydown}
              placeholder="000000"
              class="input w-full text-center text-lg tracking-widest font-mono"
              autocomplete="one-time-code"
            />
          </div>

          {#if error}
            <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {error}
            </div>
          {/if}

          <button class="btn-primary w-full justify-center py-2.5" on:click={submitCode} disabled={loading}>
            {#if loading}
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            {:else}
              Verify
            {/if}
          </button>

          <button
            class="text-xs text-muted hover:text-white w-full text-center"
            on:click={() => { step = 'credentials'; error = ''; code = ''; }}
          >
            ← Back to sign in
          </button>
        </div>
      {/if}
    </div>

    <p class="text-center text-xs text-muted mt-6">
      WebXni Marketing Platform v2.0
    </p>
  </div>
</div>
