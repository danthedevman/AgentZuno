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
import { applyAdminGroupAction } from '../src/adminGroupActions.js';
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
      const group = await database
        .collection('approvalGroups')
        .findOne({ ...scope, name: 'Salesforce Support' });
      assert.ok(group, 'The group must be persisted before generating the workflow');
      assert.match(JSON.parse(options.body).instructions, /Server-confirmed group result: Created/);
      return Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: 'I cannot create the group myself.\n```typescript\n' + source + '\n```',
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
    assert.match(completed.messages.at(-1).text, /```typescript/);
    assert.doesNotMatch(completed.messages.at(-1).text, /cannot create/);
    const persisted = await database.collection('chats').findOne({ _id: new ObjectId(chat.id) });
    const followup = {
      ...persisted,
      responseId: randomUUID(),
      messages: [...persisted.messages, { role: 'user', text: 'can you add the group' }],
    };
    assert.match(
      await applyAdminGroupAction(store, followup, 'I am proposing it again'),
      /^Found the existing group \[Salesforce Support\]/,
    );
    assert.equal(
      await database
        .collection('approvalGroups')
        .countDocuments({ ...scope, name: 'Salesforce Support' }),
      1,
    );
    assert.equal(
      await database
        .collection('governanceAudit')
        .countDocuments({ ...scope, action: 'admin-chat-create-group', outcome: 'completed' }),
      1,
    );
    const missing = {
      ...followup,
      messages: [
        { role: 'user', text: prompt.replaceAll('salesforce', 'analytics') },
        { role: 'user', text: 'can you add the group' },
      ],
    };
    assert.match(await applyAdminGroupAction(store, missing, ''), /^Created \[Analytics Support\]/);
    const iamMessages = [
      {
        role: 'user',
        text: 'create a task for that group to provision the role, and one for the IAM team to update in Okta',
      },
      { role: 'user', text: 'what about the IAM team' },
      { role: 'user', text: 'create it IAM' },
    ];
    assert.match(
      await applyAdminGroupAction(store, { ...followup, messages: iamMessages }, ''),
      /^Created \[IAM\]/,
    );
    assert.match(
      await applyAdminGroupAction(
        store,
        {
          ...followup,
          responseId: randomUUID(),
          messages: [...iamMessages, { role: 'user', text: 'create it now' }],
        },
        '',
      ),
      /^Found the existing group \[IAM\]/,
    );
    assert.equal(
      await database.collection('approvalGroups').countDocuments({ ...scope, name: 'IAM' }),
      1,
    );
    for (const text of [
      "Don't create the group",
      'Describe the group',
      'How can I create the group?',
    ]) {
      const denied = {
        ...followup,
        messages: [
          { role: 'user', text: prompt.replaceAll('salesforce', 'forbidden') },
          { role: 'user', text },
        ],
      };
      await applyAdminGroupAction(store, denied, '');
      assert.equal(
        await database
          .collection('approvalGroups')
          .countDocuments({ ...scope, name: 'Forbidden Support' }),
        0,
      );
    }
    await assert.rejects(applyAdminGroupAction(store, { ...missing, actionRole: 'user' }, ''), {
      status: 403,
    });
    const other = { ...missing, workspaceId: String(new ObjectId()) };
    await assert.rejects(applyAdminGroupAction(store, other, ''), { status: 403 });
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
