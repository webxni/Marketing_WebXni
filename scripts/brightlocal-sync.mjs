#!/usr/bin/env node
/**
 * BrightLocal Rankings Sync
 * Runs Wednesday 6AM — pulls local ranking data from BrightLocal for all campaigns,
 * compares with previous snapshot, logs improvements/drops, sends Discord summary.
 *
 * Usage: node scripts/brightlocal-sync.mjs [--force]
 *
 * Two BrightLocal trial accounts (1000 req each — use sparingly):
 *   Account 1: ca0abf1edd2c5dc44e1348110070841c2901b1ac
 *   Account 2: 3ce4f73a1e2082f4c908d75f6173fa8231daa215
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const STRATEGY_DIR = join(__dir, 'strategy');
const SNAPSHOT_FILE = join(STRATEGY_DIR, 'brightlocal-snapshot.json');
const LOG_DIR = '/tmp/webxni-orchestrator';

const BRIGHTLOCAL_API = 'https://tools.brightlocal.com/seo-tools/api';
const API_KEYS = [
  { key: 'ca0abf1edd2c5dc44e1348110070841c2901b1ac', label: 'Account 1' },
  { key: '3ce4f73a1e2082f4c908d75f6173fa8231daa215', label: 'Account 2' },
];
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const API_BASE = 'https://marketing.webxni.com';

mkdirSync(STRATEGY_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

const log = (msg) => {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${msg}`;
  console.log(line);
};

async function blPost(path, apiKey, params = {}) {
  const body = new URLSearchParams({ api_key: apiKey, ...params });
  const res = await fetch(`${BRIGHTLOCAL_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` }; }
}

async function blGet(path, apiKey) {
  const res = await fetch(`${BRIGHTLOCAL_API}${path}?api_key=${apiKey}`, {
    headers: { 'Accept': 'application/json' },
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` }; }
}

async function notifyDiscord(title, description, fields = [], color = 'ok') {
  try {
    await fetch(`${API_BASE}/internal/agent/discord-notify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AGENT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, description, fields, color }),
    });
  } catch { /* non-fatal */ }
}

async function main() {
  log('=== BrightLocal Sync ===');

  const prev = existsSync(SNAPSHOT_FILE)
    ? JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'))
    : {};
  const snap = { synced_at: new Date().toISOString(), accounts: {} };

  const summaryLines = [];
  let totalCampaigns = 0;
  let totalImproved = 0;
  let totalDropped = 0;

  for (const { key, label } of API_KEYS) {
    log(`\n── ${label}`);

    // List campaigns
    const campRes = await blPost('/v4/seo-tools/search-rankings/campaign/get-all', key);

    if (campRes.error || campRes.success === false) {
      log(`  ❌ ${campRes.error || campRes.message || 'API error'}`);
      snap.accounts[label] = { error: campRes.error || 'api_error' };
      continue;
    }

    const campaigns = campRes.response?.campaigns || campRes.campaigns || [];
    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      log(`  ℹ️  No campaigns found — set up rank tracking in app.brightlocal.com dashboard first`);
      snap.accounts[label] = { status: 'no_campaigns', note: 'Create campaigns at app.brightlocal.com → SEO Tools → Search Rankings' };
      summaryLines.push(`**${label}**: No campaigns yet — create them at app.brightlocal.com`);
      continue;
    }

    log(`  Found ${campaigns.length} campaign(s)`);
    snap.accounts[label] = { campaigns: [] };

    for (const camp of campaigns) {
      const campId = String(camp.campaign_id || camp.id || '');
      const campName = camp.campaign_name || camp.name || campId;
      totalCampaigns++;

      const rankRes = await blGet(
        `/v4/seo-tools/rankings/search-rankings/get-latest?campaign_id=${campId}`,
        key,
      );

      if (rankRes.error || rankRes.success === false) {
        log(`  ⚠️  ${campName}: ${rankRes.error || 'no data'}`);
        continue;
      }

      const keywords = rankRes.response?.keywords || rankRes.keywords || [];
      const prevCamp = prev.accounts?.[label]?.campaigns?.find?.(c => c.id === campId);
      const prevKws = Object.fromEntries((prevCamp?.keywords || []).map(k => [k.keyword, k]));

      const improved = [];
      const dropped = [];

      for (const kw of keywords) {
        const p = prevKws[kw.keyword];
        if (p?.rank && kw.rank) {
          if (kw.rank < p.rank) improved.push(`"${kw.keyword}" #${p.rank}→#${kw.rank}`);
          else if (kw.rank > p.rank + 3) dropped.push(`"${kw.keyword}" #${p.rank}→#${kw.rank}`);
        }
      }

      totalImproved += improved.length;
      totalDropped += dropped.length;

      log(`  📊 ${campName}: ${keywords.length} keywords`);
      if (improved.length) log(`     📈 Up: ${improved.join(' | ')}`);
      if (dropped.length) log(`     📉 Down: ${dropped.join(' | ')}`);

      snap.accounts[label].campaigns.push({
        id: campId,
        name: campName,
        keywords: keywords.map(k => ({ keyword: k.keyword, rank: k.rank })),
        improved: improved.length,
        dropped: dropped.length,
      });

      if (improved.length || dropped.length) {
        summaryLines.push(`**${campName}**: ${improved.length} up, ${dropped.length} down`);
      }
    }
  }

  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2));
  log(`\n✅ Snapshot saved → scripts/strategy/brightlocal-snapshot.json`);

  // Discord notification
  const hasChanges = totalImproved > 0 || totalDropped > 0;
  const title = hasChanges
    ? `📍 Rankings Update — ${totalImproved} up, ${totalDropped} dropped`
    : `📍 BrightLocal Sync — ${totalCampaigns} campaigns checked`;

  const description = totalCampaigns === 0
    ? 'No BrightLocal campaigns found. Visit brightlocal.com to set up rank tracking for your clients.'
    : summaryLines.length > 0
    ? summaryLines.join('\n')
    : `All ${totalCampaigns} campaigns stable — no significant ranking changes.`;

  await notifyDiscord(title, description, [], hasChanges ? 'warning' : 'ok');
  log('Discord notified.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
