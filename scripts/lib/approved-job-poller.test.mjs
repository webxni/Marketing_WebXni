import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENCY_AGENT_COMMANDS } from './agency-harness-contract.mjs';
import { APPROVED_JOB_SCRIPTS, approvedScriptFor, buildChildArgs } from '../run-approved-job-poller.mjs';

test('poller exposes only fixed weekly and agency command names', () => {
  const commands = Object.keys(APPROVED_JOB_SCRIPTS).sort();
  const expected = [
    'weekly_content_terminal',
    'regenerate_content_terminal',
    'weekly_content_claude',
    'regenerate_content_claude',
    ...Object.values(AGENCY_AGENT_COMMANDS),
  ].sort();
  assert.deepEqual(commands, expected);
});

test('every agency command selects the fixed agency runner', () => {
  for (const command of Object.values(AGENCY_AGENT_COMMANDS)) {
    assert.match(approvedScriptFor(command), /run-approved-agency-job\.mjs$/);
  }
});

test('weekly commands select the fixed terminal runner', () => {
  assert.match(approvedScriptFor('weekly_content_terminal'), /run-approved-terminal-job\.mjs$/);
  assert.match(approvedScriptFor('regenerate_content_claude'), /run-approved-terminal-job\.mjs$/);
});

test('unknown commands are rejected before process creation', () => {
  assert.equal(approvedScriptFor('rm_everything'), '');
  assert.throws(() => buildChildArgs({ id: 'job-1', command_name: 'rm_everything' }), /Unapproved command/);
});

test('child arguments contain no secret value', () => {
  const args = buildChildArgs({ id: 'job-123', command_name: 'agency_system_review' });
  assert.ok(args.includes('--job-id'));
  assert.ok(args.includes('job-123'));
  assert.equal(args.includes('--bot-secret'), false);
  assert.equal(args.some((value) => /DISCORD_BOT_SECRET/.test(value)), false);
});

