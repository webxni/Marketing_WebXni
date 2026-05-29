#!/usr/bin/env node
/**
 * WebXni Agency Heartbeat Daemon
 * Runs continuously (managed by PM2 as webxni-agency-heartbeat).
 * Every HEARTBEAT_INTERVAL_MINUTES (default 30) it calls /internal/agency/stale-check,
 * logs the result, and prints a Discord-friendly summary when agents go stale.
 *
 * Setup:
 *   pm2 start scripts/run-agency-heartbeat-daemon.mjs --name webxni-agency-heartbeat
 *   pm2 save
 *
 * Disable:
 *   pm2 stop webxni-agency-heartbeat
 */

import { redactSecrets } from './lib/agency-redaction.mjs';

const API_BASE_URL   = process.env.API_BASE_URL        || 'https://marketing.webxni.com';
const BOT_SECRET     = process.env.DISCORD_BOT_SECRET  || '';
const INTERVAL_MIN   = Math.max(1, parseInt(process.env.HEARTBEAT_INTERVAL_MINUTES || '30', 10));

if (!BOT_SECRET) {
  console.error('[heartbeat] DISCORD_BOT_SECRET not set — exiting');
  process.exit(1);
}

async function request(pathname, body = {}) {
  const res = await fetch(`${API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BOT_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '{}');
  if (!res.ok) throw new Error(`${pathname} ${res.status}: ${redactSecrets(text).slice(0, 200)}`);
  return JSON.parse(text);
}

let consecutiveErrors = 0;
const MAX_ERRORS = 5;

async function runCheck() {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    const data = await request('/internal/agency/stale-check');
    consecutiveErrors = 0;

    const { stale_count = 0, failed_count = 0, marked = [], agents = [] } = data;
    const running = agents.filter((a) => a.heartbeat_status === 'running').length;
    const healthy = agents.filter((a) => a.heartbeat_status === 'healthy').length;

    if (stale_count > 0 || failed_count > 0) {
      const list = marked.length > 0 ? ` [${marked.join(', ')}]` : '';
      console.warn(`[heartbeat] ${ts} ALERT stale=${stale_count} failed=${failed_count}${list}`);
    } else {
      console.log(`[heartbeat] ${ts} ok — healthy=${healthy} running=${running} idle=${agents.length - healthy - running}`);
    }
  } catch (err) {
    consecutiveErrors++;
    console.error(`[heartbeat] ${ts} error (${consecutiveErrors}/${MAX_ERRORS}): ${redactSecrets(err.message)}`);
    if (consecutiveErrors >= MAX_ERRORS) {
      console.error('[heartbeat] too many consecutive errors — exiting for PM2 restart');
      process.exit(1);
    }
  }
}

console.log(`[heartbeat] daemon starting — API: ${API_BASE_URL} | interval: ${INTERVAL_MIN}m`);
runCheck();
setInterval(runCheck, INTERVAL_MIN * 60 * 1000);
