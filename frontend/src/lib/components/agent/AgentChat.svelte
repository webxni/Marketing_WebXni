<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { agentApi } from '$lib/api/agent';
  import type { AgentConversationMessage, AgentResponse } from '$lib/api/agent';

  // ── State ──────────────────────────────────────────────────────────────────
  let open      = false;
  let input     = '';
  let loading   = false;
  let messagesEl: HTMLDivElement;

  interface ChatMessage {
    role:        'user' | 'assistant';
    content:     string;
    actions?:    string[];
    errors?:     string[];
    tools?:      string[];
    suggestions?: string[];
    items?:      unknown[];
    summary?:    Record<string, unknown>;
    job_id?:     string;
    pending?:    boolean;
  }

  let messages: ChatMessage[] = [];

  // Track conversation history for context
  $: history = messages
    .filter(m => !m.pending)
    .map(m => ({ role: m.role, content: m.content } as AgentConversationMessage));

  // ── Keyboard shortcut: Cmd/Ctrl+K ─────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      open = !open;
      if (open) focusInput();
    }
    if (e.key === 'Escape' && open) open = false;
  }

  function focusInput() {
    tick().then(() => {
      const el = document.getElementById('agent-input');
      el?.focus();
    });
  }

  async function scrollToBottom() {
    await tick();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Send message ───────────────────────────────────────────────────────────
  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    input   = '';
    loading = true;

    messages = [...messages, { role: 'user', content: text }];
    await scrollToBottom();

    const placeholderIdx = messages.length;
    messages = [...messages, { role: 'assistant', content: '', pending: true }];
    await scrollToBottom();

    try {
      const res: AgentResponse = await agentApi.chat({
        message: text,
        history: history.slice(0, -1),
      });

      messages = messages.map((m, i) => {
        if (i === placeholderIdx) {
          return {
            role:        'assistant' as const,
            content:     res.message,
            actions:     res.actions_taken?.length  ? res.actions_taken  : undefined,
            errors:      res.errors?.length         ? res.errors         : undefined,
            tools:       res.tools_used?.length     ? res.tools_used     : undefined,
            suggestions: res.suggestions?.length    ? res.suggestions    : undefined,
            items:       res.items?.length          ? res.items          : undefined,
            summary:     res.summary && Object.keys(res.summary).length ? res.summary : undefined,
            job_id:      res.job_id,
          };
        }
        return m;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      messages = messages.map((m, i) => {
        if (i === placeholderIdx) {
          return { role: 'assistant' as const, content: '', errors: [msg] };
        }
        return m;
      });
    } finally {
      loading = false;
      await scrollToBottom();
      focusInput();
    }
  }

  function handleKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearChat() {
    messages = [];
    input    = '';
  }

  function retryMessage(idx: number) {
    // Find the user message before this assistant message
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        send(messages[i].content);
        return;
      }
    }
  }

  // Render a single item from the items array as a compact row
  function itemTitle(item: unknown): string {
    if (!item || typeof item !== 'object') return String(item);
    const o = item as Record<string, unknown>;
    return (o['title'] ?? o['name'] ?? o['type'] ?? o['id'] ?? '—') as string;
  }

  function itemMeta(item: unknown): string {
    if (!item || typeof item !== 'object') return '';
    const o = item as Record<string, unknown>;
    const parts: string[] = [];
    if (o['status'])       parts.push(String(o['status']).replace(/_/g, ' '));
    if (o['client'])       parts.push(String(o['client']));
    if (o['publish_date']) parts.push(String(o['publish_date']).slice(0, 10));
    if (o['severity'])     parts.push(String(o['severity']));
    if (o['count'] != null) parts.push(`×${o['count']}`);
    return parts.join(' · ');
  }

  function formatSummaryValue(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  // Simple markdown-like rendering: bold **text**, convert newlines
  function renderContent(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code class="bg-white/10 px-1 rounded text-xs font-mono">$1</code>')
      .replace(/\n/g, '<br>');
  }

  // Quick-action shortcuts
  const QUICK_ACTIONS = [
    { label: '📋 Posting Queue',  msg: 'Show me the current posting queue',  icon: '' },
    { label: '❌ Failed Posts',   msg: 'Show me all failed posts',            icon: '' },
    { label: '📅 Today\'s posts', msg: 'Show me today\'s posts',             icon: '' },
    { label: '🔧 System Status',  msg: 'Run a system health check',           icon: '' },
  ];

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<!-- ── Trigger button ──────────────────────────────────────────────────────── -->
<button
  on:click={() => { open = !open; if (open) focusInput(); }}
  class="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-accent text-white shadow-xl
         flex items-center justify-center hover:bg-accent/90 transition-all duration-200
         ring-2 ring-accent/30 hover:ring-accent/50
         {open ? 'rotate-45 scale-95' : 'scale-100'}"
  title="AI Agent (⌘K)"
  aria-label="Toggle AI Agent"
>
  <span class="text-base leading-none">{open ? '✕' : '✦'}</span>
</button>

<!-- ── Chat panel ─────────────────────────────────────────────────────────── -->
{#if open}
<div
  class="fixed bottom-20 right-5 z-50 w-[420px] flex flex-col rounded-2xl shadow-2xl
         bg-surface border border-border overflow-hidden"
  style="height: min(640px, calc(100vh - 100px));"
>
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80">
    <div class="flex items-center gap-2.5">
      <!-- Status dot -->
      <div class="relative">
        <div class="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center text-accent text-sm">✦</div>
        <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full ring-2 ring-surface"></span>
      </div>
      <div>
        <div class="text-sm font-semibold text-white leading-tight">AI Agent</div>
        <div class="text-[10px] text-muted leading-tight">WebXni Control · Ready</div>
      </div>
    </div>
    <div class="flex items-center gap-1">
      {#if messages.length > 0}
        <button
          on:click={clearChat}
          class="text-xs text-muted hover:text-white transition-colors px-2 py-1 rounded hover:bg-surface"
          title="Clear conversation"
        >
          Clear
        </button>
      {/if}
      <button
        on:click={() => open = false}
        class="w-7 h-7 flex items-center justify-center text-muted hover:text-white hover:bg-surface rounded transition-colors"
        aria-label="Close"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Messages -->
  <div bind:this={messagesEl} class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
    {#if messages.length === 0}
      <!-- Welcome state -->
      <div class="text-center py-4">
        <div class="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent text-xl mx-auto mb-3">✦</div>
        <p class="text-white text-sm font-semibold mb-1">How can I help?</p>
        <p class="text-muted text-xs mb-5">Control the platform with natural language</p>
        <div class="grid grid-cols-2 gap-2">
          {#each QUICK_ACTIONS as qa}
            <button
              on:click={() => send(qa.msg)}
              class="text-xs px-3 py-2.5 rounded-xl bg-card border border-border
                     text-muted hover:text-white hover:border-accent/40 hover:bg-accent/5
                     transition-all text-left font-medium"
            >
              {qa.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#each messages as msg, i (i)}
      <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div class="max-w-[88%] {msg.role === 'user' ? '' : 'space-y-2 w-full'}">

          {#if msg.role === 'user'}
            <!-- User bubble -->
            <div class="bg-accent text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed">
              {msg.content}
            </div>
          {:else}
            <!-- Assistant: main message text -->
            <div class="bg-card border border-border rounded-2xl rounded-tl-sm px-3.5 py-2.5">
              {#if msg.pending}
                <div class="flex gap-1.5 items-center py-0.5">
                  <span class="w-2 h-2 bg-accent rounded-full animate-bounce" style="animation-delay:0ms"></span>
                  <span class="w-2 h-2 bg-accent rounded-full animate-bounce" style="animation-delay:150ms"></span>
                  <span class="w-2 h-2 bg-accent rounded-full animate-bounce" style="animation-delay:300ms"></span>
                </div>
              {:else if msg.content}
                <!-- Rendered content with basic inline markdown -->
                <p class="text-sm text-white leading-relaxed">{@html renderContent(msg.content)}</p>
              {/if}
            </div>

            <!-- Summary stats (key/value grid) -->
            {#if msg.summary}
              <div class="bg-surface border border-border rounded-xl px-3 py-2.5">
                <p class="text-[10px] text-muted uppercase tracking-wider mb-2 font-semibold">Summary</p>
                <div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {#each Object.entries(msg.summary) as [k, v]}
                    {#if typeof v !== 'object' || v === null}
                      <div class="flex items-baseline justify-between gap-2">
                        <span class="text-xs text-muted truncate capitalize">{k.replace(/_/g, ' ')}</span>
                        <span class="text-xs text-white font-medium tabular-nums shrink-0">{formatSummaryValue(v)}</span>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Items list -->
            {#if msg.items && msg.items.length > 0}
              <div class="border border-border rounded-xl overflow-hidden">
                <div class="px-3 py-1.5 bg-surface/60 border-b border-border flex items-center justify-between">
                  <span class="text-[10px] text-muted uppercase tracking-wider font-semibold">Results</span>
                  <span class="text-[10px] text-muted">{msg.items.length} items</span>
                </div>
                <div class="max-h-52 overflow-y-auto divide-y divide-border/50">
                  {#each msg.items as item, idx}
                    <div class="px-3 py-2 flex items-start gap-2.5 hover:bg-white/[0.03] transition-colors">
                      <span class="text-muted text-[10px] mt-0.5 shrink-0 w-4 text-right tabular-nums">{idx + 1}</span>
                      <div class="min-w-0 flex-1">
                        <p class="text-xs text-white truncate font-medium">{itemTitle(item)}</p>
                        {#if itemMeta(item)}
                          <p class="text-[11px] text-muted truncate mt-0.5">{itemMeta(item)}</p>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Actions taken -->
            {#if msg.actions && msg.actions.length > 0}
              <div class="bg-emerald-900/20 border border-emerald-800/30 rounded-xl px-3 py-2.5">
                <div class="flex items-center gap-1.5 mb-2">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="text-emerald-400">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span class="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Actions completed</span>
                </div>
                {#each msg.actions as action}
                  <p class="text-xs text-emerald-300 leading-relaxed">· {action}</p>
                {/each}
              </div>
            {/if}

            <!-- Job ID -->
            {#if msg.job_id}
              <div class="flex items-center gap-2 px-1">
                <span class="text-[10px] text-muted">Job ID:</span>
                <code class="text-[10px] font-mono text-accent/70 bg-accent/5 px-1.5 py-0.5 rounded">{msg.job_id.slice(0, 16)}…</code>
              </div>
            {/if}

            <!-- Suggestions (clickable follow-ups) -->
            {#if msg.suggestions && msg.suggestions.length > 0}
              <div class="space-y-1.5">
                <p class="text-[10px] text-muted uppercase tracking-wider px-1 font-semibold">Follow-up</p>
                {#each msg.suggestions as suggestion}
                  <button
                    on:click={() => { input = suggestion; send(); }}
                    class="w-full text-left text-xs px-3 py-2 rounded-lg border border-border
                           text-muted hover:text-white hover:bg-accent/8 hover:border-accent/30
                           transition-all"
                  >
                    <span class="text-accent mr-1.5">→</span>{suggestion}
                  </button>
                {/each}
              </div>
            {/if}

            <!-- Errors -->
            {#if msg.errors && msg.errors.length > 0}
              <div class="bg-red-900/15 border border-red-800/30 rounded-xl px-3 py-2.5">
                <div class="flex items-center gap-1.5 mb-2">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="text-red-400">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span class="text-[10px] text-red-400 font-semibold uppercase tracking-wider">Error</span>
                </div>
                {#each msg.errors as err}
                  <p class="text-xs text-red-300 leading-relaxed">· {err}</p>
                {/each}
                <button
                  on:click={() => retryMessage(i)}
                  class="mt-2 text-xs text-red-400 hover:text-red-200 underline decoration-dotted"
                >
                  Retry this request
                </button>
              </div>
            {/if}

            <!-- Tools used — subtle pill list -->
            {#if msg.tools && msg.tools.length > 0}
              <div class="flex flex-wrap gap-1 px-1">
                {#each msg.tools as tool}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted border border-white/10 font-mono">{tool}</span>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Input -->
  <div class="border-t border-border p-3 bg-card/40">
    <div class="flex items-end gap-2">
      <textarea
        id="agent-input"
        bind:value={input}
        on:keydown={handleKeypress}
        placeholder="Ask anything… (Enter to send, Shift+Enter for new line)"
        rows="2"
        disabled={loading}
        class="flex-1 bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-white
               placeholder-muted resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30
               disabled:opacity-50 transition-colors leading-relaxed"
      ></textarea>
      <button
        on:click={() => send()}
        disabled={loading || !input.trim()}
        class="shrink-0 w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center
               hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-md"
        aria-label="Send"
      >
        {#if loading}
          <span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        {/if}
      </button>
    </div>
    <p class="text-[10px] text-muted/60 mt-1.5 px-0.5">⌘K to toggle</p>
  </div>
</div>
{/if}

<style>
  /* Ensure bouncing dots animate correctly */
  @keyframes bounce-dot {
    0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
    40% { transform: scale(1); opacity: 1; }
  }
</style>
