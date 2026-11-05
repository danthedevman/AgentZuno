import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeActor } from '../src/knowledgeAccess.js';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import { agentTools, executeAgentTool } from '../src/agentToolRegistry.js';
import { readToolCalls, providerTools, toolTurns } from '../src/aiTools.js';
import { articleCandidate } from '../src/articleDesigner.js';

test('registry separates Admin editors, support actions and read-only roles; typed proposals do not execute writes', async () => {
  const db = createMemoryDatabase(),
    store = createIntegrationStore(db),
    owner = {
      id: String(new ObjectId()),
      workspaceId: String(new ObjectId()),
      name: 'Admin',
      email: 'admin@example.test',
    };
  await db.collection('users').insertOne(owner);
  const chat = {
    _id: new ObjectId(),
    ownerId: owner.id,
    providerOwnerId: owner.id,
    workspaceId: owner.workspaceId,
    actionRole: 'admin',
    assistantType: 'admin',
    helpdeskPurpose: 'workflow',
    responseId: crypto.randomUUID(),
  };
  const names = async (context) => (await agentTools(store, context)).map((tool) => tool.name);
  assert.ok((await names(chat)).includes('createGroup'));
  assert.ok(!(await names(chat)).includes('proposeArticle'));
  const articleChat = { ...chat, helpdeskPurpose: 'article' };
  assert.ok((await names(articleChat)).includes('proposeArticle'));
  assert.ok(!(await names(articleChat)).includes('createGroup'));
  const article = await executeAgentTool(store, articleChat, {
    name: 'proposeArticle',
    arguments: { title: 'Safe article', body: '<p>Useful text</p><script>unsafe()</script>' },
  });
  assert.equal(article.proposal.body, '<p>Useful text</p>');
  assert.equal(await db.collection('articles').countDocuments(), 0);
  assert.equal(articleCandidate('```json\n{"title":"Unsafe extraction","body":"x"}\n```'), null);
  for (const role of ['user', 'agent', 'read-only']) {
    const context = {
      ...chat,
      actionRole: role,
      assistantType: 'support',
      helpdeskPurpose: 'support',
    };
    assert.ok(!(await names(context)).includes('createGroup'));
    await assert.rejects(
      executeAgentTool(store, context, {
        name: 'createGroup',
        arguments: {
          name: 'Forbidden',
          description: '',
          routingInstructions: '',
          assignmentEnabled: true,
          approvalEnabled: true,
        },
      }),
      { status: 403 },
    );
  }
  const dataChat = { ...chat, dataDesigner: true };
  const table = await executeAgentTool(store, dataChat, {
    name: 'proposeDataTable',
    arguments: {
      name: 'Locations',
      description: 'Office locations',
      fields: [{ id: 'name', label: 'Name', type: 'text', required: true, referenceTable: null }],
    },
  });
  assert.equal(table.proposal.definition.fields[0].id, 'name');
  assert.equal(await db.collection('adminDataTables').countDocuments(), 0);
  await assert.rejects(
    executeAgentTool(store, chat, {
      name: 'createGroup',
      arguments: {
        name: { $ne: null },
        description: '',
        routingInstructions: '',
        assignmentEnabled: true,
        approvalEnabled: true,
      },
    }),
    { status: 400 },
  );
  await assert.rejects(
    executeAgentTool(
      store,
      { ...chat, workspaceId: String(new ObjectId()) },
      { name: 'getCurrentUser', arguments: {} },
    ),
    { status: 403 },
  );
  const requestId = new ObjectId();
  const support = {
    ...chat,
    assistantType: 'support',
    helpdeskPurpose: 'support',
    actionRole: 'user',
    helpdeskRequestId: String(requestId),
  };
  await db.collection('helpdeskRequests').insertOne({
    _id: requestId,
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    requesterId: owner.id,
    chatId: String(chat._id),
    title: 'Help',
    number: 'REQ-1',
    status: 'open',
    version: 1,
  });
  const requestTool = (await agentTools(store, support)).find(
    (tool) => tool.name === 'proposeRequestAction',
  );
  assert.deepEqual(requestTool.parameters.properties.action.enum, ['comment']);
  const proposed = await executeAgentTool(store, support, {
    name: 'proposeRequestAction',
    arguments: {
      action: 'comment',
      text: 'Please update me',
      title: null,
      description: null,
      taskId: null,
      taskVersion: null,
      status: null,
      priority: null,
    },
  });
  assert.equal(proposed.proposal.value.state, 'pending');
  assert.equal(proposed.proposal.value.version, 1);
  assert.equal((await db.collection('helpdeskRequests').findOne({ _id: requestId })).version, 1);
  await assert.rejects(
    executeAgentTool(store, support, {
      name: 'proposeRequestAction',
      arguments: {
        action: 'work-note',
        text: 'Private note',
        title: null,
        description: null,
        taskId: null,
        taskVersion: null,
        status: null,
        priority: null,
      },
    }),
    { status: 403 },
  );
  assert.equal(await db.collection('approvalGroups').countDocuments(), 0);
  assert.ok(
    await db
      .collection('governanceAudit')
      .countDocuments({ action: 'agent-tool-proposeArticle', outcome: 'completed' }),
  );
  await store.close();
});

