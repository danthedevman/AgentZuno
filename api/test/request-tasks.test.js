import { searchWorkspace } from '../src/workspace/globalSearch.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createHelpdeskService } from '../src/requests/helpdesk.js';
import { createRequestTasks } from '../src/requests/requestTasks.js';
import { createAdminData } from '../src/data/adminData.js';
import {
  allowedRequestActions,
  validateRequestAction,
} from '../src/requests/requestChatActions.js';
import { inspectWorkflowSource } from '../src/workflows/workflowRuntime.js';

test('approval rejection flags normalize from parameters without weakening validation', async () => {
  const source = `import {defineWorkflow} from '@agentzuno/workflows';
  export default defineWorkflow({version:1,name:'Approval',trigger:{phrases:['approval']},steps:[{id:'approve',action:'approval',params:{target:'manager',reason:'Review',requireRejectionComment:true}}],async run(ctx){await ctx.approval('approve',{target:'manager',reason:'Review'});}});`;
  const definition = await inspectWorkflowSource(source);
  assert.equal(definition.steps[0].requireRejectionComment, true);
  await assert.rejects(
    inspectWorkflowSource(
      source.replace('requireRejectionComment:true', 'requireRejectionComment:"yes"'),
    ),
    /TypeScript|rejection/i,
  );
});

test(
  'request tasks enforce roles, parent access, assignment groups, versions, idempotency and built-in data projection',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const database = `agentzuno_tasks_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    process.env.MONGODB_DATABASE = database;
    const store = createIntegrationStore();
    const client = new MongoClient(process.env.MONGODB_URI);
    const admin = {
      id: 'admin',
      helpdeskOwnerId: 'admin',
      workspaceId: 'workspace',
      role: 'admin',
    };
    const agent = { ...admin, id: 'agent', role: 'agent', queues: ['Desktop'] };
    const employee = { ...admin, id: 'employee', role: 'user' };
    const requestId = new ObjectId();
    const scope = { ownerId: 'admin', workspaceId: 'workspace' };
    try {
      await store.ready();
      await store.collection('helpdeskRequests').insertOne({
        _id: requestId,
        ...scope,
        requesterId: employee.id,
        title: 'Laptop',
        description: 'Laptop help',
        status: 'open',
        queueName: 'Desktop',
        chatId: String(new ObjectId()),
        version: 1,
      });
      const tasks = createRequestTasks(store);
      for (const actor of [employee, { ...admin, role: 'read-only' }, { ...agent, queues: ['HR'] }])
        await assert.rejects(
          tasks.create(actor, String(requestId), { title: 'Set up laptop' }),
          (e) => [403, 404].includes(e.status),
        );
      const task = await tasks.create(
        agent,
        String(requestId),
        { title: 'Set up laptop', description: 'Install apps' },
        'once',
      );
      assert.equal(
        (await tasks.create(agent, String(requestId), { title: 'Set up laptop' }, 'once')).id,
        task.id,
      );
      assert.equal((await tasks.list(employee, String(requestId))).length, 1);
      await assert.rejects(tasks.list({ ...employee, id: 'other' }, String(requestId)), {
        status: 404,
      });
      await assert.rejects(tasks.list({ ...admin, workspaceId: 'elsewhere' }, String(requestId)), {
        status: 404,
      });
      await assert.rejects(
        tasks.update(employee, String(requestId), task.id, { status: 'closed', version: 1 }),
        { status: 403 },
      );
      await assert.rejects(
        tasks.update({ ...agent, queues: ['HR'] }, String(requestId), task.id, {
          status: 'closed',
          version: 1,
        }),
        { status: 404 },
      );
      const operatorChatId = new ObjectId();
      await store.collection('chats').insertOne({
        _id: operatorChatId,
        ownerId: agent.id,
        workspaceId: agent.workspaceId,
        helpdeskPurpose: 'support',
        helpdeskRequestId: String(requestId),
        operatorRequestId: String(requestId),
        status: 'complete',
        messages: [
          {
            id: 'create-task-action',
            role: 'assistant',
            requestAction: {
              action: 'create-task',
              title: 'Check encryption',
              requestId: String(requestId),
              number: 'REQ-TEST',
              version: 1,
              state: 'pending',
            },
          },
        ],
      });
      const helpdesk = createHelpdeskService(store, {
        get: async (actor, id) =>
          store
            .collection('chats')
            .findOne({ _id: new ObjectId(id), ownerId: actor.id, workspaceId: actor.workspaceId }),
      });
      await helpdesk.applyChatAction(agent, String(operatorChatId), {
        messageId: 'create-task-action',
      });
      await assert.rejects(
        helpdesk.applyChatAction(agent, String(operatorChatId), {
          messageId: 'create-task-action',
        }),
        { status: 409 },
      );
      assert.equal((await tasks.list(employee, String(requestId))).length, 2);
      const closed = await tasks.update(agent, String(requestId), task.id, {
        status: 'closed',
        version: 1,
      });
      assert.equal(closed.closedBy, agent.id);
      assert.equal(closed.events.length, 2);
      await assert.rejects(
        tasks.update(agent, String(requestId), task.id, { status: 'open', version: 1 }),
        { status: 409 },
      );
      assert.equal(
        allowedRequestActions(employee, { requesterId: employee.id, status: 'open' }).includes(
          'create-task',
        ),
        false,
      );
      assert.equal(
        allowedRequestActions(agent, {
          requesterId: employee.id,
          status: 'open',
          queueName: 'Desktop',
        }).includes('close-task'),
        true,
      );
      assert.throws(
        () =>
          validateRequestAction(
            employee,
            { requesterId: employee.id, status: 'open' },
            { action: 'close-task', taskId: task.id, taskVersion: 2 },
          ),
        { status: 403 },
      );
      await store
        .collection('helpdeskRequests')
        .updateOne(
          { _id: requestId },
          { $set: { formSubmission: { answers: [{ label: 'Site', value: 'Sapphire Portal' }] } } },
        );
      const found = await searchWorkspace(store, employee, 'Sapphire', helpdesk);
      assert.ok(found.some((item) => item.type === 'Request' && item.title === 'Laptop'));
      assert.deepEqual(
        await searchWorkspace(store, { ...employee, id: 'outsider' }, 'Sapphire', helpdesk),
        [],
      );
      assert.ok(
        (await searchWorkspace(store, employee, 'Set up laptop', helpdesk)).some(
          (item) => item.type === 'Task',
        ),
      );
      const data = createAdminData(store);
      const definition = await data.table(admin, 'ref-task');
      assert.equal(definition.system, true);
      assert.ok(definition.protectedFields.includes('request'));
      const records = await data.records(admin, 'ref-task');
      assert.equal(records[0].values.request, String(requestId));
      assert.equal(records[0].values.status, 'closed');
      await store
        .collection('helpdeskRequests')
        .updateOne({ _id: requestId }, { $set: { status: 'resolved' } });
      await assert.rejects(tasks.create(admin, String(requestId), { title: 'Another' }), {
        status: 409,
      });
      assert.ok(
        await store
          .collection('governanceAudit')
          .findOne({ target: 'helpdeskTasks', ownerId: 'admin' }),
      );
    } finally {
      await store.close();
      await client.connect();
      await client.db(database).dropDatabase();
      await client.close();
    }
  },
);
