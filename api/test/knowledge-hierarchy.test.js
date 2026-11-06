import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createKnowledgeTopics } from '../src/knowledge/knowledgeTopics.js';
import { canReadAuthoredArticle } from '../src/knowledge/knowledgeAccess.js';
import { knowledgeDirectory } from '../src/knowledge/knowledgeExplorer.js';

async function verify(database) {
  const store = createIntegrationStore(database);
  await store.ready();
  const owner = {
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    role: 'admin',
    name: 'Owner',
  };
  const create = createKnowledgeTopics(store);
  const input = {
    name: 'Support',
    description: '',
    articleIds: [],
    knowledgeBaseId: owner.workspaceId,
  };
  const root = await create(owner, input);
  const child = await create(owner, { ...input, name: 'Applications', parentTopicId: root.id });
  const leaf = await create(owner, { ...input, name: 'Salesforce', parentTopicId: child.id });
  await assert.rejects(create(owner, { ...input, name: 'Fourth', parentTopicId: leaf.id }), {
    status: 400,
  });
  for (const parentTopicId of [{ $ne: null }, [], String(new ObjectId())])
    await assert.rejects(create(owner, { ...input, parentTopicId }), { status: 400 });
  await assert.rejects(create(owner, { ...input, knowledgeBaseId: { $ne: null } }), {
    status: 400,
  });
  await assert.rejects(create(owner, { ...input, parentTopicId: leaf.id }, root.id), {
    status: 400,
  });
  const foreign = {
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    role: 'admin',
    name: 'Other',
  };
  const foreignTopic = await create(foreign, { ...input, knowledgeBaseId: foreign.workspaceId });
  await assert.rejects(create(owner, { ...input, parentTopicId: foreignTopic.id }), {
    status: 400,
  });
  const otherBase = new ObjectId();
  await store.collection('records').insertOne({
    _id: otherBase,
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    type: 'knowledge-base',
    name: 'Another base',
  });
  await assert.rejects(
    create(owner, { ...input, knowledgeBaseId: String(otherBase), parentTopicId: root.id }),
    { status: 400 },
  );
  const article = {
    _id: new ObjectId(),
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    title: 'Access Salesforce',
    body: '<p>Use the portal.</p>',
    status: 'Published',
    base: owner.workspaceId,
    topicIds: [leaf.id],
  };
  await store.collection('articles').insertOne(article);
  await create(
    owner,
    { name: 'Salesforce access', description: '', knowledgeBaseId: owner.workspaceId },
    leaf.id,
  );
  assert.deepEqual((await store.collection('articles').findOne({ _id: article._id })).topicIds, [
    leaf.id,
  ]);
  const list = await knowledgeDirectory(store, owner, { base: owner.workspaceId, topic: child.id });
  assert.equal(list.folder.depth, 2);
  assert.deepEqual(list.folder.ancestors, [owner.workspaceId, root.id, child.id]);
  assert.equal(list.rows[0].id, leaf.id);
  const files = await knowledgeDirectory(store, owner, { base: owner.workspaceId, topic: leaf.id });
  assert.equal(files.rows[0].name, article.title);
  assert.equal(files.rows[0].body, undefined);
  for (const query of [
    { base: { $ne: null } },
    { base: owner.workspaceId, topic: [] },
    { page: ['1'] },
    { q: { $regex: '.*' } },
  ])
    await assert.rejects(knowledgeDirectory(store, owner, query), { status: 400 });
  await assert.rejects(knowledgeDirectory(store, foreign, { base: owner.workspaceId }), {
    status: 404,
  });
  const reader = {
    id: String(new ObjectId()),
    workspaceId: owner.workspaceId,
    helpdeskOwnerId: owner.id,
    role: 'user',
  };
  await store.collection('knowledgePermissions').insertOne({
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    kind: 'base',
    resourceId: owner.workspaceId,
    mode: 'workspace',
    userIds: [],
    roles: [],
  });
  const restricted = new ObjectId();
  await store.collection('knowledgePermissions').insertOne({
    _id: restricted,
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    kind: 'topic',
    resourceId: root.id,
    mode: 'restricted',
    userIds: [],
    roles: [],
  });
  assert.equal(await canReadAuthoredArticle(store, reader, article), false);
  assert.deepEqual((await knowledgeDirectory(store, reader, {})).rows, []);
  await store
    .collection('knowledgePermissions')
    .updateOne({ _id: restricted }, { $set: { mode: 'workspace' } });
  assert.equal(await canReadAuthoredArticle(store, reader, article), true);
  assert.equal(
    (await knowledgeDirectory(store, reader, { base: owner.workspaceId })).rows[0].id,
    root.id,
  );
  assert.equal(
    (await knowledgeDirectory(store, reader, { base: owner.workspaceId, topic: leaf.id })).rows[0]
      .id,
    String(article._id),
  );
  await store
    .collection('records')
    .updateOne({ _id: new ObjectId(root.id) }, { $set: { parentTopicId: leaf.id } });
  assert.equal(await canReadAuthoredArticle(store, reader, article), false);
  assert.deepEqual((await knowledgeDirectory(store, reader, {})).rows, []);
  await store.close();
}
test('knowledge folders enforce hierarchy and inherited access', () =>
  verify(createMemoryDatabase()));
test(
  'knowledge folder hierarchy and inherited access on MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    await client.connect();
    const db = client.db('az_topic_hierarchy_' + new ObjectId());
    try {
      await verify(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
test(
  'knowledge folder hierarchy and inherited access on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const config = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(config),
      name = 'az_topic_hierarchy_' + new ObjectId();
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
