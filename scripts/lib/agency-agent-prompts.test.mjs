import assert from 'node:assert/strict';
import test from 'node:test';

import { AGENCY_SCHEMAS, buildAgencyPrompt } from './agency-agent-prompts.mjs';

const input = {
  client: {},
  snapshot: { overview: {} },
  task: {},
};

test('editorial review follows weekly blog and GBP package rules', () => {
  const prompt = buildAgencyPrompt('editorialReview', input);

  assert.match(prompt, /Weekly blogs intentionally have null ai_image_prompt\/ai_video_prompt/);
  assert.match(prompt, /website_blog is the only required platform for a blog/);
  assert.match(prompt, /Location-specific captions take precedence/);
  assert.match(prompt, /TikTok is hard-capped at 90 characters and Pinterest at 100 characters/);
  assert.match(prompt, /caption_lengths values are authoritative/);
  assert.match(prompt, /current package week is an operational follow-up, not a content defect/);
  assert.match(prompt, /phone numbers/);
  assert.match(prompt, /Do not criticize either field merely for being concise/);
});

test('operational reviews separate current state from incident history', () => {
  const reliability = buildAgencyPrompt('reliabilityReview', input);
  const security = buildAgencyPrompt('securityReview', input);
  const orchestrator = buildAgencyPrompt('orchestratorReview', input);

  assert.match(reliability, /168-hour INCIDENT HISTORY/);
  assert.match(reliability, /state to active, recovered, or historical/);
  assert.match(reliability, /evidence_ids copied exactly/);
  assert.match(reliability, /Never invent filenames/);
  assert.match(security, /current unresolved security boundary failure/);
  assert.match(security, /internal bot-only snapshot is not user-facing evidence/);
  assert.match(orchestrator, /must not create assignments/);
  assert.match(orchestrator, /intentional human workflow gates/);

  for (const kind of ['reliabilityReview', 'securityReview', 'orchestratorReview']) {
    const finding = AGENCY_SCHEMAS[kind].properties.findings.items;
    assert.deepEqual(finding.required, ['severity', 'state', 'evidence_ids', 'title', 'description']);
    assert.equal(finding.properties.evidence_ids.minItems, 1);
  }
});
