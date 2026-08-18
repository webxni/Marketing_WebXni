// Run: node scripts/lib/terminal-json-agent.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildCodexExecArgs, buildHermesChatArgs, completePriority, isBackendAvailable } from './terminal-json-agent.mjs';

let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log(`  ok  ${label}`); };

ok('codex exec writes the last message with the current flag', () => {
  const args = buildCodexExecArgs({
    prompt: 'Return {"ok":true}',
    schemaPath: '/tmp/schema.json',
    outputPath: '/tmp/last-message.txt',
    model: 'gpt-4.1-mini',
  });
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('--output-last-message'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.equal(args[args.indexOf('--output-last-message') + 1], '/tmp/last-message.txt');
  assert.ok(!args.includes('-o'));
});

ok('codex exec keeps the prompt as the final positional argument', () => {
  const args = buildCodexExecArgs({
    prompt: 'Return only JSON',
    schemaPath: '/tmp/schema.json',
    outputPath: '/tmp/last-message.txt',
    model: '',
  });
  assert.equal(args.at(-1), 'Return only JSON');
  assert.ok(!args.includes('-m'));
});

ok('codex exec can read oversized prompts from stdin', () => {
  const args = buildCodexExecArgs({
    prompt: '-',
    schemaPath: '/tmp/schema.json',
    outputPath: '/tmp/last-message.txt',
    model: '',
  });
  assert.equal(args.at(-1), '-');
});

ok('explicit agent priorities still try every available terminal before OpenAI', () => {
  assert.deepEqual(
    completePriority(['claude_code', 'hermes', 'openai']),
    ['claude', 'hermes', 'gemini', 'openai'],
  );
});

ok('cooling backends are not added back into the fallback chain', () => {
  assert.deepEqual(
    completePriority(['codex', 'openai'], ['codex', 'hermes']),
    ['gemini', 'claude', 'openai'],
  );
});

ok('codex is not routed unless explicitly re-enabled', () => {
  const prior = process.env.AGENCY_ALLOW_CODEX;
  delete process.env.AGENCY_ALLOW_CODEX;
  assert.deepEqual(completePriority(['codex', 'openai']), ['hermes', 'gemini', 'claude', 'openai']);
  process.env.AGENCY_ALLOW_CODEX = '1';
  assert.deepEqual(completePriority(['codex', 'openai']), ['codex', 'hermes', 'gemini', 'claude', 'openai']);
  if (prior === undefined) delete process.env.AGENCY_ALLOW_CODEX;
  else process.env.AGENCY_ALLOW_CODEX = prior;
});

ok('hermes runner refuses implicit Codex-backed Hermes defaults', () => {
  assert.throws(
    () => buildHermesChatArgs({
      wrappedPrompt: 'Return {"ok":true}',
      skills: ['webxni-agency-orchestrator'],
      mode: 'default',
      env: {},
    }),
    /requires HERMES_PROVIDER/,
  );
});

ok('hermes runner refuses explicit Codex provider unless agency Codex routing is allowed', () => {
  assert.throws(
    () => buildHermesChatArgs({
      wrappedPrompt: 'Return JSON',
      mode: 'default',
      env: { HERMES_PROVIDER: 'openai-codex' },
    }),
    /refuses Codex provider/,
  );
  assert.throws(
    () => buildHermesChatArgs({
      wrappedPrompt: 'Return JSON',
      mode: 'default',
      env: { HERMES_PROVIDER: 'codex' },
    }),
    /refuses Codex provider/,
  );
});

ok('hermes runner allows explicit Codex provider only with agency override', () => {
  const args = buildHermesChatArgs({
    wrappedPrompt: 'Return JSON',
    mode: 'default',
    env: { HERMES_PROVIDER: 'openai-codex', AGENCY_ALLOW_CODEX: '1' },
  });
  assert.deepEqual(args, ['-z', 'Return JSON', '--provider', 'openai-codex']);
});

ok('hermes runner preserves explicit provider override', () => {
  const args = buildHermesChatArgs({
    wrappedPrompt: 'Return JSON',
    mode: 'blog',
    env: { HERMES_PROVIDER: 'anthropic', HERMES_MODEL: 'claude-sonnet-4', GOOGLE_API_KEY: 'configured' },
  });
  assert.deepEqual(args, ['-z', 'Return JSON', '--provider', 'anthropic', '--model', 'claude-sonnet-4']);
});

ok('hermes runner can use the configured Hermes default only when Codex is allowed', () => {
  const args = buildHermesChatArgs({
    wrappedPrompt: 'Return JSON',
    mode: 'default',
    env: { AGENCY_ALLOW_CODEX: '1', GOOGLE_API_KEY: 'configured' },
  });
  assert.deepEqual(args, ['-z', 'Return JSON']);
});

ok('hermes availability matches the provider guard used by the runner', () => {
  const priorProvider = process.env.HERMES_PROVIDER;
  const priorAllowCodex = process.env.AGENCY_ALLOW_CODEX;
  const hasHermesCommand = spawnSync('hermes', ['--version'], { stdio: 'ignore' }).status === 0;
  delete process.env.HERMES_PROVIDER;
  delete process.env.AGENCY_ALLOW_CODEX;
  assert.equal(isBackendAvailable('hermes'), false);
  process.env.HERMES_PROVIDER = 'google';
  assert.equal(isBackendAvailable('hermes'), hasHermesCommand);
  delete process.env.HERMES_PROVIDER;
  process.env.AGENCY_ALLOW_CODEX = '1';
  assert.equal(isBackendAvailable('hermes'), hasHermesCommand);
  process.env.HERMES_PROVIDER = 'openai-codex';
  delete process.env.AGENCY_ALLOW_CODEX;
  assert.equal(isBackendAvailable('hermes'), false);
  process.env.AGENCY_ALLOW_CODEX = '1';
  assert.equal(isBackendAvailable('hermes'), hasHermesCommand);
  if (priorProvider === undefined) delete process.env.HERMES_PROVIDER;
  else process.env.HERMES_PROVIDER = priorProvider;
  if (priorAllowCodex === undefined) delete process.env.AGENCY_ALLOW_CODEX;
  else process.env.AGENCY_ALLOW_CODEX = priorAllowCodex;
});

console.log(`\n${passed} terminal JSON agent tests passed`);
