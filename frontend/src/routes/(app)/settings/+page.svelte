<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { notionApi } from '$lib/api/notion';
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
  let postingHours = '9,15';
  let savingCron = false;

  // ── AI Provider ───────────────────────────────────────────────────────────
  let aiProvider = 'openai';
  let aiModel = '';
  let aiApiKey = '';
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
        postingHours = systemSettings['posting_hours'] ?? '9,15';
        aiProvider   = systemSettings['ai_provider']   ?? 'openai';
        aiModel      = systemSettings['ai_model']      ?? '';
        aiApiKey     = systemSettings['ai_api_key']    ?? '';
        aiBaseUrl    = systemSettings['ai_base_url']   ?? '';
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

  async function saveCron() {
    savingCron = true;
    try {
      const updated = {
        ...systemSettings,
        cron_enabled:  cronEnabled  ? 'true' : 'false',
        posting_hours: postingHours.trim() || '9,15',
      };
      await api.put('/api/settings', { settings: updated });
      systemSettings = updated;
      toast.success('Schedule saved');
    } catch (e) { toast.error(String(e)); }
    finally { savingCron = false; }
  }

  // ── Notion Integration ────────────────────────────────────────────────────
  let syncingNotion  = false;
  let forceSubTables = false;
  let notionResult:  import('$lib/api/notion').NotionImportResponse | null = null;

  // Hardcoded WebXni Notion DB config — the DB ID and page→slug map never change
  const NOTION_DB_ID = '87e495b2-350a-45eb-a343-f6441dafa6cb';
  const NOTION_SLUG_MAP: Record<string, string> = {
    '1503627b-21c7-80ea-bc2b-d225d3829a67': '724-locksmith-ca',
    '1e43627b-21c7-80cf-a316-e10315125274': '247-lockout-pasadena',
    '2363627b-21c7-809c-a659-e06f0a90bc4e': 'unlocked-pros',
    '28d3627b-21c7-809f-a6d9-c3229a856a98': 'daniels-locksmith',
    '2f33627b-21c7-80b6-87fa-f66a889e8112': 'elite-team-builders',
    '2f33627b-21c7-80bb-8e98-d5333bb1bdfe': 'americas-professional-builders',
    '3353627b-21c7-8154-b7af-f96b2faac314': 'caliview-builders',
    'a1466972-fc09-4449-bb3e-cc5a7c49df26': 'golden-touch-roofing',
    '9b4731c8-67ba-45e8-9311-3b94b4ce84e0': 'webxni',
    '19943730-826e-4110-9753-ca29531c221d': 'ketty-s-robles-accounting',
    '3273627b-21c7-80c8-bba6-dae846a35c57': 'jaz-makeup-artist',
    '0533eada-a7f2-4798-8359-38a99cbbd53f': 'modern-vision-remodeling',
  };

  async function syncNotion() {
    syncingNotion = true;
    notionResult  = null;
    try {
      const r = await notionApi.importClientsFull({
        database_id:           NOTION_DB_ID,
        notion_id_to_app_slug: NOTION_SLUG_MAP,
        active_only:           true,
        force_sub_tables:      forceSubTables,
      });
      notionResult = r;
      const { created = 0, updated = 0, skipped = 0, errors = 0 } = r.counts ?? {};
      toast.success(`Notion sync done — ${created + updated} updated, ${skipped} skipped, ${errors} errors`);
    } catch (e) { toast.error(String(e)); }
    finally { syncingNotion = false; }
  }

  async function saveAi() {
    if (!aiApiKey.trim() && aiProvider !== 'custom') {
      toast.error('API key is required');
      return;
    }
    savingAi = true;
    try {
      const updated = {
        ...systemSettings,
        ai_provider: aiProvider,
        ai_model:    aiModel.trim(),
        ai_api_key:  aiApiKey.trim(),
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

  <!-- Automation Schedule -->
  <div class="card p-5">
    <h3 class="section-label mb-4">Automation Schedule</h3>
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <input type="checkbox" id="cron_enabled" bind:checked={cronEnabled} class="rounded" />
        <label for="cron_enabled" class="text-xs text-muted cursor-pointer">Enable automated posting (cron runs every 6 hours)</label>
      </div>
      <div>
        <label for="posting_hours" class="block text-xs text-muted mb-1.5">Active Posting Hours (UTC, comma-separated)</label>
        <input
          id="posting_hours"
          type="text"
          bind:value={postingHours}
          placeholder="9,15"
          class="input w-full font-mono text-xs"
          disabled={!cronEnabled}
        />
        <p class="text-xs text-muted mt-1">
          Hours when the cron job will attempt to post (24h UTC). E.g. "9,15" = 9 AM and 3 PM.
          The cron fires every 6h — it only processes posts if the current hour is in this list.
        </p>
      </div>
      <div class="flex justify-end">
        <button class="btn-primary btn-sm" on:click={saveCron} disabled={savingCron}>
          {savingCron ? 'Saving…' : 'Save Schedule'}
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
        <select id="ai_provider" bind:value={aiProvider} class="input w-full">
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
        <label for="ai_api_key" class="block text-xs text-muted mb-1.5">API Key</label>
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

  <!-- Notion Integration -->
  <div class="card p-5 lg:col-span-2">
    <h3 class="section-label mb-1">Notion Integration</h3>
    <p class="text-xs text-muted mb-4">
      Sync client profiles, intelligence, platforms, services, areas, and offers from the WebXni Notion database.
      Existing local data is never overwritten with empty Notion values.
    </p>
    <div class="flex items-center gap-4 flex-wrap mb-4">
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={forceSubTables} class="rounded" />
        <span class="text-xs text-muted">Force re-import services / areas / offers</span>
      </label>
      <span class="text-xs text-muted">DB: <code class="font-mono text-white/60">87e495b2…</code> · {Object.keys(NOTION_SLUG_MAP).length} known clients</span>
    </div>
    <div class="flex items-center gap-3">
      <button
        class="btn-primary btn-sm"
        on:click={syncNotion}
        disabled={syncingNotion}
      >
        {syncingNotion ? 'Syncing…' : 'Sync from Notion'}
      </button>
      {#if notionResult}
        <span class="text-xs text-muted">
          <span class="text-green-400 font-medium">{(notionResult.counts?.created ?? 0) + (notionResult.counts?.updated ?? 0)} updated</span>
          · {notionResult.counts?.skipped ?? 0} skipped
          {#if (notionResult.counts?.errors ?? 0) > 0}· <span class="text-red-400">{notionResult.counts.errors} errors</span>{/if}
        </span>
      {/if}
    </div>
    {#if notionResult?.results && notionResult.results.length > 0}
      <details class="mt-3">
        <summary class="text-xs text-muted cursor-pointer">Show per-client details ({notionResult.results.length})</summary>
        <ul class="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
          {#each notionResult.results as r}
            <li class="text-[10px] font-mono {r.action === 'error' ? 'text-red-400' : 'text-muted'}">
              {r.name ?? r.slug ?? r.notion_id} — {r.action}{r.tabs && r.tabs.length > 0 ? ' (' + r.tabs.join(', ') + ')' : ''}{r.error ? ': ' + r.error : ''}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>

  {/if}

</div>
{/if}
