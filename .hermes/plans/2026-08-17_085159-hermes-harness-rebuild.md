# Hermes Harness Rebuild Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rebuild the Marketing_WebXni Hermes/agency harness so AI agent jobs reliably create package drafts, review them, preserve Marvin/designer gates, and finish with zero type/test/runtime errors.

**Architecture:** Keep the existing business logic and safety gates, but replace the fragile harness surface with a typed, testable pipeline: plan → queue approved job → run Hermes/terminal backend → validate output → persist drafts/reviews → report health. Do not auto-approve, auto-publish, bypass governance, or use raw secrets in chat/logs.

**Tech Stack:** Cloudflare Worker + Hono + D1, Node scripts, Svelte dashboard, approved_command_jobs queue, local bot runner, Hermes CLI/terminal agent backend.

---

## Current Context

The current system has the right logic but inconsistent execution:

- Locksmith weekly package schedule expects Monday `video`, Tuesday `image`, Wednesday `reel`, Thursday `image + blog`, Friday `reel`.
- Live issue confirmed: 0 locksmith posts existed for the current week until manual recovery created Monday video drafts.
- Editorial Review Agent initially reviewed `0` because no current-week drafts existed; after manual draft creation it reviewed 4 drafts successfully.
- Governance is necessary and must stay:
  - Generated posts stay `draft` or `pending_approval`, never directly `ready` unless explicitly approved and assets pass gates.
  - Marvin approval is preserved.
  - Designer asset gate is preserved.
  - Media rights gate is preserved.
  - Locksmith identity/destination governance is preserved.
- A validator bug was fixed and pushed: approved multi-word locations like `North Hollywood` should not be blocked as unapproved `Hollywood`.
- Cloudflare token/passwords were exposed in chat previously; do not reuse them. Require rotated secrets installed as env vars or Cloudflare secrets.

---

## Non-Negotiable Rules

1. **No auto-publishing.** Harness may create drafts and review notes only.
2. **No gate bypass.** Do not set `ready_for_automation=1`, `asset_delivered=1`, or `asset_rights_confirmed=1` unless the normal app flow proves those gates.
3. **No secrets in logs/chat.** Tokens/passwords must come from env/KV/secret storage and be redacted from output.
4. **No new DB columns unless absolutely required.** If needed, use migrations only.
5. **All SQL via `worker/src/db/queries.ts`.** No string-interpolated SQL.
6. **Every change must be covered by tests and verified with real commands.**
7. **Deploy only after green tests/typecheck.**

---

## Phase 0 — Baseline and Safety Snapshot

### Task 0.1: Capture current git and test baseline

**Objective:** Know exactly what is broken before changing the harness.

**Files:**
- Read only: repo root, `worker/`, `scripts/`, `discord-bot/`

**Commands:**

```bash
cd /home/webxni-ms/Marketing_WebXni
git status --short
git log --oneline -5
cd worker
npm ci
npm test -- src/modules/editorial-governance.test.ts
npm run typecheck
```

**Expected:**
- Working tree status documented.
- Existing tests/typecheck pass or failures are captured before edits.

**Do not proceed** until baseline output is saved in the task notes.

---

### Task 0.2: Inventory current harness paths

**Objective:** Identify every file involved in agency/Hermes approved job execution.

**Likely files:**
- `worker/src/routes/agency.ts`
- `worker/src/routes/discord.ts`
- `worker/src/loader/agency-scheduler.ts`
- `worker/src/loader/autonomous-content.ts`
- `worker/src/db/queries.ts`
- `worker/src/types.ts`
- `scripts/run-approved-agency-job.mjs`
- `scripts/run-approved-terminal-job.mjs`
- `scripts/run-agency-heartbeat-daemon.mjs`
- `scripts/lib/agency-agent-prompts.mjs`
- `scripts/lib/terminal-json-agent.mjs`
- `scripts/lib/executor-router.mjs`
- `scripts/lib/agency-review-evidence.mjs`
- `discord-bot/bot.js`

**Commands:**

```bash
cd /home/webxni-ms/Marketing_WebXni
grep -R "agency_editorial_review\|approved_command_jobs\|run-approved-agency-job\|AGENT_COMMANDS\|Hermes" -n worker/src scripts discord-bot | tee /tmp/harness-inventory.txt
```

**Expected:**
- Complete list of harness entry points.
- No code changes.

