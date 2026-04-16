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
    role:    'user' | 'assistant';
    content: string;
    actions?: string[];
    errors?:  string[];
    tools?:   string[];
    pending?: boolean;
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
  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    input   = '';
    loading = true;

    messages = [...messages, { role: 'user', content: text }];
    await scrollToBottom();

    // Placeholder while waiting
    const placeholderIdx = messages.length;
    messages = [...messages, { role: 'assistant', content: '', pending: true }];
    await scrollToBottom();

    try {
      const res: AgentResponse = await agentApi.chat({
        message: text,
        history: history.slice(0, -1), // exclude the message we just sent (already in request)
      });

      // Replace placeholder with real response
      messages = messages.map((m, i) => {
        if (i === placeholderIdx) {
          return {
            role:    'assistant',
            content: res.message,
            actions: res.actions_taken?.length ? res.actions_taken : undefined,
            errors:  res.errors?.length        ? res.errors        : undefined,
            tools:   res.tools_used?.length    ? res.tools_used    : undefined,
          };
        }
        return m;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      messages = messages.map((m, i) => {
        if (i === placeholderIdx) {
          return { role: 'assistant', content: '', errors: [msg] };
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

  // Quick-action shortcuts
  const QUICK_ACTIONS = [
    { label: 'Queue',        msg: 'Show me the current posting queue' },
    { label: 'Failed posts', msg: 'Show me all failed posts' },
    { label: "Today's posts", msg: "Show me today's posts" },
    { label: 'Report',       msg: 'Give me an overview report' },
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
  class="fixed bottom-20 right-5 z-50 w-96 flex flex-col rounded-xl shadow-2xl
         bg-surface border border-border overflow-hidden"
  style="height: min(600px, calc(100vh - 100px));"
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
              on:click={() => { input = qa.msg; send(); }}
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
        <div class="max-w-[85%] {msg.role === 'user'
          ? 'bg-accent text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm'
          : 'space-y-2'}">

          {#if msg.role === 'user'}
            {msg.content}
          {:else}
            <!-- Assistant bubble -->
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

            <!-- Actions taken -->
            {#if msg.actions && msg.actions.length > 0}
              <div class="bg-green-900/20 border border-green-800/40 rounded-lg px-3 py-2 space-y-1">
                <p class="text-xs text-green-400 font-medium uppercase tracking-wide">Actions taken</p>
                {#each msg.actions as action}
                  <p class="text-xs text-green-300">• {action}</p>
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
                  on:click={() => { input = messages[i - 1]?.content ?? ''; send(); }}
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
        on:click={send}
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
