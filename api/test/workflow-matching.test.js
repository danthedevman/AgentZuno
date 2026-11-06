import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { defineWorkflow } from '../sdk/workflows/index.js';
import {
  requestWorkflowChoices,
  selectedRequestWorkflow,
} from '../src/workflows/requestWorkflowSelection.js';
import { agentTools, executeAgentTool } from '../src/chat/agentToolRegistry.js';
import { createHelpdeskService } from '../src/requests/helpdesk.js';

async function verify(database) {
  const ownerId = String(new ObjectId()),
    workspaceId = String(new ObjectId()),
    personId = String(new ObjectId());
  const scope = { ownerId, workspaceId };
  const person = { id: personId, workspaceId, helpdeskOwnerId: ownerId, role: 'user', queues: [] };
  await database.collection('users').insertMany([
    { id: ownerId, workspaceId, name: 'Administrator' },
    { id: personId, workspaceId: String(new ObjectId()), name: 'Employee' },
  ]);
  await database
    .collection('helpdeskMembers')
    .insertOne({ ...scope, userId: personId, role: 'user', active: true, queues: [] });
  const store = { collection: database.collection.bind(database), ready: async () => {} };
  const definition = defineWorkflow({
    version: 1,
    name: 'Register AI tool',
    trigger: {},
    settings: { description: 'Register software used for artificial intelligence.' },
    permissions: { audience: 'restricted', userIds: [personId], queueNames: [] },
    steps: [{ id: 'route', action: 'route', params: { queueName: 'IT' } }],
    form: {
      title: 'Register AI tool',
      fields: [
        { id: 'name', label: 'AI tool name', type: 'text', required: true },
        { id: 'description', label: 'Description', type: 'textarea', required: true },
      ],
    },
  });
  assert.deepEqual(definition.trigger.phrases, []);
  const id = new ObjectId();
  await database.collection('helpdeskWorkflows').insertMany([
    {
      _id: id,
      ...scope,
      enabled: true,
      version: 1,
      publishedRevision: 1,
      publishedConfig: { name: definition.name, definition },
      definition,
      name: definition.name,
    },
    { ...scope, enabled: false, name: 'Unpublished', definition },
    {
      ownerId: String(new ObjectId()),
      workspaceId,
      enabled: true,
      definition,
      name: 'Other owner',
    },
    {
      ...scope,
      workspaceId: String(new ObjectId()),
      enabled: true,
      definition,
      name: 'Other workspace',
    },
    {
      ...scope,
      enabled: true,
      name: 'Hidden',
      definition: {
        ...definition,
        permissions: { audience: 'restricted', userIds: [ownerId], queueNames: [] },
      },
    },
    {
      ...scope,
      enabled: true,
      name: 'Other department',
      definition: { ...definition, trigger: { departmentId: String(new ObjectId()) } },
    },
  ]);
  const choices = await requestWorkflowChoices(store, person);
  assert.deepEqual(
    choices.map((choice) => choice.workflowId),
    [String(id)],
  );
  assert.equal(choices[0].description, definition.settings.description);
  const chat = {
    _id: new ObjectId(),
    ownerId: personId,
    providerOwnerId: ownerId,
    workspaceId,
    assistantType: 'support',
    helpdeskPurpose: 'support',
    actionRole: 'user',
    responseId: 'response-1',
    status: 'complete',
    messages: [
      {
        id: 'question',
        role: 'user',
        text: 'Please put our new writing assistant on the approved inventory.',
      },
      { id: 'response-1', role: 'assistant', text: 'Review this form.', proposals: {} },
    ],
  };
  await database.collection('chats').insertOne(chat);
  const service = createHelpdeskService(store, { get: async () => structuredClone(chat) });
  // Merely mentioning a workflow never selects it without a provider tool call.
  assert.equal((await service.getSupport(person, String(chat._id))).requestForm, null);
  const names = (await agentTools(store, chat)).map((tool) => tool.name);
  assert.ok(names.includes('listRequestWorkflows'));
  assert.ok(names.includes('offerRequestForm'));
  assert.ok(!names.includes('proposeWorkflow'));
  const call = (workflowId) => ({
    id: 'choice',
    name: 'offerRequestForm',
    arguments: { workflowId },
  });
  const offered = await executeAgentTool(store, chat, call(String(id)));
  assert.equal(offered.proposal.kind, 'requestForm');
  chat.messages[1].proposals.requestForm = offered.proposal;
  let visible = await service.getSupport(person, String(chat._id));
  assert.equal(visible.requestForm.workflowId, String(id));
  assert.equal(visible.requestForm.title, 'Register AI tool');
  assert.equal(visible.requestForm.offerId, 'response-1');
  assert.equal(await database.collection('helpdeskRequests').countDocuments({ ...scope }), 0);
  for (const invalid of [{ $ne: null }, [String(id)], '', 1])
    await assert.rejects(selectedRequestWorkflow(store, person, invalid), { status: 400 });
  await assert.rejects(
    selectedRequestWorkflow(store, { ...person, workspaceId: String(new ObjectId()) }, String(id)),
    { status: 404 },
  );
  await assert.rejects(selectedRequestWorkflow(store, person, String(id), 2), { status: 409 });
  await database.collection('helpdeskWorkflows').updateOne(
    { _id: id },
    {
      $set: {
        'publishedConfig.definition.permissions': {
          audience: 'restricted',
          userIds: [ownerId],
          queueNames: [],
        },
      },
    },
  );
  assert.equal((await service.getSupport(person, String(chat._id))).requestForm, null);
  await assert.rejects(executeAgentTool(store, chat, call(String(id))), { status: 404 });
  await database
    .collection('helpdeskMembers')
    .updateOne({ ...scope, userId: personId }, { $set: { active: false } });
  await assert.rejects(executeAgentTool(store, chat, call(String(id))), { status: 403 });
}
test('provider-selected workflows need no phrase matching and are reauthorized before display', () =>
  verify(createMemoryDatabase()));
test(
  'provider workflow selection and revocation on MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI),
      db = client.db('az_workflow_selection_' + new ObjectId());
    try {
      await verify(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
test(
  'provider workflow selection and revocation on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const config = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(config),
      name = 'az_selection_' + new ObjectId();
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
