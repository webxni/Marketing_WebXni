# AI Agency Discord Commands

Implemented slash commands:

- `/agency-status`
- `/agency-run agent:<orchestrator|system|security|research|strategy|social|blog|editorial>`

Planned commands:

- `/agency-week`
- `/agency-research client:<optional>`
- `/agency-security`
- `/agency-system`
- `/agency-review`
- `/agency-plan`
- `/agency-help`

The current foundation adds safe approved command names and a fixed runner placeholder. `/agency-run` queues jobs through `approved_command_jobs`; the runner records a safe placeholder result until agent-specific prompts are added.

Natural-language gateway bot triggers:

- `webxni, run agency status`
- `webxni, show this week's agency progress`
- `webxni, run system review`
- `webxni, run security check`
- `webxni, run client research`
- `webxni, create weekly strategy`
- `webxni, generate social drafts`
- `webxni, generate blog drafts`
- `webxni, run editorial review`
- `webxni, continue weekly agency workflow`

Supported command names in the approved queue:

- `agency_status`
- `agency_system_review`
- `agency_security_review`
- `agency_client_research`
- `agency_strategy`
- `agency_social_generation`
- `agency_blog_generation`
- `agency_editorial_review`
- `agency_orchestrator`

Safety limit: Discord never sends shell text. The bot maps each command name to `scripts/run-approved-agency-job.mjs`.