async function verifyQueuedAuthorization(db) {
  const store = createIntegrationStore(db);
  const owner = { id: String(new ObjectId()), workspaceId: String(new ObjectId()) };
  const memberId = String(new ObjectId());
  await db.collection('users').insertOne(owner);
  await db.collection('users').insertOne({ id: memberId, workspaceId: String(new ObjectId()) });
  await db.collection('helpdeskMembers').insertOne({
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    userId: memberId,
    active: true,
    role: 'admin',
    queues: [],
    canApprove: true,
  });
  const sessionId = 'a'.repeat(64);
  await db
    .collection('sessions')
    .insertOne({ _id: sessionId, user: { id: memberId }, expiresAt: new Date(Date.now() + 60000) });
  const chat = {
    _id: new ObjectId(),
    ownerId: memberId,
    workspaceId: owner.workspaceId,
    providerOwnerId: owner.id,
    assistantType: 'admin',
    helpdeskPurpose: 'workflow',
    actionRole: 'admin',
    permissionSessionId: sessionId,
  };
  const call = { name: 'getCurrentUser', arguments: {} };
  assert.equal((await executeAgentTool(store, chat, call)).role, 'admin');
  await db
    .collection('sessions')
    .updateOne(
      { _id: sessionId },
      { $set: { impersonation: { workspaceId: owner.workspaceId, role: 'user' } } },
    );
  await assert.rejects(executeAgentTool(store, chat, call), { status: 403 });
  await assert.rejects(knowledgeActor(store, chat), { status: 403 });
  const support = {
    ...chat,
    actionRole: 'user',
    assistantType: 'support',
    helpdeskPurpose: 'support',
  };
  assert.equal((await knowledgeActor(store, support)).role, 'user');
  assert.ok(!(await agentTools(store, support)).some((tool) => tool.name === 'createGroup'));
  await db.collection('sessions').updateOne({ _id: sessionId }, { $unset: { impersonation: '' } });
  await db
    .collection('helpdeskMembers')
    .updateOne({ userId: memberId }, { $set: { role: 'agent' } });
  await assert.rejects(executeAgentTool(store, chat, call), { status: 403 });
  assert.equal((await knowledgeActor(store, support)).role, 'user');
  await db
    .collection('helpdeskMembers')
    .updateOne({ userId: memberId }, { $set: { active: false } });
  await assert.rejects(executeAgentTool(store, support, call), { status: 403 });
  await db
    .collection('helpdeskMembers')
    .updateOne({ userId: memberId }, { $set: { active: true } });
  await db
    .collection('sessions')
    .updateOne({ _id: sessionId }, { $set: { expiresAt: new Date(0) } });
  await assert.rejects(executeAgentTool(store, support, call), { status: 403 });
  await store.close();
}
test('queued tools and knowledge stop on session changes and membership revocation', async () => {
  await verifyQueuedAuthorization(createMemoryDatabase());
});
test(
  'queued tool and knowledge permissions revoke on MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI),
      db = client.db('az_tools_' + new ObjectId());
    try {
      await verifyQueuedAuthorization(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
test(
  'queued tool and knowledge permissions revoke on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(connection),
      name = 'az_tools_' + new ObjectId();
    await admin.query(`CREATE DATABASE ${name}`);
    const db = createPostgresDatabase({ ...connection, database: name });
    try {
      await verifyQueuedAuthorization(db);
    } finally {
      await db.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  },
);

test('provider tool adapters preserve typed calls and native result messages', () => {
  const schema = {
    name: 'getCurrentUser',
    description: 'Current user',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  };
  const values = {
    openai: {
      output: [{ type: 'function_call', call_id: 'a', name: 'getCurrentUser', arguments: '{}' }],
    },
    anthropic: { content: [{ type: 'tool_use', id: 'a', name: 'getCurrentUser', input: {} }] },
    google: {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: { name: 'getCurrentUser', id: 'a', args: {} },
                thoughtSignature: 'signed',
              },
            ],
          },
        },
      ],
    },
  };
  for (const [provider, raw] of Object.entries(values)) {
    const [call] = readToolCalls(provider, raw);
    assert.equal(call.name, 'getCurrentUser');
    assert.deepEqual(call.arguments, {});
    assert.ok(providerTools(provider, [schema]).length);
    assert.ok(toolTurns(provider, raw, [{ call, result: { id: 'authorized' } }]).length);
  }
  assert.throws(() =>
    readToolCalls('openai', {
      output: [{ type: 'function_call', call_id: 'a', name: 'x', arguments: '{bad' }],
    }),
  );
});
