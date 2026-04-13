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

  // ── Create ───────────────────────────────────────────────────────────────────
  let showCreate  = false;
  let newEmail    = '';
  let newName     = '';
  let newRole: Role = 'designer';
  let newPassword = '';
  let newClientId = '';
  let creating    = false;
  // After create: offer immediate 2FA setup
  let createdUser: User | null = null;

  // ── Edit ─────────────────────────────────────────────────────────────────────
  let editUser:     User | null = null;
  let editName     = '';
  let editRole: Role = 'designer';
  let editClientId = '';
  let editPassword = '';
  let saving       = false;

  // ── Delete / deactivate ──────────────────────────────────────────────────────
  let confirmDeactivate: User | null = null;
  let confirmReactivate: User | null = null;
  let confirmDelete:     User | null = null;

  // ── 2FA modal ────────────────────────────────────────────────────────────────
  // Works for self (via authApi) and for other users (via usersApi admin endpoints)
  let twoFaUser:      User | null = null;   // which user is being managed
  let totpUri         = '';
  let totpSecret      = '';
  let totpCode        = '';
  let totp2faEnabled  = false;
  let totpLoading     = false;
  let totpStep: 'status' | 'setup' | 'disable' = 'status';
  let disableCode     = '';

  // ── Confirm reset 2FA (for admin resetting others) ───────────────────────────
  let confirmReset2fa: User | null = null;

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

  $: selfId = $userStore?.userId ?? '';

  // Whether the 2FA modal is targeting the current logged-in user
  $: twoFaIsSelf = twoFaUser?.id === selfId;

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

  // ── Create ───────────────────────────────────────────────────────────────────
  async function createUser() {
    if (!newEmail || !newName || !newPassword) { toast.error('All fields required'); return; }
    if (newRole === 'client' && !newClientId)  { toast.error('Select a client account for this user'); return; }
    creating = true;
    try {
      const res = await usersApi.create({
        email: newEmail, name: newName, role: newRole, password: newPassword,
        client_id: newRole === 'client' ? newClientId : undefined,
      });
      showCreate = false;
      newEmail = ''; newName = ''; newPassword = ''; newRole = 'designer'; newClientId = '';
      await load();
      // After create: offer immediate 2FA setup for the new user
      createdUser = users.find(u => u.id === res.user.id) ?? res.user;
      toast.success(`${res.user.name} created`);
    } catch (e) { toast.error(String(e)); }
    finally { creating = false; }
  }

  // ── Edit ─────────────────────────────────────────────────────────────────────
  function openEdit(user: User) {
    editUser     = user;
    editName     = user.name;
    editRole     = user.role as Role;
    editClientId = user.client_id ?? '';
    editPassword = '';
  }

  async function saveEdit() {
    if (!editUser) return;
    if (!editName.trim()) { toast.error('Name is required'); return; }
    if (editRole === 'client' && !editClientId) { toast.error('Select a client account'); return; }
    saving = true;
    try {
      const payload: { name: string; role: Role; client_id?: string | null; password?: string } = {
        name: editName.trim(),
        role: editRole,
        client_id: editRole === 'client' ? editClientId : null,
      };
      if (editPassword.trim()) payload.password = editPassword.trim();
      await usersApi.update(editUser.id, payload);
      toast.success('User updated');
      editUser = null;
      load();
    } catch (e) { toast.error(String(e)); }
    finally { saving = false; }
  }

  // ── Deactivate / reactivate ───────────────────────────────────────────────────
  async function deactivate(user: User) {
    try { await usersApi.deactivate(user.id); toast.success(`${user.name} deactivated`); load(); }
    catch (e) { toast.error(String(e)); }
    finally { confirmDeactivate = null; }
  }

  async function reactivate(user: User) {
    try { await usersApi.reactivate(user.id); toast.success(`${user.name} reactivated`); load(); }
    catch (e) { toast.error(String(e)); }
    finally { confirmReactivate = null; }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function deleteUser(user: User) {
    try { await usersApi.remove(user.id); toast.success(`${user.name} deleted`); load(); }
    catch (e) { toast.error(String(e)); }
    finally { confirmDelete = null; }
  }

  // ── 2FA management ────────────────────────────────────────────────────────────
  async function open2faModal(user: User) {
    twoFaUser = user;
    totpStep  = 'status';
    totpCode  = '';
    disableCode = '';
    totpUri   = '';
    totpSecret = '';
    totpLoading = true;
    try {
      if (user.id === selfId) {
        const r  = await authApi.totpStatus();
        totp2faEnabled = r.enabled;
      } else {
        // For others: enabled state is already in the user object from the list
        totp2faEnabled = !!user.totp_enabled;
      }
    } catch { toast.error('Failed to load 2FA status'); twoFaUser = null; }
    finally { totpLoading = false; }
  }

  async function start2faSetup() {
    if (!twoFaUser) return;
    totpLoading = true; totpCode = '';
    try {
      let r: { uri: string; secret: string };
      if (twoFaIsSelf) {
        r = await authApi.totpSetup();
      } else {
        r = await usersApi.adminSetup2fa(twoFaUser.id);
      }
      totpUri    = r.uri;
      totpSecret = r.secret;
      totpStep   = 'setup';
    } catch (e) { toast.error(String(e)); }
    finally { totpLoading = false; }
  }

  async function enable2fa() {
    if (!twoFaUser) return;
    if (!totpCode || totpCode.length !== 6) { toast.error('Enter the 6-digit code'); return; }
    totpLoading = true;
    try {
      if (twoFaIsSelf) {
        await authApi.totpEnable(totpSecret, totpCode);
      } else {
        await usersApi.adminEnable2fa(twoFaUser.id, totpCode);
      }
      toast.success('Two-factor authentication enabled');
      totp2faEnabled = true; totpStep = 'status'; totpCode = '';
      load();
    } catch (e) { toast.error(String(e)); totpCode = ''; }
    finally { totpLoading = false; }
  }

  async function disable2fa() {
    if (!twoFaUser) return;
    if (!disableCode || disableCode.length !== 6) { toast.error('Enter your current 6-digit code'); return; }
    totpLoading = true;
    try {
      // Only self can disable — admin should use "Reset 2FA" for others
      await authApi.totpDisable(disableCode);
      toast.success('Two-factor authentication disabled');
      totp2faEnabled = false; totpStep = 'status'; disableCode = '';
      load();
    } catch (e) { toast.error(String(e)); disableCode = ''; }
    finally { totpLoading = false; }
  }

  async function reset2fa(user: User) {
    try { await usersApi.reset2fa(user.id); toast.success(`2FA reset for ${user.name}`); load(); }
    catch (e) { toast.error(String(e)); }
    finally { confirmReset2fa = null; }
  }

  // Close 2FA modal
  function close2faModal() { twoFaUser = null; totpStep = 'status'; }

  // Post-create 2FA setup
  function openPostCreate2fa() {
    if (!createdUser) return;
    const u = createdUser;
    createdUser = null;
    open2faModal(u);
  }
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

<!-- Post-create 2FA prompt -->
{#if createdUser}
  <div class="mb-4 flex items-center justify-between bg-accent/10 border border-accent/20 rounded-lg px-4 py-3">
    <div>
      <p class="text-sm text-white font-medium">{createdUser.name} was created</p>
      <p class="text-xs text-muted mt-0.5">Set up Google Authenticator now to secure this account.</p>
    </div>
    <div class="flex items-center gap-2">
      <button class="btn-primary btn-sm" on:click={openPostCreate2fa}>Set Up 2FA</button>
      <button class="btn-ghost btn-sm text-xs text-muted" on:click={() => (createdUser = null)}>Skip</button>
    </div>
  </div>
{/if}

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
              <!-- 2FA status — clickable to open setup/manage modal -->
              <td>
                {#if user.totp_enabled}
                  <button
                    class="inline-flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full hover:bg-green-500/20 transition-colors"
                    on:click={() => open2faModal(user)}
                    title="Manage 2FA"
                  >
                    <span>✓</span> On
                  </button>
                {:else}
                  <button
                    class="text-xs text-muted hover:text-white transition-colors underline decoration-dotted underline-offset-2"
                    on:click={() => open2faModal(user)}
                    title="Set up 2FA"
                  >
                    Off
                  </button>
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
                <div class="flex items-center gap-1 flex-wrap">
                  <!-- Edit -->
                  <button
                    class="btn-ghost btn-sm text-xs"
                    on:click={() => openEdit(user)}
                  >Edit</button>

                  <!-- Deactivate / Reactivate — not for self -->
                  {#if user.id !== selfId}
                    {#if user.is_active}
                      <button
                        class="btn-ghost btn-sm text-xs text-orange-400"
                        on:click={() => (confirmDeactivate = user)}
                      >Disable</button>
                    {:else}
                      <button
                        class="btn-ghost btn-sm text-xs text-green-400"
                        on:click={() => (confirmReactivate = user)}
                      >Enable</button>
                    {/if}

                    <!-- Delete -->
                    <button
                      class="btn-ghost btn-sm text-xs text-red-400"
                      on:click={() => (confirmDelete = user)}
                    >Delete</button>
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

<!-- ── Create user modal ────────────────────────────────────────────────────── -->
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

<!-- ── Edit user modal ──────────────────────────────────────────────────────── -->
<Modal open={!!editUser} title="Edit User" on:close={() => (editUser = null)}>
  <div class="space-y-4" slot="body">
    <div>
      <label for="editName" class="block text-xs text-muted mb-1.5">Full Name</label>
      <input id="editName" type="text" bind:value={editName} class="input w-full" />
    </div>
    <div>
      <label for="editRole" class="block text-xs text-muted mb-1.5">Role</label>
      <select id="editRole" bind:value={editRole} class="input w-full"
        disabled={editUser?.id === selfId}>
        {#each roles as r}
          <option value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
        {/each}
      </select>
      {#if editUser?.id === selfId}
        <p class="text-xs text-muted mt-1">You cannot change your own role.</p>
      {:else if editRole && roleDescriptions[editRole]}
        <p class="text-xs text-muted mt-1">{roleDescriptions[editRole]}</p>
      {/if}
    </div>
    {#if editRole === 'client'}
    <div>
      <label for="editClientId" class="block text-xs text-muted mb-1.5">Client Account</label>
      {#if clients.length === 0}
        <p class="text-xs text-orange-400 bg-orange-500/10 px-3 py-2 rounded-md">No clients found.</p>
      {:else}
        <select id="editClientId" bind:value={editClientId} class="input w-full">
          <option value="">— Select client —</option>
          {#each clients as cl}
            <option value={cl.id}>{cl.canonical_name}</option>
          {/each}
        </select>
      {/if}
    </div>
    {/if}
    <div>
      <label for="editPassword" class="block text-xs text-muted mb-1.5">New Password <span class="text-muted">(leave blank to keep current)</span></label>
      <input id="editPassword" type="password" bind:value={editPassword} placeholder="••••••••" class="input w-full" autocomplete="new-password" />
    </div>
  </div>
  <div class="flex justify-end gap-2" slot="footer">
    <button class="btn-ghost btn-sm" on:click={() => (editUser = null)}>Cancel</button>
    <button class="btn-primary btn-sm" on:click={saveEdit} disabled={saving}>
      {saving ? 'Saving…' : 'Save Changes'}
    </button>
  </div>
</Modal>

<!-- ── 2FA management modal ──────────────────────────────────────────────────── -->
<Modal open={!!twoFaUser} title="Two-Factor Authentication" on:close={close2faModal}>
  <div slot="body">
    {#if twoFaUser}
      {#if !twoFaIsSelf}
        <div class="flex items-center gap-2 mb-4 p-3 bg-card rounded-lg border border-border">
          <div class="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-accent text-xs font-semibold">
            {twoFaUser.name[0]}
          </div>
          <div>
            <p class="text-sm font-medium text-white">{twoFaUser.name}</p>
            <p class="text-xs text-muted">{twoFaUser.email}</p>
          </div>
        </div>
      {/if}

      {#if totpLoading}
        <div class="flex justify-center py-8"><Spinner /></div>
      {:else if totpStep === 'status'}
        <div class="space-y-4">
          <div class="flex items-center justify-between p-4 bg-card rounded-lg">
            <div>
              <p class="text-sm font-medium text-white">Authenticator App</p>
              <p class="text-xs text-muted mt-0.5">
                {totp2faEnabled ? 'Account is protected with 2FA.' : 'Add an extra layer of security.'}
              </p>
            </div>
            {#if totp2faEnabled}
              <span class="text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-full">Enabled</span>
            {:else}
              <span class="text-xs text-muted bg-card border border-border px-2 py-1 rounded-full">Disabled</span>
            {/if}
          </div>

          {#if totp2faEnabled}
            {#if twoFaIsSelf}
              <p class="text-xs text-muted">To disable 2FA enter a code from your authenticator app.</p>
              <button class="btn-ghost btn-sm text-red-400 border border-red-500/20 w-full justify-center"
                on:click={() => { totpStep = 'disable'; disableCode = ''; }}>
                Disable 2FA
              </button>
            {:else}
              <p class="text-xs text-muted">Only the user can disable their own 2FA. You can reset (clear) it below.</p>
              <button class="btn-ghost btn-sm text-orange-400 border border-orange-500/20 w-full justify-center"
                on:click={() => { close2faModal(); confirmReset2fa = twoFaUser; }}>
                Reset 2FA for {twoFaUser.name}
              </button>
            {/if}
          {:else}
            {#if twoFaIsSelf}
              <p class="text-xs text-muted">Use Google Authenticator, Authy, or any TOTP app to scan a QR code.</p>
            {:else}
              <p class="text-xs text-muted">Generate a QR code for {twoFaUser.name} to scan with Google Authenticator or Authy.</p>
            {/if}
            <button class="btn-primary w-full justify-center" on:click={start2faSetup}>
              {twoFaIsSelf ? 'Set Up 2FA' : 'Generate QR Code'}
            </button>
          {/if}
        </div>

      {:else if totpStep === 'setup'}
        <div class="space-y-4">
          <p class="text-xs text-muted">
            {twoFaIsSelf
              ? '1. Open your authenticator app and scan the QR code, or enter the key manually.'
              : `Have ${twoFaUser.name} scan this QR code with Google Authenticator or Authy.`}
          </p>
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
            <p class="text-xs text-muted mb-1">Or enter this key manually in the app:</p>
            <p class="font-mono text-xs text-white tracking-widest break-all select-all">{totpSecret}</p>
          </div>
          <div>
            <label for="totpCode" class="block text-xs text-muted mb-1.5">
              {twoFaIsSelf
                ? '2. Enter the 6-digit code from your app to confirm'
                : `Enter the 6-digit code ${twoFaUser.name} sees in their app`}
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
    {/if}
  </div>

  <div class="flex justify-between gap-2" slot="footer">
    <button class="btn-ghost btn-sm" on:click={() => {
      if (totpStep !== 'status') { totpStep = 'status'; }
      else { close2faModal(); }
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

<!-- ── Confirm dialogs ───────────────────────────────────────────────────────── -->
<ConfirmDialog
  open={!!confirmDeactivate}
  title="Disable User"
  message="This will prevent {confirmDeactivate?.name} from logging in. You can re-enable them later."
  confirmLabel="Disable"
  confirmClass="btn-danger"
  on:confirm={() => { const u = confirmDeactivate; if (u) deactivate(u); }}
  on:cancel={() => (confirmDeactivate = null)}
/>
<ConfirmDialog
  open={!!confirmReactivate}
  title="Enable User"
  message="This will allow {confirmReactivate?.name} to log in again."
  confirmLabel="Enable"
  on:confirm={() => { const u = confirmReactivate; if (u) reactivate(u); }}
  on:cancel={() => (confirmReactivate = null)}
/>
<ConfirmDialog
  open={!!confirmDelete}
  title="Delete User"
  message="Permanently delete {confirmDelete?.name}? This cannot be undone. All their session data will be removed."
  confirmLabel="Delete Permanently"
  confirmClass="btn-danger"
  on:confirm={() => { const u = confirmDelete; if (u) deleteUser(u); }}
  on:cancel={() => (confirmDelete = null)}
/>
<ConfirmDialog
  open={!!confirmReset2fa}
  title="Reset 2FA"
  message="This will disable two-factor authentication for {confirmReset2fa?.name}. They will be able to log in with password only until 2FA is set up again."
  confirmLabel="Reset 2FA"
  confirmClass="btn-danger"
  on:confirm={() => { const u = confirmReset2fa; if (u) reset2fa(u); }}
  on:cancel={() => (confirmReset2fa = null)}
/>
