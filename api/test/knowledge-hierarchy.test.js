import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createKnowledgeTopics } from '../src/knowledge/knowledgeTopics.js';
import { deleteKnowledgeFolder } from '../src/knowledge/deleteKnowledgeFolder.js';
import { createKnowledgeAccessController } from '../src/controllers/knowledge/knowledgeAccessController.js';
import { canReadAuthoredArticle } from '../src/knowledge/knowledgeAccess.js';
import { knowledgeDirectory } from '../src/knowledge/knowledgeExplorer.js';
import { createContentStore } from '../src/knowledge/contentStore.js';
import { createContentController } from '../src/controllers/knowledge/contentController.js';

async function verify(database) {
  const store = createIntegrationStore(database);
  await store.ready();
  const owner = {
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    role: 'admin',
    name: 'Owner',
  };
  await store
    .collection('users')
    .insertOne({ id: owner.id, name: 'Morgan Writer', email: 'private@example.test' });
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
    createdBy: owner.id,
    summary: 'Access instructions.',
    updatedAt: '2026-11-06T12:00:00.000Z',
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
  assert.deepEqual(files.rows[0].author, { name: 'Morgan Writer', label: 'Author' });
  assert.equal(files.rows[0].summary, 'Access instructions.');
  assert.equal(files.rows[0].updatedAt, article.updatedAt);
  assert.ok(!JSON.stringify(files).includes('private@example.test'));
  assert.equal((await knowledgeDirectory(store, owner, { q: 'salesforce' })).rows[0].id, leaf.id);
  assert.equal(
    (await knowledgeDirectory(store, owner, { q: article.title })).rows[0].id,
    String(article._id),
  );
  assert.deepEqual((await knowledgeDirectory(store, foreign, { q: article.title })).rows, []);
  for (const query of [
    { base: { $ne: null } },
    { base: owner.workspaceId, topic: [] },
    { page: ['1'] },
    { q: { $regex: '.*' } },
    { q: ['Support'] },
    { q: 'a'.repeat(201) },
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
  assert.deepEqual(
    (await knowledgeDirectory(store, reader, {})).rows.map((row) => row.id),
    [owner.workspaceId],
  );
  assert.deepEqual((await knowledgeDirectory(store, reader, { q: article.title })).rows, []);
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
  assert.deepEqual(
    (await knowledgeDirectory(store, reader, {})).rows.map((row) => row.id),
    [owner.workspaceId],
  );
  assert.deepEqual((await knowledgeDirectory(store, reader, { q: article.title })).rows, []);
  const controller = createContentController(null, createContentStore(undefined, database), {
    integrations: store,
  });
  let saved, status;
  const response = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      saved = value;
    },
  };
  await controller.saveRecord(
    {
      params: { type: 'knowledge-base' },
      user: owner,
      body: { name: 'Scoped base', workspaceId: foreign.workspaceId, ownerId: foreign.id },
    },
    response,
  );
  assert.equal(status, 201);
  assert.equal(saved.workspaceId, owner.workspaceId);
  assert.ok((await knowledgeDirectory(store, owner, {})).rows.some((row) => row.id === saved.id));
  assert.ok(
    !(await knowledgeDirectory(store, foreign, {})).rows.some((row) => row.id === saved.id),
  );
  await controller.saveRecord(
    { params: { type: 'knowledge-base' }, user: owner, body: { name: { $ne: null } } },
    response,
  );
  assert.equal(status, 400);
  const accessController = createKnowledgeAccessController(store);
  const generalRequest = { helpdeskUser: owner, params: { kind: 'base', id: owner.workspaceId } };
  await accessController.getKnowledgePermissionsKindId(generalRequest, response);
  assert.equal(saved.mode, 'workspace');
  assert.equal(saved.locked, true);
  await assert.rejects(
    accessController.putKnowledgePermissionsKindId(
      {
        ...generalRequest,
        body: { mode: 'restricted', userIds: [], roles: [], version: saved.version },
      },
      response,
    ),
    { status: 400 },
  );
  await controller.saveRecord(
    {
      params: { type: 'knowledge-base', id: owner.workspaceId },
      user: owner,
      body: { name: 'Team Knowledge', description: 'Shared guidance' },
    },
    response,
  );
  await controller.getRecordsTypeId(
    { params: { type: 'knowledge-base', id: owner.workspaceId }, user: owner },
    response,
  );
  assert.equal(saved.isDefault, true);
  assert.equal(saved.name, 'Team Knowledge');
  const general = (await knowledgeDirectory(store, reader, {})).rows.filter(
    (row) => row.id === owner.workspaceId,
  );
  assert.equal(general.length, 1);
  assert.equal(general[0].name, 'Team Knowledge');
  await assert.rejects(
    deleteKnowledgeFolder(store, owner, 'base', owner.workspaceId, {
      confirmed: true,
      name: 'Team Knowledge',
    }),
    { status: 403 },
  );
  const empty = await create(owner, { ...input, name: 'Empty topic' });
  await assert.rejects(
    deleteKnowledgeFolder(store, reader, 'topic', empty.id, { confirmed: true, name: empty.name }),
    { status: 403 },
  );
  await assert.rejects(
    deleteKnowledgeFolder(store, foreign, 'topic', empty.id, { confirmed: true, name: empty.name }),
    { status: 404 },
  );
  await assert.rejects(deleteKnowledgeFolder(store, owner, 'topic', { $ne: null }, {}), {
    status: 404,
  });
  await assert.rejects(
    deleteKnowledgeFolder(store, owner, 'topic', empty.id, { confirmed: true, name: 'Old name' }),
    { status: 409 },
  );
  await assert.rejects(
    deleteKnowledgeFolder(store, owner, 'topic', leaf.id, { confirmed: true, name: leaf.name }),
    { status: 409 },
  );
  assert.equal(
    (
      await deleteKnowledgeFolder(store, owner, 'topic', empty.id, {
        confirmed: true,
        name: empty.name,
      })
    ).deleted,
    true,
  );
  await assert.rejects(
    deleteKnowledgeFolder(store, owner, 'topic', empty.id, { confirmed: true, name: empty.name }),
    { status: 404 },
  );
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
