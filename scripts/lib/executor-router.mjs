// Hermes-as-brain executor router.
//
// Hermes plans, routes, and validates; the other CLIs are executors it delegates
// to. pick_executor maps a task to the ordered executor chain best suited to it,
// honoring budget state and quality target. It is pure and testable so routing
// is not scattered across scripts.
//
// Backends: hermes (brain/default), claude (long-form/brand/polish), codex
// (structured/JSON/templated), gemini (fast/cheap research/bulk), openai (final
// fallback). Every chain keeps hermes + openai at the tail so a single backend
// outage never blocks the back-office.

// task_type -> preferred lead executors (before the hermes/openai safety tail).
const TASK_LEAD = {
  long_form:   ['claude'],
  brand_voice: ['claude'],
  blog:        ['claude'],
  polish:      ['claude'],
  revision:    ['claude'],
  structured:  ['codex'],
  schema:      ['codex'],
  templated:   ['codex'],
  research:    ['gemini'],
  bulk:        ['gemini'],
  web:         ['gemini'],
  plan:        ['hermes'],
  decide:      ['hermes'],
  validate:    ['hermes'],
  default:     ['hermes'],
};

// Executors that cost meaningfully more — dropped when an agent is over budget.
const EXPENSIVE = new Set(['claude', 'codex']);
// Cheapest viable chain when budget is exhausted.
const CHEAP_FALLBACK = ['hermes', 'gemini', 'openai'];

/**
 * Compute just the LEAD executors for a task (no safety tail). Used by the
 * existing preferredBackend() so its observable chain stays behavior-preserving.
 * @param {{task_type?: string, budget_state?: 'ok'|'over', quality_target?: 'normal'|'high'}} opts
 * @returns {string[]}
 */
export function executorLead({ task_type = 'default', budget_state = 'ok', quality_target = 'normal' } = {}) {
  let lead = [...(TASK_LEAD[task_type] || TASK_LEAD.default)];

  // A high quality bar forces a Claude lead (nuance/brand voice/accuracy).
  if (quality_target === 'high' && lead[0] !== 'claude') {
    lead = ['claude', ...lead];
  }

  // Over budget: drop expensive executors; fall back to the cheap chain if empty.
  if (budget_state === 'over') {
    lead = lead.filter((b) => !EXPENSIVE.has(b));
    if (lead.length === 0) lead = [...CHEAP_FALLBACK];
  }

  return [...new Set(lead)];
}

/**
 * The full ordered executor chain for a task, including the hermes/openai safety
 * tail. This is the primary API for new callers (quality gate, GMB agent).
 * @param {{task_type?: string, budget_state?: 'ok'|'over', quality_target?: 'normal'|'high'}} opts
 * @returns {string[]}
 */
export function pick_executor(opts = {}) {
  const lead = executorLead(opts);
  return [...new Set([...lead, 'hermes', 'openai'])];
}

// Agents that need a Claude lead (Hermes = gpt-5.4-mini is too small for these).
// Mirrors COMPLEX_AGENTS in the runner so delegation preserves today's routing.
const COMPLEX_AGENTS = new Set(['blog-writer', 'strategy', 'editorial-review', 'system-reliability']);

/**
 * Map an agent slug (+ optional mode) to a task_type, so per-agent routing can
 * delegate to the router without changing observable backend order.
 * @param {string} agentSlug
 * @param {string} [mode] - 'blog' | 'default' | ...
 * @returns {string}
 */
export function taskTypeForAgent(agentSlug, mode) {
  if (mode === 'blog') return 'blog';
  // Complex agents -> long_form (Claude lead); everything else -> default
  // (Hermes lead). This reproduces the existing preferredBackend leads exactly.
  return COMPLEX_AGENTS.has(agentSlug) ? 'long_form' : 'default';
}
