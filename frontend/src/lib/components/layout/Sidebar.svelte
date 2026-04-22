<script lang="ts">
  import { page } from '$app/stores';
  import { sidebarOpen } from '$lib/stores/ui';
  import { can, hasRole } from '$lib/stores/auth';

  // SVG icon paths (20×20 viewBox, Heroicons-style)
  const icons: Record<string, string> = {
    dashboard:  'M2 3h7v7H2V3zm9 0h7v7h-7V3zm-9 9h7v7H2v-7zm9 0h7v7h-7v-7z',
    posts:      'M4 5h12M4 9h12M4 13h8',
    approvals:  'M5 13l4 4L19 7',
    calendar:   'M6 2v2M14 2v2M2 8h16M3 4h14a1 1 0 011 1v13a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1z',
    clients:    'M16 11a4 4 0 10-8 0M4 19c0-3.314 3.582-6 8-6s8 2.686 8 6',
    packages:   'M3 3h5v5H3V3zm9 0h5v5h-5V3zm-9 9h5v5H3v-5zm9 0h5v5h-5v-5z',
    reports:    'M3 17l4-8 4 4 4-6 4 4M3 17h14',
    automation: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    team:       'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    logs:       'M9 12h6M9 16h6M9 8h6M5 4h10a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
    settings:   'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z',
  };

  // Admin sees everything; designer sees work items; client is redirected to /portal
  const adminNav = [
    { href: '/dashboard',  icon: 'dashboard',  label: 'Dashboard',  perm: null },
    { href: '/posts',      icon: 'posts',      label: 'Posts',      perm: 'posts.view' },
    { href: '/approvals',  icon: 'approvals',  label: 'Approvals',  perm: 'posts.approve' },
    { href: '/calendar',   icon: 'calendar',   label: 'Calendar',   perm: 'posts.view' },
    { href: '/clients',    icon: 'clients',    label: 'Clients',    perm: 'clients.view' },
    { href: '/packages',   icon: 'packages',   label: 'Packages',   perm: 'settings.view' },
    { href: '/reports',    icon: 'reports',    label: 'Reports',    perm: 'reports.view' },
    { href: '/automation', icon: 'automation', label: 'Automation', perm: 'automation.trigger' },
    { href: '/users',      icon: 'team',       label: 'Team',       perm: 'users.view' },
    { href: '/logs',       icon: 'logs',       label: 'Logs',       perm: 'logs.view' },
    { href: '/settings',   icon: 'settings',   label: 'Settings',   perm: 'settings.view' },
  ];

  const designerNav = [
    { href: '/dashboard',  icon: 'dashboard',  label: 'Dashboard',  perm: null },
    { href: '/posts',      icon: 'posts',       label: 'Posts',      perm: 'posts.view' },
    { href: '/calendar',   icon: 'calendar',   label: 'Calendar',   perm: 'posts.view' },
    { href: '/clients',    icon: 'clients',    label: 'Clients',    perm: 'clients.view' },
    { href: '/automation', icon: 'automation', label: 'Generate',   perm: 'automation.generate' },
  ];

  $: nav = hasRole('admin') ? adminNav : designerNav;
  $: active = (href: string) => $page.url.pathname.startsWith(href);
</script>

{#if $sidebarOpen}
<aside class="w-56 shrink-0 h-screen bg-surface border-r border-border flex flex-col">
  <!-- Logo -->
  <div class="px-4 py-4 border-b border-border">
    <div class="flex items-center gap-2.5">
      <div class="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white text-xs font-bold shrink-0">W</div>
      <div>
        <div class="font-semibold text-white text-sm leading-tight">WebXni</div>
        <div class="text-[10px] text-muted leading-tight">Marketing Platform</div>
      </div>
    </div>
  </div>

  <!-- Nav -->
  <nav class="flex-1 py-3 overflow-y-auto">
    <div class="px-2 space-y-0.5">
      {#each nav as item}
        {#if !item.perm || can(item.perm)}
          <a
            href={item.href}
            class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors
                   {active(item.href)
                     ? 'bg-accent/10 text-accent font-medium'
                     : 'text-muted hover:text-white hover:bg-white/5'}"
          >
            <svg
              width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.75"
              stroke-linecap="round" stroke-linejoin="round"
              class="shrink-0 {active(item.href) ? 'opacity-100' : 'opacity-70'}"
            >
              <path d={icons[item.icon] ?? ''} />
            </svg>
            <span class="truncate">{item.label}</span>
          </a>
        {/if}
      {/each}
    </div>
  </nav>

  <!-- New Post shortcut (admin + designer) -->
  {#if can('posts.create')}
  <div class="px-3 pb-4 pt-2 border-t border-border">
    <a href="/posts/new" class="btn-primary w-full justify-center text-xs py-2 rounded-lg">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      New Post
    </a>
  </div>
  {/if}
</aside>
{/if}