---

## Phase 1 — Define Harness Contract

### Task 1.1: Add a typed agency job contract module

**Objective:** Centralize agent slugs, command names, safety flags, and allowed output shapes.

**Files:**
- Create: `scripts/lib/agency-harness-contract.mjs`
- Test: `scripts/lib/agency-harness-contract.test.mjs`

**Contract should include:**

```js
export const AGENCY_AGENT_COMMANDS = Object.freeze({
  'agency-orchestrator': 'agency_orchestrator',
  'client-research': 'agency_client_research',
  'content-strategy': 'agency_content_strategy',
  'social-copy': 'agency_social_copy',
  'blog-writer': 'agency_blog_writer',
  'editorial-review': 'agency_editorial_review',
  'gmb-rank': 'agency_gmb_rank',
  'client-onboarding': 'agency_client_onboarding',
  'system-reliability': 'agency_system_reliability',
  'security-sentinel': 'agency_security_sentinel',
});

export const DEFAULT_SAFETY = Object.freeze({
  no_arbitrary_shell: true,
  preserve_marvin_approval: true,
  preserve_designer_gate: true,
  no_auto_publish: true,
});
```

**Test cases:**
- Every command name starts with `agency_`.
- Every required agent slug exists.
- Safety defaults include the four required guards.

**Commands:**

```bash
node --test scripts/lib/agency-harness-contract.test.mjs
```

**Expected:** pass.

---

### Task 1.2: Replace duplicate command maps with the shared contract

**Objective:** Stop route/scheduler/bot drift where one file knows a command and another does not.

**Files:**
- Modify: `worker/src/routes/agency.ts`
- Modify: `worker/src/routes/discord.ts`
- Modify: `worker/src/loader/agency-scheduler.ts`
- Modify: `scripts/run-approved-agency-job.mjs`

**Approach:**
- If Worker cannot import from `scripts/`, duplicate the contract in `worker/src/modules/agency-contract.ts` and add tests that compare both maps via a JSON snapshot script.
- Prefer one canonical generated JSON file if bundling allows it.

**Verification:**

```bash
cd worker
npm run typecheck
cd ..
node --test scripts/lib/agency-harness-contract.test.mjs
```

---

## Phase 2 — Make Package Draft Creation Deterministic

### Task 2.1: Extract package-slot selection into a pure function

**Objective:** Given client package + week date, return exact required slots without DB/API side effects.

**Files:**
- Modify: `scripts/lib/agency-package-slots.mjs`
- Test: `scripts/lib/agency-package-slots.test.mjs`

**Required test:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { packageSlots } from './agency-package-slots.mjs';

