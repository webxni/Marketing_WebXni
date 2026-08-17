export const AGENCY_AGENT_COMMANDS = {
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
} as const;

export type AgencyAgentSlug = keyof typeof AGENCY_AGENT_COMMANDS;

export const AGENCY_BACKEND_PRIORITY: Record<AgencyAgentSlug, string[]> = {
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
};

export const DEFAULT_AGENCY_SAFETY = {
  no_arbitrary_shell: true,
  preserve_marvin_approval: true,
  preserve_designer_gate: true,
  no_auto_publish: true,
} as const;

export function commandForAgent(agentSlug: string): string {
  return AGENCY_AGENT_COMMANDS[agentSlug as AgencyAgentSlug] ?? '';
}

export function backendPriorityForAgent(agentSlug: string): string[] {
  return AGENCY_BACKEND_PRIORITY[agentSlug as AgencyAgentSlug] ?? ['hermes', 'openai'];
}

export function agencySafety(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...DEFAULT_AGENCY_SAFETY, ...overrides };
}
