import { writable } from 'svelte/store';

// ─── Sidebar ─────────────────────────────────────────────────────────────────
export const sidebarOpen = writable(true);

// ─── Toasts ──────────────────────────────────────────────────────────────────
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id:      string;
  type:    ToastType;
  message: string;
  ttl?:    number;
}

const _toasts = writable<Toast[]>([]);
export const toasts = { subscribe: _toasts.subscribe };

export function addToast(type: ToastType, message: string, ttl = 4000) {
  const id = Math.random().toString(36).slice(2);
  _toasts.update((t) => [...t, { id, type, message, ttl }]);
  if (ttl > 0) setTimeout(() => removeToast(id), ttl);
  return id;
}

export function removeToast(id: string) {
  _toasts.update((t) => t.filter((x) => x.id !== id));
}

export const toast = {
  success: (msg: string) => addToast('success', msg),
  error:   (msg: string) => addToast('error', msg, 6000),
  info:    (msg: string) => addToast('info', msg),
  warning: (msg: string) => addToast('warning', msg),
};

// ─── Loading ─────────────────────────────────────────────────────────────────
export const loading = writable(false);
