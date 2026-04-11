import type { PostStatus } from './types';

/** Format Unix timestamp → "Apr 9, 2026" */
export function formatDate(ts: number | string | null | undefined): string {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format ISO date string → "Apr 9, 2026" */
export function formatDateStr(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format Unix timestamp → "Apr 9, 2026 at 9:00 AM" */
export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Relative time — "3 days ago" */
export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Parse JSON array of platforms from DB string */
export function parsePlatforms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; }
  catch { return []; }
}

/** Truncate string */
export function truncate(s: string | null | undefined, n = 80): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Title-case a slug */
export function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get badge CSS class for post status */
export function statusClass(status: PostStatus | string | null | undefined): string {
  const map: Record<string, string> = {
    draft:            'badge-draft',
    pending_approval: 'badge-pending',
    approved:         'badge-approved',
    ready:            'badge-ready',
    scheduled:        'badge-scheduled',
    posted:           'badge-posted',
    failed:           'badge-failed',
    blocked:          'badge-blocked',
    cancelled:        'badge-draft',
    running:          'badge-running',
    completed:        'badge-completed',
    pending:          'badge-pending',
    sent:             'badge-scheduled',
    active:           'badge-active',
    inactive:         'badge-inactive',
    ok:               'badge-completed',
    skipped:          'badge-draft',
    idempotent:       'badge-scheduled',
  };
  return map[status ?? ''] ?? 'badge-draft';
}

/** Parse job stats JSON */
export function parseStats(json: string | null): { processed: number; posted: number; skipped: number; blocked: number; failed: number } {
  const defaults = { processed: 0, posted: 0, skipped: 0, blocked: 0, failed: 0 };
  if (!json) return defaults;
  try { return { ...defaults, ...JSON.parse(json) }; }
  catch { return defaults; }
}

/** Convert month number (1-12) to 3-letter abbreviation */
export function monthAbbr(m: number): string {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] ?? '';
}

/** Current month in YYYY-MM format */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** List of last N months, newest first. Returns { value: 'YYYY-MM', label: 'Month YYYY' }[] */
export function lastNMonths(n = 6): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    result.push({ value, label });
    d.setMonth(d.getMonth() - 1);
  }
  return result;
}

/**
 * Build a list of months spanning `past` months before today through `future` months ahead.
 * Ordered newest-first (future months first, then current, then past).
 */
export function monthRange(past = 6, future = 12): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = [];
  const d = new Date();
  d.setMonth(d.getMonth() + future);
  for (let i = 0; i < past + future + 1; i++) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    result.push({ value, label });
    d.setMonth(d.getMonth() - 1);
  }
  return result;
}
