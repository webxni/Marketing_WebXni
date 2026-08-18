// Run: node scripts/lib/terminal-json-agent.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCodexExecArgs, buildHermesChatArgs, classifyBackendFailure, completePriority, createHermesAgencyRuntimeEnv, isBackendAvailable, loadHermesEnvDefaults, parseEnvFile } from './terminal-json-agent.mjs';

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

ok('hermes runner refuses implicit Codex-backed Hermes defaults when no non-Codex provider key exists', () => {
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

ok('hermes runner defaults to Google when central Gemini credentials are available', () => {
  const args = buildHermesChatArgs({
    wrappedPrompt: 'Return JSON',
    mode: 'default',
    env: { GOOGLE_API_KEY: 'configured' },
  });
  assert.deepEqual(args, ['-z', 'Return JSON', '--provider', 'google', '--model', 'gemini-2.5-flash']);
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

ok('hermes runner supplies provider-specific model defaults for explicit non-Codex providers', () => {
  const args = buildHermesChatArgs({
    wrappedPrompt: 'Return JSON',
    mode: 'default',
    env: { HERMES_PROVIDER: 'google', GOOGLE_API_KEY: 'configured' },
  });
  assert.deepEqual(args, ['-z', 'Return JSON', '--provider', 'google', '--model', 'gemini-2.5-flash']);
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
  const priorGoogleApiKey = process.env.GOOGLE_API_KEY;
  const priorGeminiApiKey = process.env.GEMINI_API_KEY;
  const priorGeminiApiKeys = process.env.GEMINI_API_KEYS;
  const hasHermesCommand = spawnSync('hermes', ['--version'], { stdio: 'ignore' }).status === 0;
  delete process.env.HERMES_PROVIDER;
  delete process.env.AGENCY_ALLOW_CODEX;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEYS;
  assert.equal(isBackendAvailable('hermes'), false);
  process.env.GOOGLE_API_KEY = 'configured';
  assert.equal(isBackendAvailable('hermes'), hasHermesCommand);
  delete process.env.GOOGLE_API_KEY;
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
  if (priorGoogleApiKey === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = priorGoogleApiKey;
  if (priorGeminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = priorGeminiApiKey;
  if (priorGeminiApiKeys === undefined) delete process.env.GEMINI_API_KEYS;
  else process.env.GEMINI_API_KEYS = priorGeminiApiKeys;
});

ok('terminal agent parses simple dotenv content for central Hermes defaults', () => {
  assert.deepEqual(parseEnvFile('GOOGLE_API_KEY=abc\nexport HERMES_PROVIDER="google"\nBAD LINE\n'), {
    GOOGLE_API_KEY: 'abc',
    HERMES_PROVIDER: 'google',
  });
});

ok('terminal agent loads allowlisted Hermes env defaults without overriding service env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webxni-hermes-env-test-'));
  try {
    const envPath = join(dir, '.env');
    writeFileSync(envPath, [
      'GOOGLE_API_KEY=central-google',
      'OPENAI_API_KEY=central-openai',
      'DISCORD_BOT_SECRET=must-not-load',
      'HERMES_PROVIDER=google',
    ].join('\n'));
    const env = { HERMES_ENV_PATH: envPath, OPENAI_API_KEY: 'service-openai' };
    const loaded = loadHermesEnvDefaults(env).sort();
    assert.deepEqual(loaded, ['GOOGLE_API_KEY', 'HERMES_PROVIDER']);
    assert.equal(env.GOOGLE_API_KEY, 'central-google');
    assert.equal(env.OPENAI_API_KEY, 'service-openai');
    assert.equal(env.DISCORD_BOT_SECRET, undefined);
    assert.equal(env.HERMES_PROVIDER, 'google');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

ok('backend failure classifier preserves provider quota and rate-limit causes', () => {
  assert.equal(
    classifyBackendFailure('gemini', 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric GenerateContent requests'),
    'cause: gemini quota or rate limit was exceeded',
  );
  assert.equal(
    classifyBackendFailure('claude', 'HTTP 429 rate_limit_error: too many requests'),
    'cause: claude quota or rate limit was exceeded',
  );
});

ok('backend failure classifier preserves authentication causes from terminal wrappers and APIs', () => {
  assert.equal(
    classifyBackendFailure('claude', '{"is_error":true,"result":"Not logged in · Please run /login"}'),
    'cause: claude authentication is missing or expired',
  );
  assert.equal(
    classifyBackendFailure('gemini', 'Gemini API 400: {"error":{"status":"INVALID_ARGUMENT","message":"API key not valid. Please pass a valid API key."}}'),
    'cause: gemini authentication is missing or expired',
  );
});

ok('backend failure classifier preserves mixed Gemini key quota and auth failures', () => {
  assert.equal(
    classifyBackendFailure('gemini', 'key #1 Gemini API 429: RESOURCE_EXHAUSTED quota exceeded\nkey #2 Gemini API 400: API key not valid'),
    'cause: gemini had mixed authentication and quota/rate-limit failures',
  );
});

ok('backend failure classifier preserves Hermes no-final failures as execution failures', () => {
  assert.equal(
    classifyBackendFailure('hermes', 'hermes -z: no final response was produced; treating the run as failed.'),
    'cause: hermes agent execution failed before returning JSON',
  );
});

ok('hermes runtime prefers Gemini key pool over stale Google key for Hermes provider', () => {
  const runtime = createHermesAgencyRuntimeEnv({
    GOOGLE_API_KEY: 'stale-google-key',
    GEMINI_API_KEYS: 'pooled-key-1,pooled-key-2',
    HERMES_PROVIDER: 'google',
  });
  try {
    assert.equal(runtime.env.GOOGLE_API_KEY, 'pooled-key-1');
    assert.equal(runtime.env.GEMINI_API_KEYS, 'pooled-key-1,pooled-key-2');
  } finally {
    runtime.cleanup();
  }
});

ok('hermes runner isolates agency runs from globally configured MCP OAuth servers', () => {
  const realHome = mkdtempSync(join(tmpdir(), 'webxni-real-hermes-home-'));
  try {
    writeFileSync(join(realHome, 'config.yaml'), 'mcp_servers:\n  noisy-oauth-server:\n    url: https://example.com/mcp\n    auth: oauth\n');
    const runtime = createHermesAgencyRuntimeEnv({
      HERMES_HOME: realHome,
      HERMES_PROVIDER: 'google',
      HERMES_MODEL: 'gemini-2.5-flash',
    });
    try {
      assert.notEqual(runtime.home, realHome);
      assert.equal(existsSync(join(runtime.home, 'sessions')), true);
      assert.equal(runtime.env.HERMES_HOME, runtime.home);
      const config = readFileSync(join(runtime.home, 'config.yaml'), 'utf8');
      assert.match(config, /mcp_servers: \{\}/);
      assert.doesNotMatch(config, /noisy-oauth-server/);
      assert.match(config, /- safe/);
      assert.match(config, /provider: google/);
    } finally {
      runtime.cleanup();
      assert.equal(existsSync(runtime.home), false);
    }
  } finally {
    rmSync(realHome, { recursive: true, force: true });
  }
});

console.log(`\n${passed} terminal JSON agent tests passed`);
