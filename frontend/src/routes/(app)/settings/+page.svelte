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

  // System settings raw store (admin only)
  let systemSettings: Record<string, string> = {};

  // ── Automation / Cron ─────────────────────────────────────────────────────
  let cronEnabled = true;
  let savingCron = false;

  // ── AI Provider ───────────────────────────────────────────────────────────
  let aiProvider = 'openai';
  let aiModel = '';
  let aiApiKey = '';
  let aiOpenAiKey = '';
  let aiAnthropicKey = '';
  let aiBaseUrl = '';
  let savingAi = false;

  const aiProviders = [
    { value: 'openai',    label: 'OpenAI (GPT)' },
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'google',    label: 'Google (Gemini)' },
    { value: 'custom',    label: 'Custom / Ollama' },
  ];

  const aiModelPlaceholders: Record<string, string> = {
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-5',
    google:    'gemini-1.5-pro',
    custom:    'llama3',
  };

  onMount(async () => {
    const u = $userStore;
    if (u) { name = u.name; email = u.email; }
    if (hasRole('admin')) {
      try {
        const r = await api.get<{ settings: Record<string, string> }>('/api/settings');
        systemSettings = r.settings ?? {};
        // Parse structured fields from flat KV
        cronEnabled  = systemSettings['cron_enabled']  !== 'false';
        aiProvider   = systemSettings['ai_provider']   ?? 'openai';
        aiModel      = systemSettings['ai_model']      ?? '';
        aiOpenAiKey  = systemSettings['ai_openai_api_key']    ?? (systemSettings['ai_provider'] === 'openai' ? systemSettings['ai_api_key'] ?? '' : '');
        aiAnthropicKey = systemSettings['ai_anthropic_api_key'] ?? (systemSettings['ai_provider'] === 'anthropic' ? systemSettings['ai_api_key'] ?? '' : '');
        syncAiKeyForProvider();
        aiBaseUrl    = systemSettings['ai_base_url']   ?? '';
      } catch {}
    }
    loading = false;
  });

  function syncAiKeyForProvider() {
    if (aiProvider === 'anthropic') aiApiKey = aiAnthropicKey;
    else if (aiProvider === 'openai') aiApiKey = aiOpenAiKey;
  }

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

  async function saveCron() {
    savingCron = true;
    try {
      const updated = {
        ...systemSettings,
        cron_enabled: cronEnabled ? 'true' : 'false',
      };
      await api.put('/api/settings', { settings: updated });
      systemSettings = updated;
      toast.success('Automation setting saved');
    } catch (e) { toast.error(String(e)); }
    finally { savingCron = false; }
  }


  async function saveAi() {
    if (!aiApiKey.trim() && aiProvider !== 'custom') {
      toast.error('API key is required');
      return;
    }
    savingAi = true;
    try {
      if (aiProvider === 'openai') aiOpenAiKey = aiApiKey;
      if (aiProvider === 'anthropic') aiAnthropicKey = aiApiKey;
      const updated = {
        ...systemSettings,
        ai_provider: aiProvider,
        ai_model:    aiModel.trim(),
        ai_api_key:  aiApiKey.trim(),
        ai_openai_api_key: aiOpenAiKey.trim(),
        ai_anthropic_api_key: aiAnthropicKey.trim(),
        ai_base_url: aiBaseUrl.trim(),
      };
      await api.put('/api/settings', { settings: updated });
      systemSettings = updated;
      toast.success('AI config saved');
    } catch (e) { toast.error(String(e)); }
    finally { savingAi = false; }
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
        <label for="profile_name" class="block text-xs text-muted mb-1.5">Full Name</label>
        <input id="profile_name" type="text" bind:value={name} class="input w-full" />
      </div>
      <div>
        <label for="profile_email" class="block text-xs text-muted mb-1.5">Email</label>
        <input id="profile_email" type="email" value={email} class="input w-full opacity-50 cursor-not-allowed" readonly />
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

  {#if hasRole('admin')}

  <!-- Automation -->
  <div class="card p-5">
    <h3 class="section-label mb-4">Automation</h3>
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <input type="checkbox" id="cron_enabled" bind:checked={cronEnabled} class="rounded" />
        <label for="cron_enabled" class="text-xs text-muted cursor-pointer">Enable automated posting</label>
      </div>
      <p class="text-xs text-muted">
        When enabled, posts are sent automatically at their exact scheduled time (checked every minute).
        Disable this to pause all automated posting without affecting content.
      </p>
      <div class="flex justify-end">
        <button class="btn-primary btn-sm" on:click={saveCron} disabled={savingCron}>
          {savingCron ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </div>

  <!-- AI Provider -->
  <div class="card p-5 lg:col-span-2">
    <h3 class="section-label mb-4">AI Provider</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label for="ai_provider" class="block text-xs text-muted mb-1.5">Provider</label>
        <select id="ai_provider" bind:value={aiProvider} class="input w-full" on:change={syncAiKeyForProvider}>
          {#each aiProviders as p}
            <option value={p.value}>{p.label}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="ai_model" class="block text-xs text-muted mb-1.5">Model</label>
        <input
          id="ai_model"
          type="text"
          bind:value={aiModel}
          placeholder={aiModelPlaceholders[aiProvider] ?? 'model-name'}
          class="input w-full font-mono text-xs"
        />
      </div>
      <div>
        <label for="ai_api_key" class="block text-xs text-muted mb-1.5">API Key for {aiProvider === 'anthropic' ? 'Claude' : aiProvider === 'openai' ? 'OpenAI' : 'Current Provider'}</label>
        <input
          id="ai_api_key"
          type="password"
          bind:value={aiApiKey}
          placeholder="sk-..."
          class="input w-full font-mono text-xs"
          autocomplete="new-password"
        />
      </div>
      <div>
        <label for="ai_base_url" class="block text-xs text-muted mb-1.5">Base URL <span class="text-muted font-normal">(custom / Ollama only)</span></label>
        <input
          id="ai_base_url"
          type="url"
          bind:value={aiBaseUrl}
          placeholder="http://localhost:11434/v1"
          class="input w-full font-mono text-xs"
          disabled={aiProvider !== 'custom'}
        />
        <p class="text-xs text-muted mt-1">Leave blank for standard providers. Required for Custom/Ollama.</p>
      </div>
      <div class="md:col-span-2 flex justify-end">
        <button class="btn-primary btn-sm" on:click={saveAi} disabled={savingAi}>
          {savingAi ? 'Saving…' : 'Save AI Config'}
        </button>
      </div>
    </div>
  </div>

  {/if}

</div>
{/if}
