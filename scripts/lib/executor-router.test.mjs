// Pure unit tests for the executor router. Run: node scripts/lib/executor-router.test.mjs
import assert from 'node:assert/strict';
import { pick_executor, executorLead, taskTypeForAgent } from './executor-router.mjs';

let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log(`  ok  ${label}`); };

// task_type leads
ok('long_form -> claude lead', () => assert.equal(executorLead({ task_type: 'long_form' })[0], 'claude'));
ok('blog -> claude lead', () => assert.equal(executorLead({ task_type: 'blog' })[0], 'claude'));
ok('structured -> codex lead', () => assert.equal(executorLead({ task_type: 'structured' })[0], 'codex'));
ok('research -> gemini lead', () => assert.equal(executorLead({ task_type: 'research' })[0], 'gemini'));
ok('plan/validate -> hermes lead', () => {
  assert.equal(executorLead({ task_type: 'plan' })[0], 'hermes');
  assert.equal(executorLead({ task_type: 'validate' })[0], 'hermes');
});
ok('unknown -> default hermes lead', () => assert.equal(executorLead({ task_type: 'nope' })[0], 'hermes'));

// quality target forces Claude
ok('quality high forces claude lead', () => {
  assert.equal(executorLead({ task_type: 'structured', quality_target: 'high' })[0], 'claude');
});

// budget drops expensive executors
ok('over budget drops claude', () => {
  assert.ok(!executorLead({ task_type: 'blog', budget_state: 'over' }).includes('claude'));
});
ok('over budget drops codex', () => {
  assert.ok(!executorLead({ task_type: 'structured', budget_state: 'over' }).includes('codex'));
});
ok('over budget never empties chain', () => {
  assert.ok(pick_executor({ task_type: 'blog', budget_state: 'over' }).length > 0);
});

// full chain keeps a hermes/openai tail and dedups
ok('pick_executor keeps hermes + openai tail', () => {
  const chain = pick_executor({ task_type: 'blog' });
  assert.ok(chain.includes('hermes'));
  assert.ok(chain.includes('openai'));
  assert.equal(chain.length, new Set(chain).size, 'no duplicates');
});

// agent mapping preserves existing leads
ok('complex agents map to claude lead', () => {
  for (const slug of ['blog-writer', 'strategy', 'editorial-review', 'system-reliability']) {
    assert.equal(executorLead({ task_type: taskTypeForAgent(slug) })[0], 'claude', slug);
  }
});
ok('simple agents map to hermes lead', () => {
  for (const slug of ['social-copy', 'client-research', 'agency-orchestrator', 'security-sentinel']) {
    assert.equal(executorLead({ task_type: taskTypeForAgent(slug) })[0], 'hermes', slug);
  }
});
ok('blog mode forces blog task type', () => {
  assert.equal(taskTypeForAgent('social-copy', 'blog'), 'blog');
});

console.log(`\n${passed} router tests passed`);
