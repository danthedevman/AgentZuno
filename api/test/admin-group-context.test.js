import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createChatService } from '../src/chat.js';
import { createAdminGroup } from '../src/adminGroupActions.js';
import { toTypeScript } from '../sdk/workflows/index.js';

async function verify(database) {
  const oldKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = createIntegrationStore(database);
  const owner = {
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    role: 'admin',
    email: 'admin@example.test',
  };
  await database.collection('users').insertOne(owner);
  const scope = { ownerId: owner.id, workspaceId: owner.workspaceId };
  const prompt =
    'I need a workflow to request access to salesforce and assign the ticket to salesforce support. Create the group if it doesnt exist';
  const definition = {
    version: 1,
    name: 'Salesforce Access Request',
    trigger: { phrases: ['request salesforce access'] },
    form: {
      title: 'Salesforce Access Request',
      fields: [
        { id: 'justification', label: 'Business Justification', type: 'textarea', required: true },
      ],
    },
    steps: [
      { id: 'route-salesforce', action: 'route', params: { queueName: 'Salesforce Support' } },
    ],
  };
  const source = toTypeScript(definition);
  const pending = [];
  const chats = createChatService(
    store,
    async (job) => pending.push(job),
    async (url, options) => {
      const body = JSON.parse(options.body);
      if (!body.input.some((item) => item.type === 'function_call_output'))
        return Response.json({
          output: [
            {
              type: 'function_call',
              call_id: 'salesforce-group',
              name: 'createGroup',
              arguments: JSON.stringify({
                name: 'Salesforce Support',
                description: '',
                routingInstructions: '',
                assignmentEnabled: true,
                approvalEnabled: true,
              }),
            },
          ],
        });
      if (
        !body.input.some(
          (item) => item.type === 'function_call_output' && item.call_id === 'workflow-draft',
        )
      )
        return Response.json({
          output: [
            {
              type: 'function_call',
              call_id: 'workflow-draft',
              name: 'proposeWorkflow',
              arguments: JSON.stringify({ source }),
            },
          ],
        });
      const group = await database
        .collection('approvalGroups')
        .findOne({ ...scope, name: 'Salesforce Support' });
      assert.ok(group, 'The group must be persisted before generating the workflow');
      assert.ok(body.input.some((item) => item.type === 'function_call_output'));
      return Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: 'Your workflow draft is ready to review.',
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
      { requestId: randomUUID(), text: prompt },
      { providerOwnerId: owner.id, assistantType: 'admin', helpdeskPurpose: 'workflow' },
    );
    await chats.process(pending.shift());
    const completed = await chats.get(owner, chat.id);
    assert.equal(completed.status, 'complete', JSON.stringify(completed));
    assert.match(completed.messages.at(-1).text, /^Created \[Salesforce Support\]/);
    assert.equal(completed.messages.at(-1).proposals.workflow.source, source);
    assert.doesNotMatch(completed.messages.at(-1).text, /cannot create/);
    const persisted = await database.collection('chats').findOne({ _id: new ObjectId(chat.id) });
    const followup = { ...persisted, responseId: randomUUID() };
    const input = {
      name: 'Salesforce Support',
      description: '',
      routingInstructions: '',
      assignmentEnabled: true,
      approvalEnabled: true,
    };
    assert.equal((await createAdminGroup(store, followup, input)).status, 'existing');
    assert.equal(
      await database
        .collection('approvalGroups')
        .countDocuments({ ...scope, name: 'Salesforce Support' }),
      1,
    );
    const iam = { ...input, name: 'IAM' };
    assert.equal((await createAdminGroup(store, followup, iam)).status, 'created');
    assert.equal(
      (await createAdminGroup(store, { ...followup, responseId: randomUUID() }, iam)).status,
      'existing',
    );
    for (const role of ['user', 'agent', 'read-only'])
      await assert.rejects(
        createAdminGroup(store, { ...followup, actionRole: role }, { ...input, name: 'Forbidden' }),
        { status: 403 },
      );
    await assert.rejects(
      createAdminGroup(store, { ...followup, workspaceId: String(new ObjectId()) }, input),
      { status: 403 },
    );
  } finally {
    await store.close();
    if (oldKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = oldKey;
  }
}

test('Salesforce group creation and contextual follow-ups complete in memory', () =>
  verify(createMemoryDatabase()));
test(
  'Admin group chat persists verified results with MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    const database = client.db('az_group_context_' + new ObjectId());
    try {
      await verify(database);
    } finally {
      await database.dropDatabase();
      await client.close();
    }
  },
);
test(
  'Admin group chat persists verified results with PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL);
    const admin = new pg.Pool(connection);
    const name = 'az_group_context_' + new ObjectId();
    await admin.query(`CREATE DATABASE ${name}`);
    const database = createPostgresDatabase({ ...connection, database: name });
    try {
      await verify(database);
    } finally {
      await database.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  },
);
