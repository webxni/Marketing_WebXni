import { writable, derived } from 'svelte/store';
import type { SessionUser, Role } from '../types';

const SESSION_KEY = 'wxni_session';

function loadStored(): SessionUser | null {
  if (typeof sessionStorage === 'undefined') return null;
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null'); }
  catch { return null; }
}

const _user = writable<SessionUser | null>(loadStored());

export const userStore = {
  subscribe: _user.subscribe,
  set: (user: SessionUser | null) => {
    _user.set(user);
    if (typeof sessionStorage !== 'undefined') {
      if (user) sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
      else      sessionStorage.removeItem(SESSION_KEY);
    }
  },
  update: (fn: (u: SessionUser | null) => SessionUser | null) => {
    let current: SessionUser | null = null;
    _user.subscribe((v) => { current = v; })();
    userStore.set(fn(current));
  },
  clear: () => userStore.set(null),
};

export const isAuthenticated = derived(_user, ($u) => $u !== null);

export const currentRole = derived(_user, ($u): Role | null => $u?.role ?? null);

/** Returns true if the current user has at least one of the given roles */
export function hasRole(...roles: Role[]): boolean {
  let current: SessionUser | null = null;
  _user.subscribe((v) => { current = v; })();
  return current !== null && roles.includes((current as SessionUser).role);
}

/** Permission helper (mirrors backend RBAC) */
const ROLE_PERMS: Record<Role, string[]> = {
  admin:    ['*'],
  manager:  ['posts.*','clients.*','users.view','reports.*','automation.*','assets.*','settings.view','logs.view'],
  editor:   ['posts.view','posts.create','posts.edit','clients.view','reports.view','assets.upload','settings.view'],
  reviewer: ['posts.view','posts.approve','clients.view','reports.view','reports.download','settings.view'],
  operator: ['posts.view','clients.view','reports.view','reports.download','settings.view'],
};

export function can(permission: string): boolean {
  let current: SessionUser | null = null;
  _user.subscribe((v) => { current = v; })();
  if (!current) return false;
  const perms = ROLE_PERMS[(current as SessionUser).role] ?? [];
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  // Check wildcard: 'posts.*' covers 'posts.create'
  const [ns] = permission.split('.');
  return perms.includes(`${ns}.*`);
}
