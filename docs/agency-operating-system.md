# WebXni AI Agency Operating System

The AI Agency OS is an additive control layer for WebXni. It tracks first-class agents, queued tasks, findings, client coverage, and the approved terminal harness without replacing existing post generation, approvals, designer media delivery, or posting automation.

## Operating Model

1. Marvin, Discord, or a schedule requests agency work.
2. The Worker validates the request and maps it to a fixed agent slug.
3. The Worker creates an `approved_command_jobs` row with a fixed `command_name`.
4. The local Discord bot claims the job and runs a whitelisted script.
5. The script records task/run/log state and, in later phases, invokes the agent-specific AI backend with a JSON schema.
6. Outputs are stored as tasks, findings, research notes, strategy plans, review notes, or ordinary draft content.
7. Marvin approval and designer media delivery remain mandatory before automation posts.

## Current Phase

This foundation includes the `/agency` dashboard, database records, redacted APIs, fixed agency command names, protected save endpoints, and a conservative approved runner. The runner reads live platform status and writes structured task output/findings by default. Agent-specific terminal AI execution is available only when `AGENCY_EXECUTE_AI=1`; draft post creation also requires `AGENCY_ALLOW_DRAFT_POSTS=1`.

## Gates

Agents must never mark posts as Marvin-approved, mark `asset_delivered`, set `ready_for_automation`, schedule posts, publish WordPress blogs, or run arbitrary shell.

## Quick Disable

Set `AGENCY_ENABLED=false` in the bot environment and avoid using `/agency` Run Now buttons. Keep `AGENCY_EXECUTE_AI`, `AGENCY_ALLOW_DRAFT_POSTS`, and `AGENCY_SCHEDULER_ENABLED` unset or false. Individual agents can also be disabled by setting `agent_definitions.enabled = 0`.

See `docs/agency-implementation-log.md` for the current deployed state and next phases.
