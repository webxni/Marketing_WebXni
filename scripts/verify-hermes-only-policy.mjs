#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptsDir);

export function verifyHermesOnlyPolicy(terminalSource, botSource) {
  const failures = [];
  const forbidden = [
    [/preferredBackend\s*:\s*\[[^\]]*(?:openai|codex|claude|gemini)/i, 'Discord backend priority contains a direct provider'],
    [/falling back to (?:OpenAI|Codex|Claude|Gemini)/i, 'Discord advertises a direct-provider fallback'],
    [/\/api\/ai\/dispatch/i, 'Discord retains the Worker AI fallback route'],
    [/weekly_content_claude|regenerate_content_claude/i, 'Discord retains a provider-named job alias'],
    [/else if \(backend === '(?:claude|codex|openai|gemini)'\)\s*(?:res|throw)/i, 'terminal dispatch can select a direct provider'],
  ];
  const combined = `${terminalSource}\n${botSource}`;
  for (const [pattern, label] of forbidden) if (pattern.test(combined)) failures.push(label);

  if (!/preferredBackend\s*:\s*\['hermes'\]/.test(botSource)) failures.push('Discord priority is not explicitly Hermes-only');
  if (!botSource.includes("const APPROVED_JOB_POLLER_ENABLED = process.env.APPROVED_JOB_POLLER_ENABLED === '1'")) failures.push('Discord queue consumer is not opt-in');
  if (!botSource.includes('if (APPROVED_JOB_POLLER_ENABLED)')) failures.push('Discord queue consumer opt-in is not enforced');
  if (!terminalSource.includes("return excluded.has('hermes') ? [] : ['hermes'];")) failures.push('terminal priority does not collapse to Hermes-only');
  if (!terminalSource.includes('Hermes is the only allowed executor')) failures.push('terminal dispatch does not fail closed');
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'CODEX_API_KEY', 'OPENROUTER_API_KEY']) {
    if (!terminalSource.includes(`delete runtimeEnv.${key}`)) failures.push(`Hermes child environment does not remove ${key}`);
  }
  return failures;
}

if (process.argv.includes('--self-test')) {
  const failures = verifyHermesOnlyPolicy(
    "return ['hermes', 'openai'];\nelse if (backend === 'openai') res = runOpenAI();",
    "preferredBackend: ['hermes', 'openai'];\nfalling back to OpenAI\n/api/ai/dispatch",
  );
  if (failures.length < 3) {
    console.error('Hermes-only policy negative self-test failed');
    process.exit(1);
  }
  console.log('Hermes-only policy negative self-test passed');
  process.exit(0);
}

const terminalSource = readFileSync(join(scriptsDir, 'lib', 'terminal-json-agent.mjs'), 'utf8');
const botSource = readFileSync(join(projectRoot, 'discord-bot', 'bot.js'), 'utf8');
const failures = verifyHermesOnlyPolicy(terminalSource, botSource);
if (failures.length > 0) {
  console.error(`Hermes-only policy verification failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('Hermes-only policy verification passed');
