import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEvidenceBackedReview } from './agency-review-evidence.mjs';

test('drops unsupported findings and downgrades recovered incidents', () => {
  const result = normalizeEvidenceBackedReview({
    severity: 'high',
    summary: 'Old failures remain critical.',
    findings: [
      { severity: 'high', state: 'historical', evidence_ids: ['run-old'], title: 'Old run', description: 'Recovered.' },
      { severity: 'high', state: 'active', evidence_ids: ['invented-id'], title: 'Invented', description: 'Unsupported.' },
    ],
    recommended_actions: ['Change production.'],
    code_proposals: [{ title: 'Unneeded proposal' }],
  }, { incident_history: [{ id: 'run-old', status: 'failed' }], latest_run: { id: 'run-new', status: 'completed' } }, 'reliability');

  assert.equal(result.severity, 'info');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, 'info');
  assert.deepEqual(result.recommended_actions, []);
  assert.deepEqual(result.code_proposals, []);
  assert.match(result.summary, /No active evidence-backed reliability issue/);
});

test('preserves an active finding whose evidence exists in the snapshot', () => {
  const result = normalizeEvidenceBackedReview({
    severity: 'medium',
    summary: 'A backend is currently unavailable.',
    findings: [
      { severity: 'medium', state: 'active', evidence_ids: ['hermes'], title: 'Backend unavailable', description: 'Current health is failed.' },
    ],
    recommended_actions: ['Reauthenticate Hermes.'],
    code_proposals: [],
  }, { backend_health: [{ backend: 'hermes', status: 'failed' }] }, 'reliability');

  assert.equal(result.severity, 'medium');
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.recommended_actions, ['Reauthenticate Hermes.']);
});
