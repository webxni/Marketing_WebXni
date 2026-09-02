// Run: node scripts/lib/terminal-json-agent.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCodexExecArgs, buildHermesChatArgs, classifyBackendFailure, completePriority, createHermesAgencyRuntimeEnv, isBackendAvailable, loadHermesEnvDefaults, normalizeBackendName, parseEnvFile } from './terminal-json-agent.mjs';

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

ok('every explicit and legacy priority resolves to Hermes only', () => {
  assert.deepEqual(
    completePriority(['claude_code', 'hermes', 'openai']),
    ['hermes'],
  );
  assert.deepEqual(completePriority(['gemini']), ['hermes']);
  assert.deepEqual(completePriority(['auto']), ['hermes']);
});

ok('cooling backends are not added back into the fallback chain', () => {
  assert.deepEqual(
    completePriority(['codex', 'openai'], ['codex', 'hermes']),
    [],
  );
});

ok('Codex cannot be re-enabled through the legacy override', () => {
  const prior = process.env.AGENCY_ALLOW_CODEX;
  delete process.env.AGENCY_ALLOW_CODEX;
  assert.deepEqual(completePriority(['codex', 'openai']), ['hermes']);
  process.env.AGENCY_ALLOW_CODEX = '1';
  assert.deepEqual(completePriority(['codex', 'openai']), ['hermes']);
  if (prior === undefined) delete process.env.AGENCY_ALLOW_CODEX;
  else process.env.AGENCY_ALLOW_CODEX = prior;
});

ok('legacy backend names cannot select a direct executor', () => {
  assert.equal(normalizeBackendName('claude_code'), 'blocked');
  assert.equal(normalizeBackendName('openai-api'), 'blocked');
  assert.equal(normalizeBackendName('codex'), 'blocked');
  assert.equal(normalizeBackendName('gemini_cli'), 'hermes');
});

ok('Hermes runner refuses an implicit provider when no approved key exists', () => {
  assert.throws(
    () => buildHermesChatArgs({
      wrappedPrompt: 'Return {"ok":true}',
      skills: ['webxni-agency-orchestrator'],
      mode: 'default',
      env: {},
    }),
    /requires HERMES_PROVIDER=google/,
  );
});

ok('Hermes runner infers the approved Google provider from configured credentials', () => {
  const args = buildHermesChatArgs({
    wrappedPrompt: 'Return JSON',
    mode: 'default',
    env: { GOOGLE_API_KEY: 'configured' },
  });
  assert.deepEqual(args, ['-z', 'Return JSON', '--toolsets', 'safe', '--provider', 'google', '--model', 'gemini-2.5-flash']);
});

ok('Hermes runner always refuses explicit Codex providers', () => {
  assert.throws(
    () => buildHermesChatArgs({
      wrappedPrompt: 'Return JSON',
      mode: 'default',
      env: { HERMES_PROVIDER: 'openai-codex' },
    }),
    /refuses blocked provider/,
  );
  assert.throws(
    () => buildHermesChatArgs({
      wrappedPrompt: 'Return JSON',
      mode: 'default',
      env: { HERMES_PROVIDER: 'codex' },
    }),
    /refuses blocked provider/,
  );
});

ok('legacy Codex override cannot bypass Hermes provider policy', () => {
  assert.throws(() => buildHermesChatArgs({
    wrappedPrompt: 'Return JSON',
    mode: 'default',
    env: { HERMES_PROVIDER: 'openai-codex', AGENCY_ALLOW_CODEX: '1' },
  }), /refuses blocked provider/);
});

ok('Hermes runner accepts explicit Google/Gemini providers inside Hermes', () => {
  const args = buildHermesChatArgs({
    wrappedPrompt: 'Return JSON',
    mode: 'default',
    env: { HERMES_PROVIDER: 'google', GOOGLE_API_KEY: 'configured' },
  });
  assert.equal(args[args.indexOf('--provider') + 1], 'google');
});

ok('Hermes runner rejects OpenAI, Claude, Anthropic, and OpenRouter providers', () => {
  for (const provider of ['openai', 'claude', 'anthropic', 'openrouter']) assert.throws(() => buildHermesChatArgs({
    wrappedPrompt: 'Return JSON',
    mode: 'blog',
    env: { HERMES_PROVIDER: provider, GOOGLE_API_KEY: 'configured' },
  }), /refuses blocked provider/);
});

ok('Hermes research mode exposes terminal tools without allowing another model CLI', () => {
  const args = buildHermesChatArgs({
    wrappedPrompt: 'Research and return JSON',
    mode: 'research',
    env: { HERMES_PROVIDER: 'google', GOOGLE_API_KEY: 'configured' },
  });
  assert.equal(args[args.indexOf('--toolsets') + 1], 'safe,terminal');
  assert.match(args[1], /Hermes terminal and safe tools only/);
  assert.doesNotMatch(args[1], /may call .*CLI/i);
});

ok('hermes availability matches the provider guard used by the runner', () => {
  const priorProvider = process.env.HERMES_PROVIDER;
  const priorAllowCodex = process.env.AGENCY_ALLOW_CODEX;
  const priorGoogleApiKey = process.env.GOOGLE_API_KEY;
  const priorGeminiApiKey = process.env.GEMINI_API_KEY;
  const priorGeminiApiKeys = process.env.GEMINI_API_KEYS;
  const priorHermesCliPath = process.env.HERMES_CLI_PATH;
  process.env.HERMES_CLI_PATH = process.execPath;
  delete process.env.HERMES_PROVIDER;
  delete process.env.AGENCY_ALLOW_CODEX;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEYS;
  assert.equal(isBackendAvailable('hermes'), false);
  assert.equal(isBackendAvailable('gemini'), false);
  process.env.GOOGLE_API_KEY = 'configured';
  assert.equal(isBackendAvailable('hermes'), true);
  process.env.HERMES_PROVIDER = 'google';
  assert.equal(isBackendAvailable('hermes'), true);
  process.env.HERMES_PROVIDER = 'openai';
  assert.equal(isBackendAvailable('hermes'), false);
  process.env.AGENCY_ALLOW_CODEX = '1';
  process.env.HERMES_PROVIDER = 'openai-codex';
  assert.equal(isBackendAvailable('hermes'), false);
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
  if (priorHermesCliPath === undefined) delete process.env.HERMES_CLI_PATH;
  else process.env.HERMES_CLI_PATH = priorHermesCliPath;
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

ok('Hermes runtime accepts the approved Google key pool and strips direct-provider secrets', () => {
  const runtime = createHermesAgencyRuntimeEnv({
    GOOGLE_API_KEY: 'approved-google-key',
    GEMINI_API_KEYS: 'pooled-key-1,pooled-key-2',
    HERMES_PROVIDER: 'google',
    OPENAI_API_KEY: 'must-not-reach-child',
    ANTHROPIC_API_KEY: 'must-not-reach-child',
  });
  try {
    assert.equal(runtime.env.GOOGLE_API_KEY, 'pooled-key-1');
    assert.equal(runtime.env.OPENAI_API_KEY, undefined);
    assert.equal(runtime.env.ANTHROPIC_API_KEY, undefined);
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
      GOOGLE_API_KEY: 'configured',
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
