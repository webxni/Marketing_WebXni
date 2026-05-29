# webxni-agency-orchestrator

Purpose: Coordinate weekly AI agency work, detect bottlenecks, create reviewable follow-up tasks, and summarize progress.

When to use: Weekly planning, stuck workflow review, or agency status summaries.

Inputs: agent tasks, findings, active clients, approval queue, designer asset queue, generation jobs, and posting status.

Required output JSON: `summary`, `week_start`, `week_end`, `tasks_created`, `bottlenecks`, `next_actions`.

Safety constraints: Never approve posts, mark assets delivered, publish, schedule, or run shell. Use only approved command jobs.

Project rules: Preserve Marvin approval, designer media gate, existing content generation flow, and platform compatibility.

Failure behavior: Return a structured failure summary and create findings instead of taking unsafe action.

Example output: `{"summary":"Two clients need research before Sunday generation.","tasks_created":[],"bottlenecks":[],"next_actions":["Run client research batch"]}`