test('medium locksmith package returns Monday video slot', () => {
  const slots = packageSlots({
    clientId: 'client-1',
    packageSlug: 'medium',
    weeklySchedule: { monday: ['video'], tuesday: ['image'], wednesday: ['reel'], thursday: ['image', 'blog'], friday: ['reel'] },
    weekStart: '2026-08-17',
  });

  assert.equal(slots[0].content_type, 'video');
  assert.equal(slots[0].publish_date.slice(0, 10), '2026-08-17');
  assert.match(slots[0].automation_slot_key, /2026-08-17:video:0$/);
});
```

**Command:**

```bash
node --test scripts/lib/agency-package-slots.test.mjs
```

---

### Task 2.2: Add an idempotent draft upsert helper

**Objective:** Ensure missing package slots are created once, not duplicated, and always with safe draft gates.

**Files:**
- Create or modify: `scripts/lib/agency-draft-upsert.mjs`
- Test: `scripts/lib/agency-draft-upsert.test.mjs`

**Behavior:**
- Input: slot, client brief, generated content.
- If `automation_slot_key` exists, update only safe draft fields if status is editable.
- If missing, create post.
- Always force:

```js
{
  status: 'draft',
  ready_for_automation: 0,
  asset_delivered: 0,
  asset_rights_confirmed: 0,
  scheduled_by_automation: 1,
}
```

**Test cases:**
- Creates missing Monday video draft.
- Does not duplicate existing slot.
- Does not modify `posted` posts.
- Does not set any ready/asset/rights gate to 1.

**Command:**

```bash
node --test scripts/lib/agency-draft-upsert.test.mjs
```

---

### Task 2.3: Wire social-copy/blog-writer to use draft upsert

**Objective:** Weekly agent jobs must produce actual draft rows, not only summaries.

**Files:**
- Modify: `scripts/run-approved-agency-job.mjs`
- Modify if needed: `worker/src/routes/agency.ts` internal draft endpoint

**Implementation rule:**
- If `AGENCY_EXECUTE_AI=0`, job may return plan-only summary.
- If `AGENCY_EXECUTE_AI=1`, job must:
  1. Load package slots.
  2. Generate/normalize content.
  3. Upsert draft rows.
  4. Return created/skipped/blocked counts.

**Verification:**

```bash
AGENCY_EXECUTE_AI=0 node scripts/run-approved-agency-job.mjs --job-id fake --bot-secret fake --api-base-url http://127.0.0.1:8787
```

Expected in dry/fake mode: no secret leakage; if endpoint missing, fails clearly.

---

## Phase 3 — Fix Editorial Review Queue Reliability

### Task 3.1: Add review queue tests for new package drafts

**Objective:** Prove new drafts are visible to Editorial Review Agent.

**Files:**
- Modify or create: `worker/src/db/queries.test.ts` or existing DB query test location
- Modify: `worker/src/db/queries.ts` only if test fails

**Test setup:**
- Insert a post with:
  - `status='draft'`
  - `scheduled_by_automation=1`
  - `created_at` within 14 days
  - `publish_date` this week
  - no current review hash
- Assert `listAgencyReviewQueueCandidates()` returns it.

**Command:**

```bash
cd worker
npm test -- src/db/queries.test.ts
```

---

### Task 3.2: Make review queue report why items are skipped

**Objective:** Avoid “reviewed 0” with no explanation.

**Files:**
- Modify: `worker/src/routes/agency.ts`
- Modify: `scripts/run-approved-agency-job.mjs`

**Add internal endpoint behavior:**
- `/internal/agency/review-queue?debug=1` returns:
  - `items`
  - `skipped_current_review_count`
  - `skipped_old_or_status_count`
  - `candidate_count`

**Verification:**

```bash
cd worker
npm run typecheck
```

**Runtime check after deploy:**

```bash
curl -s -H "Authorization: Bearer $DISCORD_BOT_SECRET" "https://marketing.webxni.com/internal/agency/review-queue?debug=1" | jq .
```

Do not print the secret.

---

## Phase 4 — Governance Preservation

### Task 4.1: Add tests that generated locksmith drafts stay drafts

**Objective:** Prevent future harness changes from sending locksmith content directly to ready/pending incorrectly.

**Files:**
- Modify: `worker/src/modules/editorial-governance.test.ts`
- Add if needed: `scripts/lib/agency-draft-upsert.test.mjs`

**Test assertions:**
- Generated locksmith content with approved location can be saved as draft.
- It is not auto-approved.
- It is not ready for automation.
- It requires designer asset and rights confirmation.

**Command:**

```bash
cd worker
npm test -- src/modules/editorial-governance.test.ts
cd ..
node --test scripts/lib/agency-draft-upsert.test.mjs
```

---

### Task 4.2: Add blocked-governance output instead of silent no-op

**Objective:** If a client cannot generate because destination/research/keywords are blocked, show exact blockers in job output and dashboard logs.

**Files:**
- Modify: `scripts/run-approved-agency-job.mjs`
- Modify: `worker/src/routes/agency.ts` if current readiness data is not exposed internally

**Output shape:**

```json
{
  "client_slug": "724-locksmith-ca",
  "slot": "2026-08-17:video:0",
  "action": "blocked",
  "reasons": ["one or more destinations are not verified"]
}
```

**Verification:**
- Run harness against current locksmith readiness.
- It reports blockers and does not silently skip.

---

## Phase 5 — Harness Runner Health and Error Handling

### Task 5.1: Add structured result envelope

**Objective:** Every approved agency job returns the same top-level shape.

**Files:**
- Modify: `scripts/run-approved-agency-job.mjs`
- Test: `scripts/run-approved-agency-job.test.mjs`

**Shape:**

```json
{
  "ok": true,
  "agent_slug": "social-copy",
  "command_name": "agency_social_copy",
  "created": 4,
  "updated": 0,
  "skipped": 0,
  "blocked": 0,
  "errors": [],
  "safety": {
    "no_auto_publish": true,
    "preserve_marvin_approval": true,
    "preserve_designer_gate": true
  }
}
```

**Test cases:**
- Success has `ok: true`.
- Partial client failure has `ok: false` or `ok: true` with `errors`, depending on severity, but never hides errors.
- Secrets are redacted.

---

### Task 5.2: Improve bot claiming/retry behavior

**Objective:** Jobs should not get stuck as queued/running forever.

**Files:**
- Modify: `discord-bot/bot.js`
- Modify: `scripts/run-agency-heartbeat-daemon.mjs`

**Behavior:**
- Claim job.
- Start heartbeat.
- Extend lease during long operations.
- On exit 0, mark completed with result summary.
- On non-zero, mark failed with redacted error.
- On timeout, mark failed and include timeout reason.

**Verification:**
- Create a fake approved job for a no-op harness command in local/dev DB if available.
- Confirm state transitions: queued → running → completed.

---

## Phase 6 — Autonomous Cron / Scheduler Layer

### Task 6.1: Define autonomous harness cron schedule

**Objective:** The harness should run package generation, review, health checks, and recovery automatically without Marvin manually clicking Run.

**Files:**
- Modify: `worker/src/loader/agency-scheduler.ts`
- Modify: `worker/src/loader/autonomous-content.ts`
- Modify: `wrangler.toml`
- Modify: `scripts/run-agency-heartbeat-daemon.mjs`
- Create: `scripts/lib/agency-cron-policy.mjs`
- Test: `scripts/lib/agency-cron-policy.test.mjs`

**Required cron policy:**

```js
export const AGENCY_CRON_POLICY = Object.freeze({
  weekly_package_generation: {
    schedule: '0 7 * * SUN',
    purpose: 'Create next-week package drafts through approved Hermes harness jobs.',
    agents: ['client-research', 'content-strategy', 'social-copy', 'blog-writer', 'gmb-rank', 'editorial-review'],
  },
  daily_package_gap_recovery: {
    schedule: '30 6 * * MON-FRI',
    purpose: 'Detect missing package slots for the active week and queue safe draft recovery jobs.',
    agents: ['agency-orchestrator', 'social-copy', 'blog-writer', 'editorial-review'],
  },
  editorial_review_sweep: {
    schedule: '0 8,13,17 * * MON-FRI',
    purpose: 'Review newly created drafts and write content_review_notes without approving them.',
    agents: ['editorial-review'],
  },
  harness_health_watchdog: {
    schedule: '*/15 * * * *',
    purpose: 'Mark stuck jobs, heartbeat active runners, and alert on failed/stale agents.',
    agents: ['system-reliability'],
  },
  daily_agency_report: {
    schedule: '0 9 * * MON-FRI',
    purpose: 'Send a concise Discord report: created drafts, blockers, review count, failed jobs, next action.',
    agents: ['agency-orchestrator'],
  },
});
```

**Test cases:**
- Every cron entry has a valid cron expression.
- Every listed agent exists in the shared harness contract.
- No cron has permission to approve/publish posts.
- Watchdog schedule is frequent but does not create content.

**Command:**

```bash
node --test scripts/lib/agency-cron-policy.test.mjs
```

---

### Task 6.2: Add package gap recovery cron

**Objective:** If weekly generation skips a package slot, the system should detect and queue draft recovery automatically.

**Files:**
- Modify: `worker/src/loader/agency-scheduler.ts`
- Modify: `worker/src/db/queries.ts`
- Test: `worker/src/loader/agency-scheduler.test.ts`

**Behavior:**
1. For each active client/package, compute required slots for current week.
2. Query existing posts by `automation_slot_key`.
3. For each missing slot, enqueue an approved command job with:

```json
{
  "source": "daily_package_gap_recovery",
  "mode": "recover_missing_slots",
  "week_start": "YYYY-MM-DD",
  "client_id": "...",
  "missing_slots": ["..."],
  "safety": {
    "no_arbitrary_shell": true,
    "preserve_marvin_approval": true,
    "preserve_designer_gate": true,
    "no_auto_publish": true
  }
}
```

4. Never create posts directly from the scheduler; it only queues approved harness jobs.
5. Deduplicate recovery jobs by `client_id + week_start + slot_key` so the cron does not spam.

**Test cases:**
- Missing Monday video slot queues one recovery job.
- Existing slot queues no job.
- Existing queued recovery job prevents duplicate.
- Posted/ready historical posts do not satisfy the current-week slot unless slot key matches.

**Command:**

```bash
cd worker
npm test -- src/loader/agency-scheduler.test.ts
```

---

### Task 6.3: Add editorial review sweep cron

**Objective:** Newly created drafts should be reviewed automatically after creation.

**Files:**
- Modify: `worker/src/loader/agency-scheduler.ts`
- Modify: `worker/src/routes/agency.ts`

**Behavior:**
- At scheduled review times, check `/internal/agency/review-queue` candidate count.
- If candidate count > 0, enqueue `agency_editorial_review`.
- If candidate count = 0, write a heartbeat log with debug counts, not a failure.
- Never approve posts.

**Verification:**
- Create a local/dev draft candidate.
- Run scheduler handler in test or local worker.
- Confirm one editorial-review approved job is queued.

---

### Task 6.4: Add harness watchdog cron

**Objective:** Prevent silent stuck/failing jobs.

**Files:**
- Modify: `worker/src/loader/agency-scheduler.ts`
- Modify: `scripts/run-agency-heartbeat-daemon.mjs`
- Modify: `scripts/run-approved-agency-job.mjs`

**Behavior:**
- Every 15 minutes:
  - Mark jobs `running` longer than configured lease as stale/failed.
  - Requeue safe idempotent recovery jobs only if they are marked retryable.
  - Write agency log summary.
  - Send Discord alert only when there is a new failure or stale threshold crossed.

**Safety:**
- Watchdog can requeue `editorial-review`, `system-reliability`, and `daily_package_gap_recovery` jobs.
- Watchdog must not requeue anything that might publish.

**Verification:**
- Seed a fake stale running job.
- Run watchdog.
- Confirm it becomes failed/stale with redacted reason.

---

### Task 6.5: Add daily autonomous Discord report

**Objective:** Marvin gets one concise daily message showing whether the harness worked.

**Files:**
- Modify: `worker/src/loader/agency-scheduler.ts`
- Modify: `worker/src/routes/discord.ts`
- Modify: `scripts/run-approved-agency-job.mjs`

**Report format:**

```text
🤖 Agency Harness Daily — YYYY-MM-DD

