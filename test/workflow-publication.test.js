import test from 'node:test';
import assert from 'node:assert/strict';
import { hasWorkflowChanges } from '../src/services/workflows/workflowPublication.js';

test('publication stays unchanged after saving, but metadata or executable edits enable publishing', () => {
  const definition = {
    version: 1,
    name: 'Access Request',
    trigger: { phrases: ['access'] },
    steps: [{ id: 'route', action: 'route', params: { queueName: 'App Support' } }],
  };
  const published = { definition, source: 'export default workflow;' };
  assert.equal(
    hasWorkflowChanges(
      { steps: definition.steps, trigger: definition.trigger, name: definition.name, version: 1 },
      published.source,
      published,
    ),
    false,
  );
  assert.equal(
    hasWorkflowChanges({ ...definition, name: 'New Access Request' }, published.source, published),
    true,
  );
  assert.equal(hasWorkflowChanges(definition, 'export default updatedWorkflow;', published), true);
  assert.equal(hasWorkflowChanges(definition, published.source, published), false);
});
