import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createHelpdeskWorkflows } from '../src/workflows/helpdeskWorkflows.js';
import { createWorkflowVersions } from '../src/workflows/workflowVersions.js';
async function verify(db) {
  const store = createIntegrationStore(db);
  const admin = { id: String(new ObjectId()), workspaceId: String(new ObjectId()), role: 'admin' };
  await store
    .collection('helpdeskQueues')
    .insertOne({ ownerId: admin.id, workspaceId: admin.workspaceId, name: 'Support' });
  const workflows = createHelpdeskWorkflows(store, {}),
    versions = createWorkflowVersions(store, workflows);
  const input = {
    name: 'Initial Access',
    department: 'it',
    keywords: ['access'],
    action: 'route',
    queueName: 'Support',
    enabled: false,
    intent: 'draft',
  };
  const first = await workflows.save(admin, null, input);
  const second = await workflows.save(admin, first.id, {
    ...input,
    name: 'Published Access',
    definition: { ...first.definition, name: 'Published Access' },
    version: 1,
    enabled: true,
    intent: 'publish',
  });
  assert.equal(second.publishedRevision, 2);
  assert.equal((await versions.list(admin, first.id)).length, 2);
  assert.equal((await versions.read(admin, first.id, 1)).config.name, 'Initial Access');
  const before = await store.collection('workflowVersions').countDocuments({});
  await versions.read(admin, first.id, 1);
  assert.equal(await store.collection('workflowVersions').countDocuments({}), before);
  await assert.rejects(versions.restore(admin, first.id, 1, { version: 2 }), { status: 400 });
  await assert.rejects(
    versions.restore({ ...admin, role: 'agent' }, first.id, 1, { confirmed: true, version: 2 }),
    { status: 403 },
  );
  await assert.rejects(
    versions.read({ ...admin, workspaceId: String(new ObjectId()) }, first.id, 1),
    { status: 404 },
  );
  await assert.rejects(versions.read(admin, { $ne: null }, 1), { status: 400 });
  await assert.rejects(versions.read(admin, first.id, { $gt: 0 }), { status: 400 });
  const restored = await versions.restore(admin, first.id, 1, { confirmed: true, version: 2 });
  assert.equal(restored.version, 3);
  assert.equal(restored.name, 'Initial Access');
  assert.equal(restored.enabled, true);
  assert.equal(restored.publishedRevision, 2);
  assert.equal(restored.publishedConfig.name, 'Published Access');
  assert.equal((await versions.list(admin, first.id)).length, 3);
  await assert.rejects(versions.restore(admin, first.id, 1, { confirmed: true, version: 2 }), {
    status: 409,
  });
  assert.equal((await versions.read(admin, first.id, 2)).config.name, 'Published Access');
}
test('workflow versions restore a validated draft without changing publication or historical versions', () =>
  verify(createMemoryDatabase()));
test('workflow version history on MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI),
    db = client.db('az_versions_' + new ObjectId());
  try {
    await verify(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
test(
  'workflow version history on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const config = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(config),
      name = 'az_versions_' + new ObjectId();
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
