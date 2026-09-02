// Run: node scripts/lib/terminal-json-agent.test.mjs
import assert from 'node:assert/strict';
import { buildHermesArgs, completePriority, normalizeBackendName, TerminalJsonAgentError } from './terminal-json-agent.mjs';

function ok(name, fn) { try { fn(); console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

ok('Hermes args require explicit non-blocked provider and do not auto-route through OpenAI fallback', () => {
  const oldOpenAI = process.env.OPENAI_API_KEY;
  const oldProvider = process.env.HERMES_PROVIDER;
  const oldModel = process.env.HERMES_MODEL;
  try {
    process.env.OPENAI_API_KEY = 'redacted-test-key';
    delete process.env.HERMES_PROVIDER;
    delete process.env.HERMES_MODEL;
    assert.throws(
      () => buildHermesArgs({ prompt: 'Return JSON', mode: 'default', skills: ['webxni-social-copywriter'] }),
      /must be set/,
    );
    process.env.HERMES_PROVIDER = 'google';
    process.env.HERMES_MODEL = 'gemini-2.5-pro';
    const args = buildHermesArgs({ prompt: 'Return JSON', mode: 'default', skills: ['webxni-social-copywriter'] });
    assert.equal(args[args.indexOf('--provider') + 1], 'google');
    assert.equal(args[args.indexOf('--model') + 1], 'gemini-2.5-pro');
    assert.equal(args.includes('openai-api'), false);
    assert.equal(args.includes('--skills'), true);
  } finally {
    if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenAI;
    if (oldProvider === undefined) delete process.env.HERMES_PROVIDER; else process.env.HERMES_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.HERMES_MODEL; else process.env.HERMES_MODEL = oldModel;
  }
});

ok('blocked providers are rejected', () => {
  const oldProvider = process.env.HERMES_PROVIDER;
  try {
    process.env.HERMES_PROVIDER = 'openai-api';
    assert.throws(() => buildHermesArgs({ prompt: 'x' }), /Blocked Hermes provider/);
    process.env.HERMES_PROVIDER = 'anthropic';
    assert.throws(() => buildHermesArgs({ prompt: 'x' }), /Blocked Hermes provider/);
  } finally {
    if (oldProvider === undefined) delete process.env.HERMES_PROVIDER; else process.env.HERMES_PROVIDER = oldProvider;
  }
});

ok('completePriority always returns hermes only', () => {
  assert.deepEqual(completePriority(['claude_code', 'hermes', 'openai']), ['hermes']);
  assert.deepEqual(completePriority(['gemini']), ['hermes']);
  assert.deepEqual(completePriority(['auto']), ['hermes']);
});

ok('legacy backend names normalize away from direct execution', () => {
  assert.equal(normalizeBackendName('claude_code'), 'blocked');
  assert.equal(normalizeBackendName('openai-api'), 'blocked');
  assert.equal(normalizeBackendName('gemini_cli'), 'hermes');
});

ok('research mode keeps terminal evidence gathering inside Hermes', () => {
  const oldProvider = process.env.HERMES_PROVIDER;
  try {
    process.env.HERMES_PROVIDER = 'google';
    const args = buildHermesArgs({ prompt: 'research', mode: 'research' });
    assert.equal(args[args.indexOf('--toolsets') + 1], 'safe,terminal');
    assert.match(args[1], /Hermes tools only/);
    assert.doesNotMatch(args[1], /may call .*CLI/i);
  } finally {
    if (oldProvider === undefined) delete process.env.HERMES_PROVIDER; else process.env.HERMES_PROVIDER = oldProvider;
  }
});


ok('TerminalJsonAgentError preserves safe backend body and retryability for non-JSON API failures', () => {
  const err = new TerminalJsonAgentError('Backend returned non-JSON output before a schema object could be parsed', {
    code: 'NON_JSON_BACKEND_OUTPUT',
    backend: 'hermes',
    body: 'API call failed: 429 quota exhausted for cfut_SECRET_TOKEN',
    stdout: 'API call failed: 429 quota exhausted for cfut_SECRET_TOKEN',
    retryable: true,
    status: 'retryable_non_json_backend_output',
  });
  assert.equal(err.code, 'NON_JSON_BACKEND_OUTPUT');
  assert.equal(err.backend, 'hermes');
  assert.equal(err.retryable, true);
  assert.equal(err.status, 'retryable_non_json_backend_output');
  assert.match(err.bodyPreview, /API call failed/);
  assert.doesNotMatch(err.bodyPreview, /cfut_SECRET_TOKEN/);
});
