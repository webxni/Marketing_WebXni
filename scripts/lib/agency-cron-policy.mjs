export const AGENCY_CRON_POLICY = Object.freeze({
  weekly_package_generation: Object.freeze({
    schedule: '0 7 * * SUN',
    purpose: 'Create next-week package drafts through approved Hermes harness jobs.',
    agents: Object.freeze(['client-research', 'strategy', 'social-copy', 'blog-writer', 'gmb-rank', 'editorial-review']),
    creates_content: true,
    may_publish: false,
  }),
  daily_package_gap_recovery: Object.freeze({
    schedule: '30 6 * * MON-FRI',
    purpose: 'Detect missing package slots for the active week and queue safe draft recovery jobs.',
    agents: Object.freeze(['agency-orchestrator', 'social-copy', 'blog-writer', 'editorial-review']),
    creates_content: true,
    may_publish: false,
  }),
  editorial_review_sweep: Object.freeze({
    schedule: '0 8,13,17 * * MON-FRI',
    purpose: 'Review newly created drafts and write content_review_notes without approving them.',
    agents: Object.freeze(['editorial-review']),
    creates_content: false,
    may_publish: false,
  }),
  harness_health_watchdog: Object.freeze({
    schedule: '*/15 * * * *',
    purpose: 'Mark stuck jobs, heartbeat active runners, and alert on failed/stale agents.',
    agents: Object.freeze(['system-reliability']),
    creates_content: false,
    may_publish: false,
  }),
  daily_agency_report: Object.freeze({
    schedule: '0 9 * * MON-FRI',
    purpose: 'Send a concise Discord report: created drafts, blockers, review count, failed jobs, next action.',
    agents: Object.freeze(['agency-orchestrator']),
    creates_content: false,
    may_publish: false,
  }),
});

export function cronPolicyEntries() {
  return Object.entries(AGENCY_CRON_POLICY).map(([key, value]) => ({ key, ...value }));
}

export function isPublishCapableCron(key) {
  return Boolean(AGENCY_CRON_POLICY[key]?.may_publish);
}
