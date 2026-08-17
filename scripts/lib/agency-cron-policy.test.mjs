import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_AGENCY_AGENT_SLUGS } from './agency-harness-contract.mjs';
import { AGENCY_CRON_POLICY, cronPolicyEntries, isPublishCapableCron } from './agency-cron-policy.mjs';

const cronField = '(\\*|\\*/\\d+|\\d+|\\d+,\\d+(?:,\\d+)*|\\d+-\\d+|[A-Z]{3}(?:-[A-Z]{3})?)';
const cronExpression = new RegExp(`^${cronField} ${cronField} ${cronField} ${cronField} ${cronField}$`);

test('cron policy defines all autonomous harness operations', () => {
  assert.deepEqual(Object.keys(AGENCY_CRON_POLICY).sort(), [
    'daily_agency_report',
    'daily_package_gap_recovery',
    'editorial_review_sweep',
    'harness_health_watchdog',
    'weekly_package_generation',
  ].sort());
});

test('every cron expression is explicit and parseable by policy validation', () => {
  for (const entry of cronPolicyEntries()) {
    assert.match(entry.schedule, cronExpression, `${entry.key} has invalid cron ${entry.schedule}`);
    assert.ok(entry.purpose.length > 20, `${entry.key} needs an operator-readable purpose`);
  }
});

test('every cron references a known agency agent', () => {
  const known = new Set(REQUIRED_AGENCY_AGENT_SLUGS);
  for (const entry of cronPolicyEntries()) {
    assert.ok(entry.agents.length > 0, `${entry.key} must list at least one agent`);
    for (const agent of entry.agents) {
      assert.ok(known.has(agent), `${entry.key} references unknown agent ${agent}`);
    }
  }
});

test('autonomous crons are not publish-capable', () => {
  for (const entry of cronPolicyEntries()) {
    assert.equal(entry.may_publish, false, `${entry.key} must not publish`);
    assert.equal(isPublishCapableCron(entry.key), false, `${entry.key} must not be publish capable`);
  }
});

test('watchdog and report crons do not create content', () => {
  assert.equal(AGENCY_CRON_POLICY.harness_health_watchdog.creates_content, false);
  assert.equal(AGENCY_CRON_POLICY.daily_agency_report.creates_content, false);
});
