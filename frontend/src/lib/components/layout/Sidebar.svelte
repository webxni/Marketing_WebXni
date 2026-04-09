<script lang="ts">
  import { page } from '$app/stores';
  import { sidebarOpen } from '$lib/stores/ui';
  import { can } from '$lib/stores/auth';

  const nav = [
    { href: '/dashboard',   icon: '◼', label: 'Dashboard',   perm: null },
    { href: '/posts',       icon: '✦', label: 'Posts',        perm: 'posts.view' },
    { href: '/approvals',   icon: '✓', label: 'Approvals',   perm: 'posts.approve' },
    { href: '/calendar',    icon: '▦', label: 'Calendar',    perm: 'posts.view' },
    { href: '/clients',     icon: '◉', label: 'Clients',     perm: 'clients.view' },
    { href: '/reports',     icon: '▣', label: 'Reports',     perm: 'reports.view' },
    { href: '/automation',  icon: '⚡', label: 'Automation',  perm: 'automation.trigger' },
    { href: '/users',       icon: '◎', label: 'Team',        perm: 'users.view' },
    { href: '/logs',        icon: '≡',  label: 'Logs',        perm: 'logs.view' },
    { href: '/settings',    icon: '⚙', label: 'Settings',   perm: 'settings.view' },
  ];

  $: active = (href: string) => $page.url.pathname.startsWith(href);
</script>

{#if $sidebarOpen}
<aside class="w-56 shrink-0 h-screen bg-surface border-r border-border flex flex-col">
  <!-- Logo -->
  <div class="px-5 py-4 border-b border-border">
    <div class="flex items-center gap-2">
      <div class="w-7 h-7 rounded-md bg-accent flex items-center justify-center text-white text-xs font-bold">W</div>
      <span class="font-semibold text-white text-sm">WebXni</span>
    </div>
  </div>

  <!-- Nav -->
  <nav class="flex-1 py-3 overflow-y-auto">
    <div class="px-3 space-y-0.5">
      {#each nav as item}
        {#if !item.perm || can(item.perm)}
          <a
            href={item.href}
            class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors
                   {active(item.href)
                     ? 'bg-accent/10 text-accent font-medium'
                     : 'text-muted hover:text-white hover:bg-card'}"
          >
            <span class="text-base leading-none w-4 text-center">{item.icon}</span>
            {item.label}
          </a>
        {/if}
      {/each}
    </div>
  </nav>

  <!-- New Post shortcut -->
  {#if can('posts.create')}
  <div class="px-4 pb-3">
    <a href="/posts/new" class="btn-primary w-full justify-center text-xs py-2">
      + New Post
    </a>
  </div>
  {/if}
</aside>
{/if}