Created drafts: N
Editorial reviews: N
Missing package slots: N
Failed jobs: N
Governance blockers: N

Locksmith:
- 24/7 Lockout Pasadena: X/Y slots, blockers: ...
- 7/24 Locksmith: X/Y slots, blockers: ...
- Daniel’s: X/Y slots, blockers: ...
- Unlock’D Pros: X/Y slots, blockers: ...

Next action: ...
```

**Rules:**
- No secrets.
- No raw stack traces.
- Use short client-ready wording.
- Report should distinguish **draft exists** vs **waiting Marvin approval** vs **waiting designer asset**.

---

### Task 6.6: Add cron observability to dashboard

**Objective:** Dashboard shows when autonomous harness crons last ran and what they did.

**Files:**
- Modify: `worker/src/routes/agency.ts`
- Modify: `frontend/src/lib/api/agency.ts`
- Modify: relevant Svelte agency dashboard component

**Display fields:**
- Last weekly package generation run.
- Last gap recovery run.
- Last editorial review sweep.
- Last watchdog run.
- Last daily report sent.
- Next scheduled actions.

**Verification:**

```bash
cd worker && npm run typecheck
cd ../frontend && npm run check
```

---

## Phase 7 — Dashboard/Operator Visibility

### Task 7.1: Add harness status details to Agency dashboard API

**Objective:** Marvin should see “missing drafts because X” instead of generic pending.

**Files:**
- Modify: `worker/src/routes/agency.ts`
- Modify: `frontend/src/lib/api/agency.ts`
- Modify: relevant Svelte agency dashboard component

**Display fields:**
- Required package slots this week.
- Created slots.
- Missing slots.
- Governance blockers.
- Last harness job status.
- Last editorial review count.

**Frontend rule:**
- Use existing UI style. No redesign.
- No raw fetch in Svelte component; use API wrapper.

**Verification:**

```bash
cd worker && npm run typecheck
cd ../frontend && npm run check
```

---

## Phase 8 — Deployment

### Task 8.1: Full local verification

**Objective:** No errors before deploy.

**Commands:**

```bash
cd /home/webxni-ms/Marketing_WebXni
node --test scripts/lib/*.test.mjs
cd worker
npm test
npm run typecheck
cd ../frontend
npm run check
npm run build
```

**Expected:** all pass.

---

### Task 8.2: Security scan before commit

**Objective:** Ensure no exposed Cloudflare/SSH/API secrets were committed.

**Commands:**

```bash
cd /home/webxni-ms/Marketing_WebXni
git diff --cached
git diff
grep -R "cfut_\|CLOUDFLARE_API_TOKEN\|password:\|DISCORD_BOT_SECRET\|OPENAI_API_KEY" -n . --exclude-dir=node_modules --exclude-dir=.git || true
```

**Expected:**
- No real tokens/passwords in tracked files.
- Environment variable names are okay; actual values are not.

---

### Task 8.3: Commit and push

**Objective:** Push green harness rebuild to main.

**Commands:**

```bash
cd /home/webxni-ms/Marketing_WebXni
git add worker scripts frontend discord-bot .hermes/plans
git commit -m "Rebuild agency Hermes harness reliability"
git push origin main
```

**Expected:** GitHub Actions deploys from main if configured.

---

### Task 8.4: Deploy safely if GitHub Actions is unavailable

**Objective:** Manual deploy without leaking secrets.

**Prerequisite:** Rotated Cloudflare token is installed in environment, not pasted into chat.

**Commands on deploy host:**

```bash
cd ~/projects/Marketing_WebXni
git pull origin main
cd worker
npm ci
npm run typecheck
npm run deploy
```

**Do not run** if `CLOUDFLARE_API_TOKEN` is missing or was pasted in chat.

---

## Phase 9 — Production Verification

### Task 9.1: Verify harness creates drafts for package slots

**Objective:** Confirm production behavior, not just local tests.

**Steps:**
1. Trigger or queue a controlled agency harness run for a safe client/week.
2. Confirm generated package slots appear as drafts.
3. Confirm no post is ready/published automatically.
4. Confirm review queue sees them.
5. Confirm Editorial Review Agent writes review notes.

**Expected production counters:**
- `posts_generated_this_week` increases.
- `editorial_reviews_this_week` increases after review.
- `waiting_marvin_approval` stays 0 unless a human moves posts there.
- `ready_for_automation` does not increase from draft creation alone.

---

## Acceptance Criteria

The rebuild is complete only when all are true:

- [ ] Weekly package slots are deterministic and tested.
- [ ] Harness creates missing draft slots idempotently.
- [ ] No duplicate posts for the same `automation_slot_key`.
- [ ] Generated drafts preserve Marvin/designer/media rights gates.
- [ ] Editorial Review Agent sees and reviews current generated drafts.
- [ ] Governance blockers are visible in logs/dashboard instead of silent skips.
- [ ] Bot runner reports clear completed/failed status.
- [ ] Autonomous crons are defined, tested, and visible in dashboard.
- [ ] Daily package gap recovery queues safe draft jobs without duplicates.
- [ ] Editorial review sweep reviews drafts automatically and never approves them.
- [ ] Harness watchdog marks stuck jobs and alerts only on meaningful changes.
- [ ] Daily Discord report summarizes drafts, reviews, blockers, and failed jobs without secrets.
- [ ] Worker typecheck passes.
- [ ] Frontend checks/build pass if touched.
- [ ] Script tests pass.
- [ ] No secrets are printed, committed, or reused after exposure.
- [ ] Production verification confirms no auto-publish behavior.

---

## Risks and Mitigations

### Risk: Harness bypasses governance
**Mitigation:** Force draft-safe fields in the upsert helper and test them.

### Risk: Duplicate posts
**Mitigation:** Key all generated slots by `automation_slot_key`; upsert instead of create-only.

### Risk: Editorial review says “0” again
**Mitigation:** Add queue debug counters and DB query tests.

### Risk: Secret leakage
**Mitigation:** Use env/KV only; redaction tests; grep scan before commit.

### Risk: Cloudflare deploy fails because token missing
**Mitigation:** Rely on GitHub Actions if available; otherwise require rotated token set outside chat.

---

## Suggested Implementation Order

1. Baseline.
2. Contract module.
3. Package-slot tests.
4. Draft upsert tests/helper.
5. Wire harness creation path.
6. Editorial review queue tests/debugging.
7. Runner health/error envelope.
8. Dashboard visibility.
9. Full verification.
10. Commit/push/deploy.

Do not skip tests between phases.
