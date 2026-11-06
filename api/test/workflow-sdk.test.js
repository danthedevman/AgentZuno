import test from 'node:test';
import assert from 'node:assert/strict';
import { defineWorkflow, runWorkflow, toTypeScript } from '../sdk/workflows/index.js';
const definition = {
  version: 1,
  name: 'Office phone support',
  trigger: { department: 'it', phrases: ['office phone'] },
  steps: [
    {
      id: 'notify-support',
      action: 'slack.postMessage',
      params: { channel: 'support-desk', text: 'Phone setup help requested' },
    },
    {
      id: 'open-ticket',
      action: 'jira.createIssue',
      params: { project: 'DESKTOP', issueType: 'Task', summary: 'Office phone setup' },
    },
  ],
};
const event = {
  id: 'request-1',
  workspaceId: 'workspace-1',
  department: 'it',
  text: 'Please help set up my office phone',
};
test('workflow SDK validates plans and requires authorization, approval, auditing and idempotency for execution', async () => {
  assert.equal(defineWorkflow(definition).steps.length, 2);
  assert.ok(toTypeScript(definition).includes("from '@agentzuno/workflows'"));
  assert.throws(() =>
    defineWorkflow({
      ...definition,
      steps: [{ id: 'unsafe', action: 'eval', params: { code: 'process.exit()' } }],
    }),
  );
  assert.throws(() =>
    defineWorkflow({
      ...definition,
      steps: [
        { ...definition.steps[0], params: { ...definition.steps[0].params, token: 'secret' } },
      ],
    }),
  );
  const calls = [];
  const audits = [];
  const executed = new Set();
  const context = {
    mode: 'execute',
    workflowId: 'workflow-1',
    revision: '1',
    authorize: () => true,
    approve: () => true,
    audit: async (entry) => audits.push(entry),
    executeOnce: async (key, run) => {
      if (!executed.has(key)) {
        executed.add(key);
        return run();
      }
    },
    actions: {
      'slack.postMessage': async () => calls.push('slack'),
      'jira.createIssue': async () => calls.push('jira'),
    },
  };
  assert.equal((await runWorkflow(definition, event, { authorize: () => true })).status, 'planned');
  assert.equal(calls.length, 0);
  await assert.rejects(runWorkflow(definition, event, { ...context, approve: () => false }));
  await assert.rejects(runWorkflow(definition, event, { ...context, authorize: () => false }));
  await assert.rejects(runWorkflow(definition, event, { ...context, executeOnce: null }));
  assert.equal((await runWorkflow(definition, event, context)).status, 'completed');
  await runWorkflow(definition, event, context);
  assert.deepEqual(calls, ['slack', 'jira']);
  assert.ok(audits.every((entry) => !JSON.stringify(entry).includes('Phone setup')));
  await runWorkflow(definition, event, { ...context, workflowId: 'workflow-2' });
  assert.equal(calls.length, 4);
  assert.equal(
    (await runWorkflow(definition, { ...event, department: 'hr', text: 'VPN issue' }, context))
      .status,
    'not-matched',
  );
});
