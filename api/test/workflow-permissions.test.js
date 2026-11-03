import test from 'node:test';
import assert from 'node:assert/strict';
import { defineWorkflowPermissions, canUseWorkflow, runWorkflow } from '../sdk/workflows/index.js';
test('workflow permissions require explicit typed grants and apply before SDK execution', async () => {
  const permissions = defineWorkflowPermissions({
    audience: 'restricted',
    userIds: ['employee'],
    queueNames: ['Desktop'],
  });
  assert.equal(canUseWorkflow({ permissions }, { id: 'employee', role: 'user' }), true);
  assert.equal(
    canUseWorkflow({ permissions }, { id: 'other', role: 'agent', queues: ['Desktop'] }),
    true,
  );
  assert.equal(
    canUseWorkflow({ permissions }, { id: 'other', role: 'user', queues: ['Desktop'] }),
    false,
  );
  assert.equal(canUseWorkflow({ permissions }, { id: 'admin', role: 'admin' }), false);
  assert.equal(
    canUseWorkflow({ permissions }, { id: 'admin', role: 'admin', queues: ['Desktop'] }),
    true,
  );
  assert.equal(canUseWorkflow({ permissions }), false);
  assert.throws(() =>
    defineWorkflowPermissions({ audience: 'restricted', userIds: [], queueNames: [] }),
  );
  assert.throws(() =>
    defineWorkflowPermissions({ audience: 'workspace', userIds: ['employee'], queueNames: [] }),
  );
  const workflow = {
    version: 1,
    name: 'Laptop',
    trigger: { department: 'it', phrases: ['laptop'] },
    steps: [{ id: 'route', action: 'route', params: { queueName: 'Desktop' } }],
    permissions,
  };
  const event = { id: 'request', workspaceId: 'workspace', department: 'it', text: 'laptop' };
  await assert.rejects(runWorkflow(workflow, event, { authorize: () => true }), /access/);
  assert.equal(
    (await runWorkflow(workflow, event, { actor: { id: 'employee' }, authorize: () => true }))
      .status,
    'planned',
  );
});
