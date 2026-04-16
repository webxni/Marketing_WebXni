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
    if (o['status'])       parts.push(String(o['status']));
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

  // Quick-action shortcuts
  const QUICK_ACTIONS = [
    { label: 'Queue',         msg: 'Show me the current posting queue' },
    { label: 'Failed posts',  msg: 'Show me all failed posts' },
    { label: "Today's posts", msg: "Show me today's posts" },
    { label: 'System status', msg: 'Run a system health check' },
  ];

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<!-- ── Trigger button ──────────────────────────────────────────────────────── -->
<button
  on:click={() => { open = !open; if (open) focusInput(); }}
  class="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-accent text-white shadow-lg
         flex items-center justify-center text-lg hover:bg-accent/90 transition-all
         {open ? 'rotate-45' : ''}"
  title="AI Agent (⌘K)"
  aria-label="Toggle AI Agent"
>
  {open ? '✕' : '✦'}
</button>

<!-- ── Chat panel ─────────────────────────────────────────────────────────── -->
{#if open}
<div
  class="fixed bottom-20 right-5 z-50 w-[420px] flex flex-col rounded-xl shadow-2xl
         bg-surface border border-border overflow-hidden"
  style="height: min(640px, calc(100vh - 100px));"
>
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
    <div class="flex items-center gap-2">
      <span class="text-accent text-base leading-none">✦</span>
      <span class="text-sm font-semibold text-white">AI Agent</span>
      <span class="text-xs text-muted">WebXni Control</span>
    </div>
    <div class="flex items-center gap-2">
      {#if messages.length > 0}
        <button
          on:click={clearChat}
          class="text-xs text-muted hover:text-white transition-colors px-1"
          title="Clear conversation"
        >
          Clear
        </button>
      {/if}
      <button
        on:click={() => open = false}
        class="text-muted hover:text-white transition-colors text-lg leading-none"
        aria-label="Close"
      >✕</button>
    </div>
  </div>

  <!-- Messages -->
  <div bind:this={messagesEl} class="flex-1 overflow-y-auto p-4 space-y-4">
    {#if messages.length === 0}
      <!-- Welcome state -->
      <div class="text-center py-6">
        <div class="text-accent text-3xl mb-3">✦</div>
        <p class="text-white text-sm font-medium mb-1">How can I help?</p>
        <p class="text-muted text-xs mb-5">Control the platform with natural language</p>
        <div class="grid grid-cols-2 gap-2">
          {#each QUICK_ACTIONS as qa}
            <button
              on:click={() => send(qa.msg)}
              class="text-xs px-3 py-2 rounded-lg bg-card border border-border
                     text-muted hover:text-white hover:border-accent/50 transition-all text-left"
            >
              {qa.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#each messages as msg, i (i)}
      <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div class="max-w-[90%] {msg.role === 'user'
          ? 'bg-accent text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm'
          : 'space-y-2 w-full'}">

          {#if msg.role === 'user'}
            {msg.content}
          {:else}
            <!-- Assistant bubble: message text -->
            <div class="bg-card border border-border rounded-2xl rounded-tl-sm px-3 py-2">
              {#if msg.pending}
                <div class="flex gap-1 items-center py-1">
                  <span class="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style="animation-delay:0ms"></span>
                  <span class="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style="animation-delay:150ms"></span>
                  <span class="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style="animation-delay:300ms"></span>
                </div>
              {:else if msg.content}
                <p class="text-sm text-white whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              {/if}
            </div>

            <!-- Summary stats (key/value pairs) -->
            {#if msg.summary}
              <div class="bg-card/60 border border-border/60 rounded-xl px-3 py-2">
                <div class="flex flex-wrap gap-x-4 gap-y-1">
                  {#each Object.entries(msg.summary) as [k, v]}
                    {#if typeof v !== 'object' || v === null}
                      <span class="text-xs">
                        <span class="text-muted">{k.replace(/_/g, ' ')}:</span>
                        <span class="text-white ml-1">{formatSummaryValue(v)}</span>
                      </span>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Items list -->
            {#if msg.items && msg.items.length > 0}
              <div class="border border-border/60 rounded-xl overflow-hidden">
                <div class="max-h-48 overflow-y-auto divide-y divide-border/40">
                  {#each msg.items as item, idx}
                    <div class="px-3 py-1.5 flex items-start gap-2 hover:bg-white/5 transition-colors">
                      <span class="text-muted text-xs mt-0.5 shrink-0 w-4 text-right">{idx + 1}</span>
                      <div class="min-w-0">
                        <p class="text-xs text-white truncate">{itemTitle(item)}</p>
                        {#if itemMeta(item)}
                          <p class="text-xs text-muted truncate">{itemMeta(item)}</p>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
                {#if msg.items.length > 8}
                  <div class="px-3 py-1 text-xs text-muted bg-card/40">
                    {msg.items.length} items total
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Actions taken -->
            {#if msg.actions && msg.actions.length > 0}
              <div class="bg-green-900/20 border border-green-800/40 rounded-lg px-3 py-2 space-y-1">
                <p class="text-xs text-green-400 font-medium uppercase tracking-wide">Done</p>
                {#each msg.actions as action}
                  <p class="text-xs text-green-300">• {action}</p>
                {/each}
              </div>
            {/if}

            <!-- Job ID -->
            {#if msg.job_id}
              <p class="text-xs text-muted px-1">Job: <span class="font-mono text-accent/70">{msg.job_id}</span></p>
            {/if}

            <!-- Suggestions (clickable) -->
            {#if msg.suggestions && msg.suggestions.length > 0}
              <div class="space-y-1">
                {#each msg.suggestions as suggestion}
                  <button
                    on:click={() => { input = suggestion; send(); }}
                    class="w-full text-left text-xs px-3 py-1.5 rounded-lg border border-accent/30
                           text-accent/80 hover:text-white hover:bg-accent/10 hover:border-accent/60
                           transition-all"
                  >
                    → {suggestion}
                  </button>
                {/each}
              </div>
            {/if}

            <!-- Errors -->
            {#if msg.errors && msg.errors.length > 0}
              <div class="bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 space-y-1">
                <p class="text-xs text-red-400 font-medium uppercase tracking-wide">Errors</p>
                {#each msg.errors as err}
                  <p class="text-xs text-red-300">• {err}</p>
                {/each}
                <button
                  on:click={() => retryMessage(i)}
                  class="mt-1 text-xs text-red-400 hover:text-red-200 underline"
                >
                  Retry
                </button>
              </div>
            {/if}

            <!-- Tools used (subtle) -->
            {#if msg.tools && msg.tools.length > 0}
              <p class="text-xs text-muted px-1">
                Tools: {msg.tools.join(', ')}
              </p>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Input -->
  <div class="border-t border-border p-3">
    <div class="flex items-end gap-2">
      <textarea
        id="agent-input"
        bind:value={input}
        on:keydown={handleKeypress}
        placeholder="Ask me anything… (Enter to send)"
        rows="2"
        disabled={loading}
        class="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-white
               placeholder-muted resize-none focus:outline-none focus:border-accent/60
               disabled:opacity-50 transition-colors"
      ></textarea>
      <button
        on:click={() => send()}
        disabled={loading || !input.trim()}
        class="shrink-0 w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center
               hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        aria-label="Send"
      >
        {#if loading}
          <span class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        {/if}
      </button>
    </div>
    <p class="text-xs text-muted mt-1.5 px-1">⌘K to toggle · Shift+Enter for new line</p>
  </div>
</div>
{/if}
