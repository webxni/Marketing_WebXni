import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRetryCorrection } from './retry-feedback.mjs';

test('retry correction does not echo rejected content or contact details', () => {
  const correction = buildRetryCorrection(
    'Quality validation failed: generic pattern: "immediate help"; phone mismatch: only (323) 555-0100 is allowed',
  );

  assert.match(correction, /service-specific wording/);
  assert.match(correction, /exact phone shown in BUSINESS CONTEXT/);
  assert.doesNotMatch(correction, /immediate help/i);
  assert.doesNotMatch(correction, /323|555-0100/);
});

test('retry correction maps restrictions and unsupported claims to safe instructions', () => {
  const correction = buildRetryCorrection(
    'Quality validation failed: restricted client content: "example"; unsupported claim: license',
  );

  assert.match(correction, /CLIENT RESTRICTIONS/);
  assert.match(correction, /Remove licensing, availability, timing/);
  assert.doesNotMatch(correction, /restricted client content:|unsupported claim:/i);
});
