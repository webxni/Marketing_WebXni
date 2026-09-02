// Pure unit tests for Hermes-only executor router. Run: node scripts/lib/executor-router.test.mjs
import assert from 'node:assert/strict';
import { pick_executor, executorLead, taskTypeForAgent } from './executor-router.mjs';

function ok(name, fn) { try { fn(); console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

ok('every task leads with hermes only', () => {
  for (const task_type of ['long_form','blog','research','revision','validate','default']) {
    assert.deepEqual(executorLead({ task_type }), ['hermes']);
    assert.deepEqual(pick_executor({ task_type }), ['hermes']);
  }
});

ok('quality and budget never add Claude/OpenAI/Gemini backends', () => {
  assert.deepEqual(pick_executor({ task_type: 'revision', quality_target: 'high', budget_state: 'over' }), ['hermes']);
});

ok('agent task type labels preserved for observability only', () => {
  assert.equal(taskTypeForAgent('client-research'), 'research');
  assert.equal(taskTypeForAgent('gmb-rank'), 'structured');
  assert.equal(taskTypeForAgent('blog-writer', 'blog'), 'blog');
});
