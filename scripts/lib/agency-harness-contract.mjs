export const AGENCY_AGENT_COMMANDS = Object.freeze({
  'agency-orchestrator': 'agency_orchestrator',
  'system-reliability': 'agency_system_review',
  'security-sentinel': 'agency_security_review',
  'client-research': 'agency_client_research',
  strategy: 'agency_strategy',
  'social-copy': 'agency_social_generation',
  'blog-writer': 'agency_blog_generation',
  'editorial-review': 'agency_editorial_review',
  'client-onboarding': 'agency_client_onboarding',
  'gmb-rank': 'agency_gmb_rank',
});

export const AGENCY_BACKEND_PRIORITY = Object.freeze({
  'agency-orchestrator': ['hermes', 'claude_code', 'openai'],
  'system-reliability': ['hermes', 'claude_code', 'openai'],
  'security-sentinel': ['hermes', 'claude_code', 'openai'],
  'client-research': ['hermes', 'gemini_cli', 'openai'],
  strategy: ['hermes', 'claude_code', 'openai'],
  'social-copy': ['hermes', 'claude_code', 'openai'],
  'blog-writer': ['hermes', 'claude_code', 'openai'],
  'editorial-review': ['hermes', 'claude_code', 'openai'],
  'client-onboarding': ['hermes', 'claude_code', 'openai'],
  'gmb-rank': ['hermes', 'openai'],
});

export const DEFAULT_AGENCY_SAFETY = Object.freeze({
  no_arbitrary_shell: true,
  preserve_marvin_approval: true,
  preserve_designer_gate: true,
  no_auto_publish: true,
});

export const REQUIRED_AGENCY_AGENT_SLUGS = Object.freeze(Object.keys(AGENCY_AGENT_COMMANDS));

export function commandForAgent(agentSlug) {
  return AGENCY_AGENT_COMMANDS[agentSlug] || '';
}

export function backendPriorityForAgent(agentSlug) {
  return AGENCY_BACKEND_PRIORITY[agentSlug] || ['hermes', 'openai'];
}

export function agencySafety(overrides = {}) {
  return Object.freeze({ ...DEFAULT_AGENCY_SAFETY, ...overrides });
}
