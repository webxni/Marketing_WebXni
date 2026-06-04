#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactSecrets } from './lib/agency-redaction.mjs';
import { expandPriority, isBackendAvailable } from './lib/terminal-json-agent.mjs';

const API_BASE_URL = process.env.API_BASE_URL || 'https://marketing.webxni.com';
const BOT_SECRET = process.env.DISCORD_BOT_SECRET || '';
const DB_NAME = process.env.D1_DATABASE_NAME || 'webxni_db';
const APPLY = process.argv.includes('--apply');
const REPAIR_STALE = process.argv.includes('--repair-stale');
const REQUEUE_FAILED = process.argv.includes('--requeue-failed');
const SIMULATE_FALLBACK = process.argv.includes('--simulate-fallback');
const STALE_MINUTES = Number(process.env.AGENCY_STALE_JOB_MINUTES || 90);

const AGENT_BACKEND_PRIORITY = {
  'agency-orchestrator': ['claude_code', 'codex', 'openai'],
  'system-reliability': ['claude_code', 'codex', 'openai'],
  'security-sentinel': ['claude_code', 'codex', 'openai'],
  'client-research': ['gemini_cli', 'openai'],
  strategy: ['claude_code', 'codex', 'openai'],
  'social-copy': ['claude_code', 'codex', 'openai'],
  'blog-writer': ['claude_code', 'codex', 'openai'],
  'editorial-review': ['claude_code', 'codex', 'openai'],
};

const COMMAND_WHITELIST = {
  weekly_content_terminal: 'scripts/run-approved-terminal-job.mjs',
  regenerate_content_terminal: 'scripts/run-approved-terminal-job.mjs',
  weekly_content_claude: 'scripts/run-approved-terminal-job.mjs',
  regenerate_content_claude: 'scripts/run-approved-terminal-job.mjs',
  agency_system_review: 'scripts/run-approved-agency-job.mjs',
  agency_security_review: 'scripts/run-approved-agency-job.mjs',
  agency_client_research: 'scripts/run-approved-agency-job.mjs',
  agency_strategy: 'scripts/run-approved-agency-job.mjs',
  agency_social_generation: 'scripts/run-approved-agency-job.mjs',
  agency_blog_generation: 'scripts/run-approved-agency-job.mjs',
  agency_editorial_review: 'scripts/run-approved-agency-job.mjs',
  agency_orchestrator: 'scripts/run-approved-agency-job.mjs',
  agency_client_onboarding: 'scripts/run-approved-agency-job.mjs',
};

function ok(label, detail = '') {
  console.log(`OK   ${label}${detail ? `: ${detail}` : ''}`);
}

function warn(label, detail = '') {
  console.warn(`WARN ${label}${detail ? `: ${detail}` : ''}`);
}

