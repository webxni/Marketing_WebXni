import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgencyPrompt } from './agency-agent-prompts.mjs';

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
});

test('operational reviews separate current state from incident history', () => {
  const reliability = buildAgencyPrompt('reliabilityReview', input);
  const security = buildAgencyPrompt('securityReview', input);
  const orchestrator = buildAgencyPrompt('orchestratorReview', input);

  assert.match(reliability, /168-hour INCIDENT HISTORY/);
  assert.match(reliability, /Never invent filenames/);
  assert.match(security, /internal bot-only snapshot is not user-facing evidence/);
  assert.match(orchestrator, /intentional human workflow gates/);
});
