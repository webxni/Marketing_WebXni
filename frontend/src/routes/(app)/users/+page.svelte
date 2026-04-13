<script lang="ts">
  import { onMount } from 'svelte';
  import { usersApi, clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import { formatDateTime, timeAgo } from '$lib/utils';
  import type { User, Role, Client } from '$lib/types';

  let users: User[]   = [];
  let clients: Client[] = [];
  let loading = true;
  let showCreate = false;
  let confirmDeactivate: User | null = null;
  let confirmReactivate: User | null = null;

  // Create form
  let newEmail    = '';
  let newName     = '';
  let newRole: Role = 'designer';
  let newPassword = '';
  let newClientId = '';
  let creating    = false;

  const roles: Role[] = ['admin', 'designer', 'client'];

  const roleDescriptions: Record<Role, string> = {
    admin:    'Full access — manage users, clients, settings, and all posts',
    designer: 'Create and edit posts, upload assets, manage content workflow',
    client:   'Read-only portal — sees only their own posts and reports',
  };

  async function load() {
    loading = true;
    try {
      const [ur, cr] = await Promise.all([usersApi.list(), clientsApi.list('all')]);
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

  const roleColors: Record<Role, string> = {
    admin:    'text-red-400',
    designer: 'text-blue-400',
    client:   'text-green-400',
  };
</script>

<svelte:head><title>Team — WebXni</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Team</h1>
    <p class="page-subtitle">{users.length} user{users.length === 1 ? '' : 's'}</p>
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
            <th>Status</th>
            <th>Last Login</th>
            <th>Member Since</th>
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
                  <span class="text-sm text-white font-medium">{user.name}</span>
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
                <Badge status={user.is_active ? 'active' : 'inactive'} />
              </td>
              <td class="text-xs text-muted">
                {user.last_login ? timeAgo(user.last_login) : 'Never'}
              </td>
              <td class="text-xs text-muted">{formatDateTime(user.created_at)}</td>
              {#if can('users.manage')}
              <td>
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
      <select id="newClientId" bind:value={newClientId} class="input w-full">
        <option value="">— Select client —</option>
        {#each clients as c}
          <option value={c.id}>{c.canonical_name}</option>
        {/each}
      </select>
      <p class="text-xs text-muted mt-1">This user will only see data for the selected client.</p>
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
