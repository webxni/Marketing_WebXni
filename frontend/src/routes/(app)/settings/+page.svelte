<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { userStore } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { can, hasRole } from '$lib/stores/auth';
  import Spinner from '$lib/components/ui/Spinner.svelte';

  let loading = true;
  let savingProfile = false;
  let savingPassword = false;

  // Profile fields
  let name = '';
  let email = '';

  // Password fields
  let currentPassword = '';
  let newPassword = '';
  let confirmPassword = '';

  // System settings (admin only)
  let systemSettings: Record<string, string> = {};
  let savingSystem = false;

  onMount(async () => {
    // Pre-fill from store
    const u = $userStore;
    if (u) { name = u.name; email = u.email; }
    if (hasRole('admin')) {
      try {
        const r = await api.get<{ settings: Record<string, string> }>('/api/settings');
        systemSettings = r.settings ?? {};
      } catch {}
    }
    loading = false;
  });

  async function saveProfile() {
    if (!name.trim()) { toast.error('Name is required'); return; }
    savingProfile = true;
    try {
      await api.put('/api/auth/profile', { name });
      userStore.update(u => u ? { ...u, name } : u);
      toast.success('Profile updated');
    } catch (e) { toast.error(String(e)); }
    finally { savingProfile = false; }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword) { toast.error('All password fields required'); return; }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
    if (newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    savingPassword = true;
    try {
      await api.post('/api/auth/change-password', { current_password: currentPassword, new_password: newPassword });
      toast.success('Password changed');
      currentPassword = ''; newPassword = ''; confirmPassword = '';
    } catch (e) { toast.error(String(e)); }
    finally { savingPassword = false; }
  }

  async function saveSystem() {
    savingSystem = true;
    try {
      await api.put('/api/settings', { settings: systemSettings });
      toast.success('Settings saved');
    } catch (e) { toast.error(String(e)); }
    finally { savingSystem = false; }
  }
</script>

<svelte:head><title>Settings — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Settings</h1>
    <p class="page-subtitle">Account and system configuration</p>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else}
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

  <!-- Profile -->
  <div class="card p-5">
    <h3 class="section-label mb-4">Profile</h3>
    <div class="space-y-4">
      <div>
        <label for="name" class="block text-xs text-muted mb-1.5">Full Name</label>
        <input id="name" type="text" bind:value={name} class="input w-full" />
      </div>
      <div>
        <label for="email" class="block text-xs text-muted mb-1.5">Email</label>
        <input id="email" type="email" value={email} class="input w-full opacity-50 cursor-not-allowed" readonly />
        <p class="text-xs text-muted mt-1">Email cannot be changed. Contact an admin.</p>
      </div>
      <div class="flex justify-end">
        <button class="btn-primary btn-sm" on:click={saveProfile} disabled={savingProfile}>
          {savingProfile ? 'Saving…' : 'Save Profile'}
        </button>
      </div>
    </div>
  </div>

  <!-- Password -->
  <div class="card p-5">
    <h3 class="section-label mb-4">Change Password</h3>
    <div class="space-y-4">
      <div>
        <label for="currentPassword" class="block text-xs text-muted mb-1.5">Current Password</label>
        <input id="currentPassword" type="password" bind:value={currentPassword} class="input w-full" autocomplete="current-password" />
      </div>
      <div>
        <label for="newPassword" class="block text-xs text-muted mb-1.5">New Password</label>
        <input id="newPassword" type="password" bind:value={newPassword} class="input w-full" autocomplete="new-password" />
      </div>
      <div>
        <label for="confirmPassword" class="block text-xs text-muted mb-1.5">Confirm New Password</label>
        <input id="confirmPassword" type="password" bind:value={confirmPassword} class="input w-full" autocomplete="new-password" />
      </div>
      <div class="flex justify-end">
        <button class="btn-primary btn-sm" on:click={changePassword} disabled={savingPassword}>
          {savingPassword ? 'Changing…' : 'Change Password'}
        </button>
      </div>
    </div>
  </div>

  <!-- Session info -->
  <div class="card p-5">
    <h3 class="section-label mb-4">Current Session</h3>
    <dl class="space-y-3">
      <div class="flex justify-between">
        <dt class="text-xs text-muted">Name</dt>
        <dd class="text-xs text-white">{$userStore?.name ?? '—'}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-xs text-muted">Email</dt>
        <dd class="text-xs text-white">{$userStore?.email ?? '—'}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-xs text-muted">Role</dt>
        <dd class="text-xs text-white capitalize">{$userStore?.role ?? '—'}</dd>
      </div>
    </dl>
  </div>

  <!-- System settings (admin only) -->
  {#if hasRole('admin')}
  <div class="card p-5">
    <h3 class="section-label mb-4">System Settings</h3>
    <div class="space-y-3">
      {#each Object.entries(systemSettings) as [key, value]}
        <div>
          <label class="block text-xs text-muted mb-1 font-mono">{key}</label>
          <input
            type="text"
            bind:value={systemSettings[key]}
            class="input w-full text-xs font-mono"
          />
        </div>
      {/each}
      {#if Object.keys(systemSettings).length === 0}
        <p class="text-xs text-muted">No system settings configured.</p>
      {:else}
        <div class="flex justify-end">
          <button class="btn-primary btn-sm" on:click={saveSystem} disabled={savingSystem}>
            {savingSystem ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      {/if}
    </div>
  </div>
  {/if}

</div>
{/if}