function fail(label, detail = '') {
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

function commandVersion(cmd) {
  const res = spawnSync(cmd, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) return null;
  return (res.stdout || res.stderr || '').trim().split('\n')[0] || 'available';
}

async function request(pathname, options = {}) {
  const res = await fetch(`${API_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BOT_SECRET}`,
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`${pathname} ${res.status}: ${redactSecrets(text).slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

async function post(pathname, body = {}) {
  return request(pathname, { method: 'POST', body: JSON.stringify(body) });
}

function inspectLocalHarness() {
  console.log('\nLocal harness');
  if (process.cwd().endsWith('Marketing_WebXni')) ok('repo root', process.cwd());
  else warn('repo root', `current directory is ${process.cwd()}`);

  for (const [commandName, script] of Object.entries(COMMAND_WHITELIST)) {
    if (existsSync(join(process.cwd(), script))) ok(`whitelist ${commandName}`, script);
    else fail(`whitelist ${commandName}`, `${script} missing`);
  }

  const pm2 = spawnSync('pm2', ['jlist'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (pm2.status === 0) {
    try {
      const rows = JSON.parse(pm2.stdout || '[]');
      const bot = rows.find((p) => p.name === 'webxni-bot');
      const hb = rows.find((p) => p.name === 'webxni-agency-heartbeat');
      if (bot) ok('pm2 webxni-bot', bot.pm2_env?.status || 'unknown');
      else warn('pm2 webxni-bot', 'not found');
      if (hb) ok('pm2 webxni-agency-heartbeat', hb.pm2_env?.status || 'unknown');
      else warn('pm2 webxni-agency-heartbeat', 'not found');
    } catch (err) {
      warn('pm2 parse', err instanceof Error ? err.message : String(err));
    }
  } else {
    warn('pm2', 'not available from this shell');
  }

  for (const cmd of ['claude', 'gemini', 'codex', 'npx']) {
    const version = commandVersion(cmd);
    if (version) ok(`${cmd} command`, version);
    else warn(`${cmd} command`, 'not available');
  }

  ok('DISCORD_BOT_SECRET', BOT_SECRET ? 'set (redacted)' : 'missing');
  ok('OPENAI_API_KEY', process.env.OPENAI_API_KEY ? 'set (redacted)' : 'not set locally; runner may load from KV');
  ok('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY ? 'set (redacted)' : 'not set');
  ok('AGENCY_EXECUTE_AI', process.env.AGENCY_EXECUTE_AI === '1' ? 'enabled' : 'disabled');
  ok('AGENCY_ALLOW_DRAFT_POSTS', process.env.AGENCY_ALLOW_DRAFT_POSTS === '1' ? 'enabled' : 'disabled');

  for (const [slug, priority] of Object.entries(AGENT_BACKEND_PRIORITY)) {
    try {
      ok(`backend priority ${slug}`, expandPriority(priority).join(' -> '));
    } catch (err) {
      warn(`backend priority ${slug}`, redactSecrets(err instanceof Error ? err.message : String(err)));
    }
  }

  if (SIMULATE_FALLBACK) {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = original || 'redacted-test-key';
    const available = ['missing-primary', 'openai'].filter(isBackendAvailable);
    ok('fallback simulation', available.includes('openai') ? 'OpenAI fallback would be selected after primary failure' : 'OpenAI fallback unavailable');
    if (original === undefined) delete process.env.OPENAI_API_KEY;
  }
}

function repairSql() {
  const cutoff = Math.floor(Date.now() / 1000) - STALE_MINUTES * 60;
  const statements = [];
  if (REPAIR_STALE) {
    statements.push(
      `UPDATE approved_command_jobs SET status='failed', error_log=COALESCE(error_log, 'Harness doctor: stale running/claimed job exceeded ${STALE_MINUTES} minutes'), completed_at=unixepoch(), updated_at=unixepoch() WHERE command_name LIKE 'agency_%' AND status IN ('claimed','running') AND updated_at < ${cutoff};`,
      `UPDATE agent_tasks SET status='failed', progress=100, finished_at=unixepoch(), updated_at=unixepoch() WHERE status='running' AND updated_at < ${cutoff};`,
      `UPDATE agent_runs SET status='failed', finished_at=unixepoch(), duration_ms=CASE WHEN started_at IS NOT NULL THEN (unixepoch() - started_at) * 1000 ELSE duration_ms END, error=COALESCE(error, 'Harness doctor: stale run exceeded ${STALE_MINUTES} minutes') WHERE status='running' AND started_at < ${cutoff};`,
      `UPDATE agent_definitions SET heartbeat_status='failed', heartbeat_message='Harness doctor marked stale running state failed', last_error=COALESCE(last_error, 'Harness doctor stale running state'), current_task=NULL, status='failed', updated_at=unixepoch() WHERE slug IN (SELECT agent_slug FROM agent_tasks WHERE status='failed' AND updated_at >= ${cutoff});`,
    );
  }
  if (REQUEUE_FAILED) {
    statements.push(
      `INSERT INTO approved_command_jobs (id, generation_run_id, command_name, provider, requested_by, args_json, status, created_at, updated_at)
       SELECT lower(hex(randomblob(16))), generation_run_id, command_name, provider, 'harness_doctor_requeue', args_json, 'queued', unixepoch(), unixepoch()
       FROM approved_command_jobs
       WHERE command_name LIKE 'agency_%' AND status='failed' AND updated_at >= ${cutoff};`,
    );
  }
  return statements;
}

function maybeApplyRepair(statements) {
  if (!statements.length) return;
  const path = `/tmp/webxni-agency-harness-repair-${Date.now()}.sql`;
  writeFileSync(path, `${statements.join('\n')}\n`);
  warn('repair SQL generated', path);
  if (!APPLY) {
    warn('repair mode', 'dry-run only; pass --apply to execute with wrangler');
    return;
  }
  const res = spawnSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', `--file=${path}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status === 0) ok('repair applied', redactSecrets(res.stdout).slice(0, 1000));
  else fail('repair apply failed', redactSecrets(`${res.stderr}\n${res.stdout}`).slice(0, 1500));
}

async function inspectRemoteHarness() {
  console.log('\nRemote harness');
  if (!BOT_SECRET) {
    fail('internal endpoint auth', 'DISCORD_BOT_SECRET missing');
    return;
  }
  const status = await post('/internal/agency/status');
  ok('Worker internal status', status.ok ? 'reachable' : 'unexpected response');
  const health = await post('/internal/agency/stale-check');
  ok('heartbeat stale-check', `stale=${health.stale_count ?? 0}, failed=${health.failed_count ?? 0}`);
  const snapshotRes = await post('/internal/agency/snapshot');
  const snapshot = snapshotRes.snapshot;
  ok('approved_command_jobs access', `${snapshot.approved_jobs.length} recent harness jobs visible`);
  ok('dashboard overview', JSON.stringify(snapshot.overview));

  const queued = snapshot.approved_jobs.filter((j) => j.status === 'queued');
  const running = snapshot.approved_jobs.filter((j) => ['claimed', 'running'].includes(j.status));
  const failed = snapshot.approved_jobs.filter((j) => j.status === 'failed');
  if (queued.length) warn('queued jobs', queued.map((j) => `${j.command_name}:${j.id.slice(0, 8)}`).join(', '));
  if (running.length) warn('running/claimed jobs', running.map((j) => `${j.command_name}:${j.id.slice(0, 8)}`).join(', '));
  if (failed.length) warn('failed jobs', failed.map((j) => `${j.command_name}:${j.id.slice(0, 8)}`).join(', '));

  for (const agent of snapshot.agents) {
    const expected = AGENT_BACKEND_PRIORITY[agent.slug];
    if (!expected) continue;
    const priority = agent.backend_priority || '';
    const mismatch = agent.default_backend !== expected[0] || !expected.every((p) => priority.includes(p));
    if (mismatch) warn(`backend mismatch ${agent.slug}`, `db=${agent.default_backend} priority=${priority}`);
  }
}

async function main() {
  console.log('WebXni AI Agency Harness Doctor');
  console.log(`API: ${API_BASE_URL}`);
  inspectLocalHarness();
  try {
    await inspectRemoteHarness();
  } catch (err) {
    fail('remote harness', redactSecrets(err instanceof Error ? err.message : String(err)));
  }
  maybeApplyRepair(repairSql());
}

main().catch((err) => {
  fail('doctor crashed', redactSecrets(err instanceof Error ? err.stack || err.message : String(err)));
  process.exit(1);
});
