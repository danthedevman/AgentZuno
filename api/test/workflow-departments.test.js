import test from 'node:test';
import assert from 'node:assert/strict';
import { defineWorkflow, matchesWorkflow, toTypeScript } from '../sdk/workflows/index.js';
const base = {
  version: 1,
  name: 'Department request',
  trigger: { phrases: ['laptop'] },
  steps: [{ id: 'route', action: 'route', params: { queueName: 'Support' } }],
};
test('SDK uses optional department references without a fixed organizational list', () => {
  assert.ok(matchesWorkflow(base, { text: 'laptop' }));
  assert.ok(matchesWorkflow(base, { text: 'laptop', department: 'Research Operations' }));
  const id = '6ae644edd1dcb5f765377ae0';
  const restricted = { ...base, trigger: { ...base.trigger, departmentId: id } };
  assert.equal(defineWorkflow(restricted).trigger.departmentId, id);
  assert.equal(matchesWorkflow(restricted, { text: 'laptop', departmentId: id }), true);
  assert.equal(matchesWorkflow(restricted, { text: 'laptop' }), false);
  assert.equal(
    matchesWorkflow(restricted, { text: 'laptop', departmentId: '6ae644edd1dcb5f765377ae1' }),
    false,
  );
  assert.match(toTypeScript(restricted), /departmentId/);
  for (const departmentId of ['invented-name', 123456789012345678901234, {}, null])
    assert.throws(() => defineWorkflow({ ...base, trigger: { ...base.trigger, departmentId } }));
});
