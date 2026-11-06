import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { executeAgentTool, agentTools } from '../src/chat/agentToolRegistry.js';
import { createAdminData } from '../src/data/adminData.js';
import { createKnowledgeTopics } from '../src/knowledge/knowledgeTopics.js';
async function verify(database) {
  const store = createIntegrationStore(database);
  await store.ready();
  const owner = {
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    role: 'admin',
    name: 'Owner',
  };
  await store.collection('users').insertOne(owner);
  const chat = {
    _id: new ObjectId(),
    ownerId: owner.id,
    providerOwnerId: owner.id,
    workspaceId: owner.workspaceId,
    assistantType: 'admin',
    helpdeskPurpose: 'article',
    responseId: randomUUID(),
    articleDraft: { knowledgeBaseId: owner.workspaceId, topicIds: [] },
  };
  const call = {
    id: 'topic-call',
    name: 'createKnowledgeTopic',
    arguments: {
      name: 'Apps',
      description: 'Application guidance',
      knowledgeBaseId: owner.workspaceId,
    },
  };
  assert.ok((await agentTools(store, chat)).some((tool) => tool.name === 'createKnowledgeTopic'));
  const created = await executeAgentTool(store, chat, call);
  assert.equal(created.status, 'saved');
  assert.equal(created.name, 'Apps');
  assert.deepEqual(created.proposal.topicIds, [created.id]);
  const again = await executeAgentTool(store, chat, { ...call, id: 'topic-again' });
  assert.equal(again.id, created.id);
  const table = await createAdminData(store).table(owner, 'ref-knowledge-topic');
  assert.equal(table.system, true);
  assert.equal(table.sourceManaged, true);
  const rows = await createAdminData(store).records(owner, 'ref-knowledge-topic');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.name, 'Apps');
  assert.equal(rows[0].sourceHref, `/workspace/knowledge/topics/${created.id}`);
  const selected = await executeAgentTool(store, chat, {
    id: 'select',
    name: 'setArticleTopics',
    arguments: { knowledgeBaseId: owner.workspaceId, topicIds: [created.id] },
  });
  assert.deepEqual(selected.proposal.topicIds, [created.id]);
  await assert.rejects(
    executeAgentTool(store, chat, {
      ...call,
      arguments: { ...call.arguments, knowledgeBaseId: String(new ObjectId()) },
    }),
    { status: 400 },
  );
  await createKnowledgeTopics(store)(
    owner,
    {
      name: 'Applications',
      description: 'Updated',
      articleIds: [],
      knowledgeBaseId: owner.workspaceId,
    },
    created.id,
  );
  assert.equal(
    (await createAdminData(store).records(owner, 'ref-knowledge-topic'))[0].values.name,
    'Applications',
  );
  const other = { id: String(new ObjectId()), workspaceId: String(new ObjectId()), role: 'admin' };
  await store.collection('users').insertOne(other);
  await assert.rejects(
    createKnowledgeTopics(store)(
      other,
      { name: 'Foreign', description: '', articleIds: [] },
      created.id,
    ),
    { status: 404 },
  );
  const user = { id: String(new ObjectId()), workspaceId: String(new ObjectId()) };
  await store.collection('users').insertOne(user);
  await store.collection('helpdeskMembers').insertOne({
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    userId: user.id,
    role: 'user',
    active: true,
  });
  await assert.rejects(executeAgentTool(store, { ...chat, ownerId: user.id }, call), {
    status: 403,
  });
  await store.close();
}
test('knowledge topic tools and built-in table use the same protected topic records', () =>
  verify(createMemoryDatabase()));
test(
  'knowledge topics and tool permissions on MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    await client.connect();
    const db = client.db('az_topic_tools_' + new ObjectId());
    try {
      await verify(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
test(
  'knowledge topics and tool permissions on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const config = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(config),
      name = 'az_topic_tools_' + new ObjectId();
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
