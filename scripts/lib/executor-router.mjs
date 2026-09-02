// Hermes Harness executor router.
//
// Marvin directive: Hermes is the only orchestrator/backend. Do not route
// structured agency, research, editorial, generation, cron-created content, or
// Discord/chatbot requests to OpenAI, Codex, Claude, or direct Gemini backends.
// Gemini CLI may be used only as a research helper invoked by Hermes.

const HERMES_ONLY = ['hermes'];

export function executorLead(_opts = {}) {
  return [...HERMES_ONLY];
}

export function pick_executor(_opts = {}) {
  return [...HERMES_ONLY];
}

export function taskTypeForAgent(agentSlug, mode) {
  if (mode === 'blog') return 'blog';
  if (agentSlug === 'client-research') return 'research';
  if (agentSlug === 'gmb-rank') return 'structured';
  return 'default';
}
