#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENCY_AGENT_COMMANDS } from './lib/agency-harness-contract.mjs';
import { redactSecrets } from './lib/agency-redaction.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
const API_BASE_URL = (process.env.API_BASE_URL || 'https://marketing.webxni.com').replace(/\/$/, '');
const BOT_SECRET = process.env.DISCORD_BOT_SECRET || '';
const RUNNER_ID = process.env.DISCORD_RUNNER_ID || `${hostname()}:approved-job-poller`;
const POLL_INTERVAL_MS = Math.max(2_000, Number(process.env.APPROVED_JOB_POLL_MS || 10_000));
const MAX_CONCURRENT_JOBS = Math.max(1, Math.min(4, Number(process.env.MAX_CONCURRENT_APPROVED_JOBS || 1)));
const RUN_ONCE = process.argv.includes('--once');
const PROBE_ONLY = process.argv.includes('--probe');

export const APPROVED_JOB_SCRIPTS = Object.freeze({
  weekly_content_terminal: 'run-approved-terminal-job.mjs',
  regenerate_content_terminal: 'run-approved-terminal-job.mjs',
  weekly_content_claude: 'run-approved-terminal-job.mjs',
  regenerate_content_claude: 'run-approved-terminal-job.mjs',
  ...Object.fromEntries(Object.values(AGENCY_AGENT_COMMANDS).map((command) => [command, 'run-approved-agency-job.mjs'])),
});

function validateConfig() {
  if (!BOT_SECRET) throw new Error('DISCORD_BOT_SECRET is required');
  if (!/^https:\/\//.test(API_BASE_URL)) throw new Error('API_BASE_URL must use https');
}

async function postInternal(pathname, body = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BOT_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) throw new Error(`${pathname} ${response.status}: ${redactSecrets(raw).slice(0, 500)}`);
  return data;
}

export function approvedScriptFor(commandName) {
  const filename = APPROVED_JOB_SCRIPTS[commandName];
  return filename ? join(SCRIPT_DIR, filename) : '';
}

export function buildChildArgs(job) {
  const scriptPath = approvedScriptFor(job?.command_name);
  if (!scriptPath) throw new Error(`Unapproved command: ${String(job?.command_name || '')}`);
  return [
    scriptPath,
    '--job-id', String(job.id),
    '--runner-id', RUNNER_ID,
    '--api-base-url', API_BASE_URL,
  ];
}

async function runApprovedJob(job) {
  const args = buildChildArgs(job);
  const commandLine = `node ${relative(PROJECT_ROOT, args[0])} --job-id ${job.id}`;
  await postInternal(`/internal/discord/approved-jobs/${job.id}/start`, { command_line: commandLine });

  console.log(`[poller] starting ${job.id} (${job.command_name})`);
  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      API_BASE_URL,
      DISCORD_BOT_SECRET: BOT_SECRET,
      DISCORD_RUNNER_ID: RUNNER_ID,
    },
  });

  return new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Approved job ${job.id} exited ${code ?? signal ?? 'unknown'}`));
    });
  });
}

let inFlight = 0;
let stopping = false;

async function pollOnce() {
  if (stopping || inFlight >= MAX_CONCURRENT_JOBS) return false;
  const claimed = await postInternal('/internal/discord/approved-jobs/claim', { runner_id: RUNNER_ID });
  if (!claimed.job) return false;
  inFlight += 1;
  runApprovedJob(claimed.job)
    .catch((error) => console.error(`[poller] ${redactSecrets(error.stack || error.message)}`))
    .finally(() => { inFlight -= 1; });
  return true;
}

async function probe() {
  const response = await postInternal('/internal/agency/snapshot', {});
  console.log(`[poller] probe ok; runner=${RUNNER_ID}; agents=${response?.snapshot?.agents?.length ?? 'unknown'}`);
}

async function main() {
  validateConfig();
  if (PROBE_ONLY) {
    await probe();
    return;
  }
  console.log(`[poller] ready; runner=${RUNNER_ID}; interval_ms=${POLL_INTERVAL_MS}; concurrency=${MAX_CONCURRENT_JOBS}`);
  if (RUN_ONCE) {
    const claimed = await pollOnce();
    while (inFlight > 0) await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    console.log(`[poller] once complete; claimed=${claimed ? 1 : 0}`);
    return;
  }
  while (!stopping) {
    try {
      await pollOnce();
    } catch (error) {
      console.error(`[poller] claim error: ${redactSecrets(error.stack || error.message)}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_INTERVAL_MS));
  }
  while (inFlight > 0) await new Promise((resolveWait) => setTimeout(resolveWait, 250));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    console.log(`[poller] received ${signal}; waiting for ${inFlight} in-flight job(s)`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(redactSecrets(error.stack || error.message));
    process.exitCode = 1;
  });
}

