import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AGENCY_AGENT_COMMANDS,
  AGENCY_BACKEND_PRIORITY,
  DEFAULT_AGENCY_SAFETY,
  REQUIRED_AGENCY_AGENT_SLUGS,
  agencySafety,
  backendPriorityForAgent,
  commandForAgent,
} from './agency-harness-contract.mjs';

const expectedSlugs = [
  'agency-orchestrator',
  'system-reliability',
  'security-sentinel',
  'client-research',
  'strategy',
  'social-copy',
  'blog-writer',
  'editorial-review',
  'client-onboarding',
  'gmb-rank',
];

function parseWorkerContractObject(name) {
  const source = readFileSync(resolve('worker/src/modules/agency-contract.ts'), 'utf8');
  const match = source.match(new RegExp(`export const ${name}[^=]*= \\{([\\s\\S]*?)\\}(?: as const)?;`));
  assert.ok(match, `worker contract must export ${name}`);
  return Function(`return ({${match[1]}});`)();
}

test('agency contract exposes every required agent slug', () => {
  assert.deepEqual([...REQUIRED_AGENCY_AGENT_SLUGS].sort(), [...expectedSlugs].sort());
});

test('every agency command is whitelisted and agency-prefixed', () => {
  for (const [slug, command] of Object.entries(AGENCY_AGENT_COMMANDS)) {
    assert.ok(expectedSlugs.includes(slug), `unexpected slug ${slug}`);
    assert.match(command, /^agency_/, `${slug} command must be agency-prefixed`);
  }
});

test('backend priority is defined for every command and excludes codex', () => {
  for (const slug of expectedSlugs) {
    const priority = AGENCY_BACKEND_PRIORITY[slug];
    assert.ok(Array.isArray(priority), `${slug} priority must be an array`);
    assert.ok(priority.length >= 2, `${slug} needs a fallback backend`);
    assert.equal(priority.includes('codex'), false, `${slug} must keep Codex out of active routing`);
  }
});

test('default safety preserves all human and publishing gates', () => {
  assert.deepEqual(DEFAULT_AGENCY_SAFETY, {
    no_arbitrary_shell: true,
    preserve_marvin_approval: true,
    preserve_designer_gate: true,
    no_auto_publish: true,
  });
});

test('helpers return safe fallbacks', () => {
  assert.equal(commandForAgent('editorial-review'), 'agency_editorial_review');
  assert.equal(commandForAgent('missing-agent'), '');
  assert.deepEqual(backendPriorityForAgent('missing-agent'), ['hermes', 'openai']);
  assert.deepEqual(agencySafety({ extra: true }), {
    no_arbitrary_shell: true,
    preserve_marvin_approval: true,
    preserve_designer_gate: true,
    no_auto_publish: true,
    extra: true,
  });
});

test('script harness contract stays synchronized with Worker agency contract', () => {
  assert.deepEqual(parseWorkerContractObject('AGENCY_AGENT_COMMANDS'), AGENCY_AGENT_COMMANDS);
  assert.deepEqual(parseWorkerContractObject('AGENCY_BACKEND_PRIORITY'), AGENCY_BACKEND_PRIORITY);
  assert.deepEqual(parseWorkerContractObject('DEFAULT_AGENCY_SAFETY'), DEFAULT_AGENCY_SAFETY);
});
