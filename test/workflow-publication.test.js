import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasWorkflowChanges,
  workflowDraftSnapshot,
} from '../src/services/workflows/workflowPublication.js';

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

test('draft snapshots ignore property order but retain field and rule order', () => {
  const definition = {
    name: 'Access',
    form: { fields: [{ id: 'name' }, { id: 'reason' }] },
    routing: [{ id: 'first' }, { id: 'second' }],
  };
  const reordered = { routing: definition.routing, form: definition.form, name: definition.name };
  assert.equal(
    workflowDraftSnapshot(definition, 'source'),
    workflowDraftSnapshot(reordered, 'source'),
  );
  assert.notEqual(
    workflowDraftSnapshot(definition, 'source'),
    workflowDraftSnapshot({ ...definition, routing: [...definition.routing].reverse() }, 'source'),
  );
  assert.notEqual(
    workflowDraftSnapshot(definition, 'source'),
    workflowDraftSnapshot(definition, 'updated source'),
  );
});
