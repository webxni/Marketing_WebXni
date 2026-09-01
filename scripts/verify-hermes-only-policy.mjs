#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptsDir);
const terminalPath = join(scriptsDir, 'lib', 'terminal-json-agent.mjs');
const botPath = join(projectRoot, 'discord-bot', 'bot.js');
const forbidden = [
  /may call the gemini CLI/i,
  /For research only, you may use the gemini CLI/i,
  /uses OpenAI only as fallback/i,
];

export function verifyHermesOnlyPolicy(terminalSource, botSource) {
  const failures = [];

  for (const pattern of forbidden) {
    if (pattern.test(terminalSource) || pattern.test(botSource)) failures.push(`forbidden policy text: ${pattern}`);
  }

  if (!terminalSource.includes('Hermes tools only')) failures.push('terminal research policy is not Hermes-only');
  if (!botSource.includes("preferredBackend: ['hermes']")) failures.push('Discord backend priority is not explicitly Hermes-only');
  if (!botSource.includes('There is no OpenAI, Codex, or Claude fallback.')) failures.push('Discord truthfulness rule is missing');

  return failures;
}

if (process.argv.includes('--self-test')) {
  const failures = verifyHermesOnlyPolicy(
    'For research only, you may call the gemini CLI.',
    "preferredBackend: ['hermes']\nThere is no OpenAI, Codex, or Claude fallback."
  );
  if (failures.length === 0) {
    console.error('Hermes-only policy negative self-test failed');
    process.exit(1);
  }
  console.log('Hermes-only policy negative self-test passed');
  process.exit(0);
}

const terminalSource = readFileSync(terminalPath, 'utf8');
const botSource = readFileSync(botPath, 'utf8');
const failures = verifyHermesOnlyPolicy(terminalSource, botSource);

if (failures.length > 0) {
  console.error(`Hermes-only policy verification failed: ${failures.join('; ')}`);
  process.exit(1);
}

console.log('Hermes-only policy verification passed');
