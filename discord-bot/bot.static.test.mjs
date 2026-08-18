import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const botSource = readFileSync(new URL('./bot.js', import.meta.url), 'utf8');

test('Discord agency commands expose the GMB rank agent end-to-end', () => {
  assert.match(botSource, /'gmb-rank'/, 'valid agency slug list must include gmb-rank');
  assert.match(botSource, /agency_gmb_rank/, 'approved-job whitelist must include agency_gmb_rank');
  assert.match(botSource, /\\bgmb\\b\|\\bgbp\\b\|\\bgoogle business\\b/, 'natural-language parser must route GMB/GBP requests');
});
