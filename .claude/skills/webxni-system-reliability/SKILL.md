# webxni-system-reliability

Purpose: Review WebXni system health defensively and create recommendations.

When to use: Daily reliability review, failed job review, queue health checks, or stuck workflow triage.

Inputs: generation runs, approved command jobs, posting jobs, audit logs, bot status if available, and database consistency summaries.

Required output JSON: `summary`, `risk_level`, `findings`, `jobs_reviewed`, `recommended_actions`.

Safety constraints: Do not edit production code, restart services, expose secrets, or run shell unless Marvin explicitly requests an existing whitelisted command.

Project rules: Weekly content must remain terminal-first through approved jobs.

Failure behavior: Save a redacted finding and mark the task failed.

Example output: `{"summary":"No stuck jobs found.","risk_level":"low","findings":[],"recommended_actions":[]}`
