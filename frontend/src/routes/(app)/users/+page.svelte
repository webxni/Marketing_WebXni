<script lang="ts">
  import { onMount } from 'svelte';
  import { usersApi, clientsApi, authApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { can, userStore } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { formatDateTime, timeAgo } from '$lib/utils';
  import type { User, Role, Client } from '$lib/types';

  let users: User[]     = [];
  let clients: Client[] = [];
  let loading           = true;
  let showCreate        = false;
  let confirmDeactivate: User | null = null;
  let confirmReactivate: User | null = null;
  let confirmReset2fa:   User | null = null;

  // Create form
  let newEmail    = '';
  let newName     = '';
  let newRole: Role = 'designer';
  let newPassword = '';
  let newClientId = '';
  let creating    = false;

  // 2FA setup modal
  let show2faModal  = false;
  let totpUri       = '';
  let totpSecret    = '';
  let totpCode      = '';
  let totp2faEnabled = false;
  let totpLoading   = false;
  let totpStep: 'status' | 'setup' | 'disable' = 'status';
  let disableCode   = '';

  const roles: Role[] = ['admin', 'designer', 'client'];

  const roleDescriptions: Record<Role, string> = {
    admin:    'Full access — manage users, clients, settings, and all posts',
    designer: 'Create and edit posts, upload assets, manage content workflow',
    client:   'Read-only portal — sees only their own posts and reports',
  };

  const roleColors: Record<Role, string> = {
    admin:    'text-red-400',
    designer: 'text-blue-400',
    client:   'text-green-400',
  };

  async function load() {
    loading = true;
    try {
      const [ur, cr] = await Promise.all([
        usersApi.list().catch(() => ({ users: [] as User[] })),
        clientsApi.list('all').catch(() => ({ clients: [] as Client[] })),
      ]);
      users   = ur.users;
      clients = cr.clients;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function createUser() {
    if (!newEmail || !newName || !newPassword) { toast.error('All fields required'); return; }
    if (newRole === 'client' && !newClientId)  { toast.error('Select a client account for this user'); return; }
    creating = true;
    try {
      await usersApi.create({
        email: newEmail, name: newName, role: newRole, password: newPassword,
        client_id: newRole === 'client' ? newClientId : undefined,
      });
      toast.success(`User ${newName} created`);
      showCreate = false;
      newEmail = ''; newName = ''; newPassword = ''; newRole = 'designer'; newClientId = '';
      load();
    } catch (e) { toast.error(String(e)); }
    finally { creating = false; }
  }

  async function deactivate(user: User) {
    try { await usersApi.deactivate(user.id); toast.success(`${user.name} deactivated`); load(); }
    catch { toast.error('Failed'); }
    finally { confirmDeactivate = null; }
  }

  async function reactivate(user: User) {
    try { await usersApi.reactivate(user.id); toast.success(`${user.name} reactivated`); load(); }
    catch { toast.error('Failed'); }
    finally { confirmReactivate = null; }
  }

  async function reset2fa(user: User) {
    try { await usersApi.reset2fa(user.id); toast.success(`2FA reset for ${user.name}`); load(); }
    catch { toast.error('Failed to reset 2FA'); }
    finally { confirmReset2fa = null; }
  }

  // ─── 2FA self-management ─────────────────────────────────────────
  async function open2faModal() {
    show2faModal = true; totpStep = 'status'; totpCode = ''; disableCode = '';
    totpLoading = true;
    try {
      const r = await authApi.totpStatus();
      totp2faEnabled = r.enabled;
    } catch { toast.error('Failed to load 2FA status'); show2faModal = false; }
    finally { totpLoading = false; }
  }

  async function start2faSetup() {
    totpLoading = true; totpCode = '';
    try {
      const r = await authApi.totpSetup();
      totpUri    = r.uri;
      totpSecret = r.secret;
      totpStep   = 'setup';
    } catch { toast.error('Failed to generate QR code'); }
    finally { totpLoading = false; }
  }

  async function enable2fa() {
    if (!totpCode || totpCode.length !== 6) { toast.error('Enter the 6-digit code'); return; }
    totpLoading = true;
    try {
      await authApi.totpEnable(totpSecret, totpCode);
      toast.success('Two-factor authentication enabled');
      totp2faEnabled = true; totpStep = 'status'; totpCode = '';
      load();
    } catch (e) { toast.error(String(e)); totpCode = ''; }
    finally { totpLoading = false; }
  }

  async function disable2fa() {
    if (!disableCode || disableCode.length !== 6) { toast.error('Enter your current 6-digit code'); return; }
    totpLoading = true;
    try {
      await authApi.totpDisable(disableCode);
      toast.success('Two-factor authentication disabled');
      totp2faEnabled = false; totpStep = 'status'; disableCode = '';
      load();
    } catch (e) { toast.error(String(e)); disableCode = ''; }
    finally { totpLoading = false; }
  }

  $: selfId = $userStore?.userId ?? '';
</script>

<svelte:head><title>Team — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Team</h1>
    <p class="page-subtitle">{users.length} member{users.length === 1 ? '' : 's'}</p>
  </div>
  {#if can('users.manage')}
    <button class="btn-primary btn-sm" on:click={() => (showCreate = true)}>+ Add User</button>
  {/if}
</div>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else}
  <div class="card">
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>2FA</th>
            <th>Status</th>
            <th>Last Login</th>
            <th>Since</th>
            {#if can('users.manage')}<th></th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each users as user}
            <tr>
              <td>
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-accent text-xs font-semibold">
                    {user.name[0]}
                  </div>
                  <div>
                    <span class="text-sm text-white font-medium">{user.name}</span>
                    {#if user.id === selfId}
                      <span class="ml-1.5 text-xs text-muted">(you)</span>
                    {/if}
                  </div>
                </div>
              </td>
              <td class="text-xs text-muted">{user.email}</td>
              <td>
                <div>
                  <span class="text-xs font-medium capitalize {roleColors[user.role] ?? 'text-muted'}">
                    {user.role}
                  </span>
                  {#if user.client_name}
                    <span class="block text-xs text-muted">{user.client_name}</span>
                  {/if}
                </div>
              </td>
              <td>
                {#if user.totp_enabled}
                  <span class="inline-flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                    <span>✓</span> On
                  </span>
                {:else}
                  <span class="text-xs text-muted">Off</span>
                {/if}
              </td>
              <td>
                <Badge status={user.is_active ? 'active' : 'inactive'} />
              </td>
              <td class="text-xs text-muted">
                {user.last_login ? timeAgo(user.last_login) : 'Never'}
              </td>
              <td class="text-xs text-muted">{formatDateTime(user.created_at)}</td>
              {#if can('users.manage')}
              <td>
                <div class="flex items-center gap-1">
                  {#if user.id === selfId}
                    <button class="btn-ghost btn-sm text-xs" on:click={open2faModal}>
                      2FA
                    </button>
                  {:else if user.totp_enabled}
                    <button
                      class="btn-ghost btn-sm text-xs text-orange-400"
                      on:click={() => (confirmReset2fa = user)}
                    >Reset 2FA</button>
                  {/if}
                  {#if user.is_active}
                    <button
                      class="btn-ghost btn-sm text-xs text-red-400"
                      on:click={() => (confirmDeactivate = user)}
                    >Deactivate</button>
                  {:else}
                    <button
                      class="btn-ghost btn-sm text-xs text-green-400"
                      on:click={() => (confirmReactivate = user)}
                    >Reactivate</button>
                  {/if}
                </div>
              </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}

<!-- Create user modal -->
<Modal open={showCreate} title="Add User" on:close={() => (showCreate = false)}>
  <div class="space-y-4" slot="body">
    <div>
      <label for="newName" class="block text-xs text-muted mb-1.5">Full Name</label>
      <input id="newName" type="text" bind:value={newName} placeholder="Jane Smith" class="input w-full" />
    </div>
    <div>
      <label for="newEmail" class="block text-xs text-muted mb-1.5">Email</label>
      <input id="newEmail" type="email" bind:value={newEmail} placeholder="jane@example.com" class="input w-full" />
    </div>
    <div>
      <label for="newRole" class="block text-xs text-muted mb-1.5">Role</label>
      <select id="newRole" bind:value={newRole} class="input w-full">
        {#each roles as r}
          <option value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
        {/each}
      </select>
      {#if newRole && roleDescriptions[newRole]}
        <p class="text-xs text-muted mt-1">{roleDescriptions[newRole]}</p>
      {/if}
    </div>
    {#if newRole === 'client'}
    <div>
      <label for="newClientId" class="block text-xs text-muted mb-1.5">Client Account</label>
      {#if clients.length === 0}
        <p class="text-xs text-orange-400 bg-orange-500/10 px-3 py-2 rounded-md">No clients found. Create a client first.</p>
      {:else}
        <select id="newClientId" bind:value={newClientId} class="input w-full">
          <option value="">— Select client —</option>
          {#each clients as cl}
            <option value={cl.id}>{cl.canonical_name}</option>
          {/each}
        </select>
        <p class="text-xs text-muted mt-1">This user will only see data for the selected client.</p>
      {/if}
    </div>
    {/if}
    <div>
      <label for="newPassword" class="block text-xs text-muted mb-1.5">Initial Password</label>
      <input id="newPassword" type="password" bind:value={newPassword} placeholder="••••••••" class="input w-full" autocomplete="new-password" />
    </div>
  </div>
  <div class="flex justify-end gap-2" slot="footer">
    <button class="btn-ghost btn-sm" on:click={() => (showCreate = false)}>Cancel</button>
    <button class="btn-primary btn-sm" on:click={createUser} disabled={creating}>
      {creating ? 'Creating…' : 'Create User'}
    </button>
  </div>
</Modal>

<!-- 2FA management modal -->
<Modal open={show2faModal} title="Two-Factor Authentication" on:close={() => (show2faModal = false)}>
  <div slot="body">
    {#if totpLoading}
      <div class="flex justify-center py-8"><Spinner /></div>
    {:else if totpStep === 'status'}
      <div class="space-y-4">
        <div class="flex items-center justify-between p-4 bg-card rounded-lg">
          <div>
            <p class="text-sm font-medium text-white">Authenticator App</p>
            <p class="text-xs text-muted mt-0.5">
              {totp2faEnabled ? 'Your account is protected with 2FA.' : 'Add an extra layer of security to your account.'}
            </p>
          </div>
          {#if totp2faEnabled}
            <span class="text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-full">Enabled</span>
          {:else}
            <span class="text-xs text-muted bg-card border border-border px-2 py-1 rounded-full">Disabled</span>
          {/if}
        </div>
        {#if totp2faEnabled}
          <p class="text-xs text-muted">To disable 2FA you'll need to enter a code from your authenticator app.</p>
          <button class="btn-ghost btn-sm text-red-400 border border-red-500/20 w-full justify-center"
            on:click={() => { totpStep = 'disable'; disableCode = ''; }}>
            Disable 2FA
          </button>
        {:else}
          <p class="text-xs text-muted">Use Google Authenticator, Authy, or any TOTP app to scan a QR code.</p>
          <button class="btn-primary w-full justify-center" on:click={start2faSetup}>
            Set Up 2FA
          </button>
        {/if}
      </div>

    {:else if totpStep === 'setup'}
      <div class="space-y-4">
        <p class="text-xs text-muted">
          1. Open your authenticator app and scan the QR code, or enter the key manually.
        </p>
        <!-- QR code via Google Charts API -->
        <div class="flex justify-center bg-white p-3 rounded-lg">
          <img
            src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data={encodeURIComponent(totpUri)}"
            alt="QR Code"
            width="180"
            height="180"
            class="rounded"
          />
        </div>
        <div class="bg-card rounded-lg p-3">
          <p class="text-xs text-muted mb-1">Or enter this key manually:</p>
          <p class="font-mono text-xs text-white tracking-widest break-all">{totpSecret}</p>
        </div>
        <div>
          <label for="totpCode" class="block text-xs text-muted mb-1.5">
            2. Enter the 6-digit code from your app to confirm
          </label>
          <input
            id="totpCode"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="6"
            bind:value={totpCode}
            placeholder="000000"
            class="input w-full text-center text-lg tracking-widest font-mono"
            autocomplete="one-time-code"
          />
        </div>
      </div>

    {:else if totpStep === 'disable'}
      <div class="space-y-4">
        <div class="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
          <p class="text-xs text-orange-300">Disabling 2FA will make your account less secure.</p>
        </div>
        <div>
          <label for="disableCode" class="block text-xs text-muted mb-1.5">
            Enter your current authenticator code to confirm
          </label>
          <input
            id="disableCode"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="6"
            bind:value={disableCode}
            placeholder="000000"
            class="input w-full text-center text-lg tracking-widest font-mono"
            autocomplete="one-time-code"
          />
        </div>
      </div>
    {/if}
  </div>

  <div class="flex justify-between gap-2" slot="footer">
    <button class="btn-ghost btn-sm" on:click={() => {
      if (totpStep !== 'status') { totpStep = 'status'; }
      else { show2faModal = false; }
    }}>
      {totpStep !== 'status' ? '← Back' : 'Close'}
    </button>
    {#if totpStep === 'setup'}
      <button class="btn-primary btn-sm" on:click={enable2fa} disabled={totpLoading || totpCode.length !== 6}>
        {totpLoading ? 'Verifying…' : 'Enable 2FA'}
      </button>
    {:else if totpStep === 'disable'}
      <button class="btn-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 px-4 py-1.5 rounded-md text-sm font-medium"
        on:click={disable2fa} disabled={totpLoading || disableCode.length !== 6}>
        {totpLoading ? 'Disabling…' : 'Confirm Disable'}
      </button>
    {/if}
  </div>
</Modal>

<ConfirmDialog
  open={!!confirmDeactivate}
  title="Deactivate User"
  message="This will prevent {confirmDeactivate?.name} from logging in."
  confirmLabel="Deactivate"
  confirmClass="btn-danger"
  on:confirm={() => { const u = confirmDeactivate; if (u) deactivate(u); }}
  on:cancel={() => (confirmDeactivate = null)}
/>
<ConfirmDialog
  open={!!confirmReactivate}
  title="Reactivate User"
  message="This will allow {confirmReactivate?.name} to log in again."
  confirmLabel="Reactivate"
  on:confirm={() => { const u = confirmReactivate; if (u) reactivate(u); }}
  on:cancel={() => (confirmReactivate = null)}
/>
<ConfirmDialog
  open={!!confirmReset2fa}
  title="Reset 2FA"
  message="This will disable two-factor authentication for {confirmReset2fa?.name}. They will be able to log in with password only."
  confirmLabel="Reset 2FA"
  confirmClass="btn-danger"
  on:confirm={() => { const u = confirmReset2fa; if (u) reset2fa(u); }}
  on:cancel={() => (confirmReset2fa = null)}
/>
