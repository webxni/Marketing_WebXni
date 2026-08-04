// Run: node scripts/lib/terminal-json-agent.test.mjs
import assert from 'node:assert/strict';
import { buildCodexExecArgs } from './terminal-json-agent.mjs';

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

console.log(`\n${passed} terminal JSON agent tests passed`);
