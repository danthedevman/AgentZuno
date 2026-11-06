import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createChatService } from '../src/chat/chat.js';
import { defineWorkflow } from '../sdk/workflows/index.js';
import {
  createChannelRequestForms,
  slackRequestModal,
  slackRequestAnswers,
  teamsRequestCard,
  teamsRequestAnswers,
  prepareChannelRequestDraft,
} from '../src/channels/channelRequestForms.js';

async function verify(database) {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = createIntegrationStore(database);
  await store.ready();
  const owner = {
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    role: 'admin',
    name: 'Owner',
    email: 'owner@fixture.test',
  };
  owner.helpdeskOwnerId = owner.id;
  await store.collection('users').insertOne(owner);
  const employee = {
    id: String(new ObjectId()),
    workspaceId: owner.workspaceId,
    helpdeskOwnerId: owner.id,
    role: 'user',
  };
  await store.collection('users').insertOne({
    id: employee.id,
    workspaceId: String(new ObjectId()),
    email: 'employee@fixture.test',
  });
  await store.collection('helpdeskMembers').insertOne({
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    userId: employee.id,
    role: 'user',
    active: true,
    queues: [],
  });
  await store
    .collection('helpdeskQueues')
    .insertOne({ ownerId: owner.id, workspaceId: owner.workspaceId, name: 'App Support' });
  const definition = defineWorkflow({
    version: 1,
    name: 'Salesforce Access',
    displayInCatalog: false,
    trigger: { department: 'it', phrases: ['salesforce'] },
    steps: [{ id: 'route-request', action: 'route', params: { queueName: 'App Support' } }],
    form: {
      title: 'Salesforce Access',
      fields: [
        {
          id: 'access',
          label: 'Access',
          type: 'select',
          required: true,
          options: ['Read Only', 'Editor'],
        },
        { id: 'reason', label: 'Justification', type: 'textarea', required: true },
        { id: 'extra', label: 'Extra', type: 'boolean', required: false },
      ],
    },
  });
  const workflow = {
    _id: new ObjectId(),
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    name: definition.name,
    enabled: true,
    version: 1,
    publishedRevision: 1,
    department: 'it',
    action: 'route',
    queueName: 'App Support',
    keywords: ['salesforce'],
    definition,
  };
  await store.collection('helpdeskWorkflows').insertOne(workflow);
  const chats = createChatService(store, async () => {}),
    forms = createChannelRequestForms(store, chats);
  const source = {
    _id: new ObjectId(),
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    slackGeneration: 'fixture',
    generation: 'fixture',
  };
  const chat = {
    _id: new ObjectId(),
    helpdeskPurpose: 'slack-support',
    messages: [{ role: 'user', text: 'I need salesforce read only to review integrations' }],
  };
  const draft = await prepareChannelRequestDraft(store, chat, employee, {
    workflowId: String(workflow._id),
    answers: [
      { fieldId: 'access', value: 'Read Only' },
      { fieldId: 'reason', value: 'Review integrations' },
    ],
  });
  assert.equal(draft.missing.length, 0);
  await assert.rejects(
    prepareChannelRequestDraft(store, chat, employee, {
      workflowId: String(workflow._id),
      answers: [{ fieldId: 'invented', value: 'bad' }],
    }),
  );
  for (const provider of ['slack', 'teams']) {
    const session = await forms.offer(
      provider,
      source,
      employee,
      'salesforce',
      provider,
      draft.proposal,
    );
    assert.ok(session);
    assert.equal(session.ready, true);
    assert.equal(
      await store.collection('helpdeskRequests').countDocuments({}),
      provider === 'slack' ? 0 : 1,
    );
    const modal = slackRequestModal(session);
    assert.equal(modal.blocks.length, 3);
    assert.equal(modal.blocks[0].element.initial_option.value, 'Read Only');
    const values = {
      field_0: { answer: { selected_option: { value: 'Read Only' } } },
      field_1: { answer: { value: 'Review integrations' } },
      field_2: { answer: { selected_option: { value: 'No' } } },
    };
    const answers =
      provider === 'slack'
        ? slackRequestAnswers(session, values)
        : teamsRequestAnswers(session, {
            agentzunoAction: 'submit-request',
            sessionId: String(session._id),
            access: 'Read Only',
            reason: 'Review integrations',
            extra: 'false',
          });
    assert.deepEqual(answers, { access: 'Read Only', reason: 'Review integrations', extra: false });
    assert.equal(teamsRequestCard(session, forms.portal).content.body[1].value, 'Read Only');
    await assert.rejects(forms.load(provider, source, employee, { $ne: null }), { status: 400 });
    await assert.rejects(
      forms.load(
        provider,
        { ...source, generation: 'changed', slackGeneration: 'changed' },
        employee,
        String(session._id),
      ),
      { status: 409 },
    );
    await assert.rejects(
      forms.submit(provider, source, employee, String(session._id), {
        ...answers,
        access: 'Admin',
      }),
      { status: 400 },
    );
    const first = await forms.submit(provider, source, employee, String(session._id), answers);
    const again = await forms.submit(provider, source, employee, String(session._id), answers);
    assert.equal(first.number, again.number);
    assert.match(first.url, /\/chat\//);
    await store
      .collection('helpdeskMembers')
      .updateOne({ userId: employee.id }, { $set: { active: false } });
    await assert.rejects(forms.load(provider, source, employee, String(session._id)), {
      status: 403,
    });
    await store
      .collection('helpdeskMembers')
      .updateOne({ userId: employee.id }, { $set: { active: true } });
  }
  assert.equal(await store.collection('helpdeskRequests').countDocuments({}), 2);
  assert.ok(
    (await store
      .collection('governanceAudit')
      .countDocuments({ action: 'slack-request-submission' })) >= 0,
  );
  await store.close();
}
test('native request forms validate fields and preserve permissions and idempotent submission', () =>
  verify(createMemoryDatabase()));
test('native request forms on MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI);
  await client.connect();
  const db = client.db('az_native_forms_' + new ObjectId());
  try {
    await verify(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
test('native request forms on PostgreSQL', { skip: !process.env.TEST_POSTGRES_URL }, async () => {
  const config = postgresConnection(process.env.TEST_POSTGRES_URL),
    admin = new pg.Pool(config),
    name = 'az_native_forms_' + new ObjectId();
  await admin.query(`CREATE DATABASE ${name}`);
  const db = createPostgresDatabase({ ...config, database: name });
  try {
    await verify(db);
  } finally {
    await db.close();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
});
