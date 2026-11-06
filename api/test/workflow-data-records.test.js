import { createChatService } from '../src/chat/chat.js';
import { createHelpdeskService } from '../src/requests/helpdesk.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createAdminData } from '../src/data/adminData.js';
import { createDataRecordOperations } from '../src/data/dataRecordOperations.js';
import { createHelpdeskWorkflows } from '../src/workflows/helpdeskWorkflows.js';
import { createWorkflowExecution } from '../src/workflows/workflowExecution.js';
import { createRequestTasks } from '../src/requests/requestTasks.js';
import { validateWorkflowAction } from '../src/workflows/workflowActionPolicy.js';
import { canReadRequest, canWorkRequest } from '../src/requests/requestPolicy.js';

async function verify(database) {
  const ownerId = String(new ObjectId()),
    workspaceId = String(new ObjectId());
  const scope = { ownerId, workspaceId },
    actors = {};
  for (const [name, role, queues] of [
    ['Admin', 'admin', []],
    ['Employee', 'user', []],
    ['Support', 'agent', ['Desktop']],
    ['Outside', 'agent', ['Other']],
    ['Audit', 'read-only', []],
  ]) {
    const id = name === 'Admin' ? ownerId : String(new ObjectId());
    actors[name] = {
      id,
      workspaceId,
      helpdeskOwnerId: ownerId,
      name,
      role,
      queues,
      readOnlyRequest: role === 'read-only',
    };
    await database.collection('users').insertOne({
      id,
      workspaceId: name === 'Admin' ? workspaceId : String(new ObjectId()),
      name,
      email: name + '@example.test',
    });
    await database
      .collection('helpdeskMembers')
      .insertOne({ ...scope, userId: id, role, queues, active: true });
  }
  await database.collection('approvalGroups').insertOne({
    ...scope,
    name: 'Desktop',
    active: true,
    assignmentEnabled: true,
    approvalEnabled: true,
    userIds: [actors.Support.id],
  });
  const store = { collection: database.collection.bind(database), ready: async () => {} },
    data = createAdminData(store),
    operations = createDataRecordOperations(store);
  const registrationTable = await data.saveTable(actors.Admin, null, {
    definition: {
      name: 'Test Records',
      description: 'AI tool registrations',
      fields: [
        { id: 'name', label: 'AI tool name', type: 'text', required: true },
        { id: 'description', label: 'Description', type: 'text', required: true },
        {
          id: 'request',
          label: 'Request',
          type: 'reference',
          referenceTable: 'ref-request',
          required: true,
        },
      ],
    },
  });
  const registrationDefinition = {
    version: 1,
    name: 'Register AI tool',
    trigger: { department: 'it' },
    form: {
      title: 'Register AI tool',
      fields: [
        { id: 'tool-name', label: 'AI tool name', type: 'text', required: true },
        { id: 'description', label: 'Description', type: 'textarea', required: true },
      ],
    },
    steps: [
      {
        id: 'register-tool',
        action: 'data.create',
        params: {
          tableId: registrationTable.id,
          fields: ['name', 'description', 'request'],
        },
      },
    ],
  };
  const registrationSource = `import {defineWorkflow} from '@agentzuno/workflows';
    export default defineWorkflow({...${JSON.stringify(registrationDefinition)}, async run(ctx) {
      await ctx.data.create('register-tool', {tableId:'${registrationTable.id}',
        values:{name:String(ctx.answers['tool-name']),description:String(ctx.answers.description),request:String(ctx.request.id)}});
    }});`;
  const registration = await createHelpdeskWorkflows(store, {}).save(actors.Admin, null, {
    source: registrationSource,
    enabled: true,
    intent: 'publish',
  });
  assert.equal(registration.queueName, '');
  const registrationChats = createChatService(store, async () => {});
  const registrationService = createHelpdeskService(store, registrationChats);
  const registrationChat = await registrationService.createSupport(actors.Employee, {
    requestId: crypto.randomUUID(),
    workflowId: registration.id,
  });
  const registrationOffer = await registrationService.getSupport(
    actors.Employee,
    registrationChat.id,
  );
  const registrationTicket = await registrationService.submitForm(
    actors.Employee,
    registrationChat.id,
    {
      workflowId: registration.id,
      workflowVersion: registration.version,
      offerId: registrationOffer.responseId,
      answers: { 'tool-name': 'Example AI', description: 'Draft internal documentation' },
    },
  );
  const registrationRequest = await database.collection('helpdeskRequests').findOne({
    ...scope,
    _id: new ObjectId(registrationTicket.id),
  });
  assert.equal(registrationRequest.status, 'open');
  assert.equal(registrationRequest.queueName, '');
  const registrationExecutor = createWorkflowExecution(store);
  const registrationRunId = await registrationExecutor.ensureRun(registrationRequest);
  await registrationExecutor.process(registrationRunId);
  const registrationRun = await store
    .collection('workflowRuns')
    .findOne({ _id: registrationRunId });
  assert.equal(registrationRun.status, 'complete', JSON.stringify(registrationRun));
  const registered = await data.records(actors.Admin, registrationTable.id);
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].values, {
    name: 'Example AI',
    description: 'Draft internal documentation',
    request: String(registrationRequest._id),
  });
  assert.equal(
    (await store.collection('helpdeskRequests').findOne({ _id: registrationRequest._id })).status,
    'resolved',
  );
  assert.equal(await store.collection('helpdeskTasks').countDocuments({ ...scope }), 0);
  await registrationExecutor.process(registrationRunId);
  assert.equal((await data.records(actors.Admin, registrationTable.id)).length, 1);
  const created = await operations.mutate(
    actors.Admin,
    'ref-asset',
    'create',
    null,
    { name: 'MacBook Test', status: 'Available' },
    null,
    'create-asset',
  );
  assert.equal(
    (
      await operations.mutate(
        actors.Admin,
        'ref-asset',
        'create',
        null,
        { name: 'MacBook Test', status: 'Available' },
        null,
        'create-asset',
      )
    ).id,
    created.id,
  );
  for (const name of ['Employee', 'Support', 'Outside', 'Audit'])
    await assert.rejects(
      operations.mutate(
        actors[name],
        'ref-asset',
        'update',
        created.id,
        { status: 'In Use' },
        1,
        'denied',
      ),
      (error) => error.status === 403,
    );
  for (const invalid of [{ $ne: null }, ['ref-asset'], 3])
    await assert.rejects(data.records(actors.Admin, invalid), (error) => error.status === 400);
  const definition = {
    version: 1,
    name: 'Hardware Assignment',
    trigger: { department: 'it', phrases: ['hardware'] },
    form: {
      title: 'Hardware Assignment',
      fields: [
        {
          id: 'asset',
          label: 'Asset',
          type: 'reference',
          required: true,
          referenceTable: 'ref-asset',
        },
      ],
    },
    steps: [
      { id: 'route', action: 'route', params: { queueName: 'Desktop' } },
      {
        id: 'deliver',
        action: 'task.create',
        params: {
          queueName: 'Desktop',
          title: 'Deliver laptop',
          description: 'Hand over the hardware',
        },
      },
      { id: 'wait-delivery', action: 'task.wait', params: { taskStepId: 'deliver' } },
      {
        id: 'read-asset',
        action: 'data.read',
        params: { tableId: 'ref-asset', recordIdField: 'asset', fields: ['status'] },
      },
      {
        id: 'assign-asset',
        action: 'data.update',
        params: { tableId: 'ref-asset', recordIdField: 'asset', fields: ['status', 'assigned-to'] },
      },
    ],
  };
  const source = `import {defineWorkflow} from '@agentzuno/workflows'; export default defineWorkflow({...${JSON.stringify(definition)}, async run(ctx) { await ctx.route('route','Desktop'); const task = await ctx.tasks.create('deliver',{queueName:'Desktop',title:'Deliver laptop',description:'Hand over the hardware'}); await ctx.tasks.wait('wait-delivery',{taskId:task.id}); const asset = await ctx.data.read('read-asset',{tableId:'ref-asset',recordId:String(ctx.answers.asset)}); await ctx.data.update('assign-asset',{tableId:'ref-asset',recordId:asset.id,version:asset.version,values:{status:'In Use','assigned-to':String(ctx.requester.id)}}); }});`;
  const workflows = createHelpdeskWorkflows(store, {});
  const workflow = await workflows.save(actors.Admin, null, {
    source,
    name: definition.name,
    department: 'it',
    keywords: ['hardware'],
    action: 'route',
    queueName: 'Desktop',
    enabled: true,
    intent: 'publish',
  });
  const request = {
    _id: new ObjectId(),
    ...scope,
    requesterId: actors.Employee.id,
    queueName: 'Desktop',
    status: 'open',
    title: 'Hardware Assignment',
    number: 'REQ-000001',
    submissionState: 'submitted',
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    version: 1,
    messages: [],
    workNotes: [],
    events: [],
    approvals: [],
    formSubmission: { answers: [{ id: 'asset', value: created.id }] },
  };
  await database.collection('helpdeskRequests').insertOne(request);
  for (const [name, visible, editable] of [
    ['Admin', true, true],
    ['Employee', true, false],
    ['Support', true, true],
    ['Outside', false, false],
    ['Audit', true, false],
  ]) {
    assert.equal(await canReadRequest(store, actors[name], request), visible);
    assert.equal(canWorkRequest(actors[name], request), editable);
    assert.equal(
      await canReadRequest(
        store,
        { ...actors[name], workspaceId: String(new ObjectId()) },
        request,
      ),
      false,
    );
  }
  assert.throws(
    () =>
      validateWorkflowAction(definition, 'data.update', 'assign-asset', {
        tableId: 'ref-asset',
        recordId: created.id,
        version: 1,
        values: { 'purchase-cost': 99 },
      }),
    (error) => error.status === 403,
  );
  const executor = createWorkflowExecution(store),
    runId = await executor.ensureRun(request);
  await executor.process(runId);
  let run = await store.collection('workflowRuns').findOne({ _id: runId });
  assert.equal(run.status, 'waiting-for-task', JSON.stringify(run));
  assert.equal(
    (await operations.read(actors.Admin, 'ref-asset', created.id)).values.status,
    'Available',
  );
  const task = await store
    .collection('helpdeskTasks')
    .findOne({ ...scope, requestId: String(request._id) });
  await createRequestTasks(store).update(actors.Support, String(request._id), String(task._id), {
    status: 'closed',
    version: 1,
  });
  await executor.recover();
  await executor.process(runId);
  run = await store.collection('workflowRuns').findOne({ _id: runId });
  assert.equal(run.status, 'complete', JSON.stringify(run));
  const assigned = await operations.read(actors.Admin, 'ref-asset', created.id);
  assert.equal(assigned.values.status, 'In Use');
  assert.equal(assigned.values['assigned-to'], actors.Employee.id);
  assert.deepEqual(Object.keys(run.steps.find((item) => item.id === 'read-asset').result.values), [
    'status',
  ]);
  assert.equal(await store.collection('helpdeskTasks').countDocuments({ ...scope }), 1);
  // Replaying a saved mutation reuses the atomic receipt rather than incrementing again.
  const updateKey = `workflow:${runId}:assign-asset`;
  const replay = await operations.mutate(
    actors.Admin,
    'ref-asset',
    'update',
    created.id,
    { status: 'In Use', 'assigned-to': actors.Employee.id },
    1,
    updateKey,
  );
  assert.equal(replay.version, 2);
  assert.equal((await operations.read(actors.Admin, 'ref-asset', created.id)).version, 2);
  await assert.rejects(
    operations.mutate(
      actors.Admin,
      'ref-asset',
      'update',
      created.id,
      { status: 'Lost' },
      1,
      'stale',
    ),
    (error) => error.status === 409,
  );
  const review = await operations.prepareDelete(
    actors.Admin,
    'ref-asset',
    created.id,
    2,
    'delete-asset',
  );
  assert.equal(
    (await operations.read(actors.Admin, 'ref-asset', created.id)).values.status,
    'In Use',
  );
  await assert.rejects(
    operations.confirmDelete(actors.Employee, review.proposalId, {
      confirmed: true,
      name: 'MacBook Test',
    }),
    (error) => error.status === 403,
  );
  await assert.rejects(
    operations.confirmDelete(actors.Admin, review.proposalId, {
      confirmed: false,
      name: 'MacBook Test',
    }),
    (error) => error.status === 400,
  );
  await operations.confirmDelete(actors.Admin, review.proposalId, {
    confirmed: true,
    name: 'MacBook Test',
  });
  await assert.rejects(
    operations.read(actors.Admin, 'ref-asset', created.id),
    (error) => error.status === 404,
  );
  await assert.rejects(
    operations.mutate(
      actors.Admin,
      'ref-user',
      'create',
      null,
      { name: 'Bypass' },
      null,
      'protected',
    ),
    (error) => error.status === 409,
  );
}
test('workflow data CRUD, task completion and role matrix in memory', () =>
  verify(createMemoryDatabase()));
test(
  'workflow data CRUD and replay with MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI),
      db = client.db('az_data_workflow_' + new ObjectId());
    try {
      await verify(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
test(
  'workflow data CRUD and replay with PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const config = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(config),
      name = 'az_data_workflow_' + new ObjectId();
    await admin.query(`CREATE DATABASE ${name}`);
    const db = createPostgresDatabase({ ...config, database: name });
    try {
      await verify(db);
    } finally {
      await db.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  },
);
