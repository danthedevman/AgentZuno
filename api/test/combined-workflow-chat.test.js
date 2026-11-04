import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createChatService } from '../src/chat.js';
import { createWorkflowExecution } from '../src/workflowExecution.js';
import { inspectWorkflowSource } from '../src/workflowRuntime.js';
import { toTypeScript } from '../sdk/workflows/index.js';

test('a combined Admin request saves its group, continues generation, and executes one scoped task after submission', async () => {
  const oldKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const database = createMemoryDatabase(),
    store = createIntegrationStore(database);
  const owner = {
    id: new ObjectId().toString(),
    workspaceId: new ObjectId().toString(),
    role: 'admin',
    email: 'admin@example.test',
  };
  const scope = { ownerId: owner.id, workspaceId: owner.workspaceId };
  const employee = { id: new ObjectId().toString(), workspaceId: new ObjectId().toString() };
  await database.collection('users').insertMany([owner, employee]);
  await database
    .collection('helpdeskMembers')
    .insertOne({ ...scope, userId: employee.id, role: 'user', active: true, queues: [] });
  const definition = {
    version: 1,
    name: 'Monday.com Request',
    trigger: { phrases: ['request monday.com'] },
    displayInCatalog: true,
    form: {
      title: 'Monday.com Request',
      fields: [
        { id: 'board-name', label: 'Board Name', type: 'text', required: true },
        { id: 'justification', label: 'Justification', type: 'textarea', required: true },
      ],
    },
    steps: [
      { id: 'route-app-support', action: 'route', params: { queueName: 'app support' } },
      {
        id: 'create-fulfillment-task',
        action: 'task.create',
        params: {
          queueName: 'app support',
          title: 'Fulfill Monday.com Request',
          description: 'Review the board name and justification on the request',
        },
      },
    ],
  };
  const source = toTypeScript(definition);
  const pending = [];
  let calls = 0;
  const chats = createChatService(
    store,
    async (job) => pending.push(job),
    async (url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(body.instructions.includes('app support'));
      assert.ok(
        await database.collection('approvalGroups').findOne({ ...scope, name: 'app support' }),
      );
      calls++;
      return Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text:
                  calls === 1
                    ? 'The group is ready.'
                    : 'The workflow collects the board name and justification, then creates a fulfillment task.\n```typescript\n' +
                      source +
                      '\n```',
              },
            ],
          },
        ],
      });
    },
  );
  try {
    await store.ready();
    await chats.ai.save(owner, {
      provider: 'openai',
      model: 'gpt-6.1-sol',
      instructions: '',
      maxOutputTokens: 4096,
      reasoning: 'medium',
      enabled: true,
      isDefault: true,
      apiKey: 'fictional-test-key',
    });
    const chat = await chats.create(
      owner,
      {
        requestId: randomUUID(),
        text: 'create a group called app support and an item for requesting monday.com. Ask for board name and justification. Assign a task to app support once submitted',
      },
      { providerOwnerId: owner.id, assistantType: 'admin', helpdeskPurpose: 'workflow' },
    );
    await chats.process(pending.shift());
    const completed = await chats.get(owner, chat.id);
    assert.equal(completed.status, 'complete', JSON.stringify(completed));
    assert.equal(calls, 2);
    assert.match(completed.messages.at(-1).text, /```typescript/);
    assert.match(completed.messages.at(-1).text, /Created \[app support\]/);
    assert.equal(await database.collection('helpdeskTasks').countDocuments(), 0);
    const validated = await inspectWorkflowSource(source);
    assert.deepEqual(
      validated.form.fields.map((field) => field.label),
      ['Board Name', 'Justification'],
    );
    const workflowId = new ObjectId();
    const config = { definition: validated, source };
    await database.collection('helpdeskWorkflows').insertOne({
      ...scope,
      _id: workflowId,
      enabled: true,
      publishedRevision: 1,
      publishedConfig: config,
    });
    const request = {
      ...scope,
      _id: new ObjectId(),
      requesterId: employee.id,
      submissionState: 'submitted',
      status: 'open',
      workflowId: String(workflowId),
      workflowVersion: 1,
      title: 'Monday.com Request',
      number: 'REQ-000001',
      version: 1,
      events: [],
      formSubmission: {
        answers: [
          { id: 'board-name', value: 'Product Launch' },
          { id: 'justification', value: 'Coordinate the launch' },
        ],
      },
    };
    await database.collection('helpdeskRequests').insertOne(request);
    const executor = createWorkflowExecution(store);
    const runId = await executor.ensureRun(request);
    await executor.process(runId);
    const run = await database.collection('workflowRuns').findOne({ _id: runId });
    assert.equal(run.status, 'complete', JSON.stringify(run));
    const tasks = await database
      .collection('helpdeskTasks')
      .find({ ...scope, requestId: String(request._id) })
      .toArray();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].queueName, 'app support');
    const taskAudit = await database
      .collection('governanceAudit')
      .findOne({ ...scope, action: 'workflow.task.create' });
    assert.equal(taskAudit.workflowId, String(workflowId));
    assert.equal(taskAudit.workflowRunId, runId);
    assert.equal(taskAudit.stepId, 'create-fulfillment-task');
    assert.equal(taskAudit.triggerType, 'workflow-step');
    await executor.process(runId);
    assert.equal(await database.collection('helpdeskTasks').countDocuments(), 1);
  } finally {
    await store.close();
    if (oldKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = oldKey;
  }
});
