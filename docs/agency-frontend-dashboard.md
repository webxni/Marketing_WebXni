# AI Agency Dashboard

Route: `/agency`

Sidebar label: AI Agency

The dashboard shows:

- overview cards for agents, tasks, approvals, designer assets, failed jobs, research, posts, and blogs
- agent status cards with backend, progress, and Run Now controls
- weekly agency timeline
- task board
- approval pipeline
- client coverage table
- findings panel
- Claude skills panel
- harness flow panel
- recent redacted logs

Run Now buttons call protected Worker endpoints. They enqueue fixed approved command jobs and never call shell directly.
