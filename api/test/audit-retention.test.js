import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createAuditRetention } from '../src/audit/auditRetention.js';
import { auditOperation } from '../src/audit/audit.js';
import { executeAgentTool } from '../src/chat/agentToolRegistry.js';

async function verify(db) {
  const store = createIntegrationStore(db);
  await store.ready();
  const user = { id: String(new ObjectId()), workspaceId: String(new ObjectId()), role: 'admin' };
  await db.collection('users').insertOne(user);
  const scope = { ownerId: user.id, workspaceId: user.workspaceId },
    service = createAuditRetention(store);
  assert.equal((await service.read(user)).enabled, false);
  const now = new Date(),
    old = new Date(now.getTime() - 90 * 86400000);
  const oldId = crypto.randomUUID(),
    liveId = crypto.randomUUID(),
    foreignId = crypto.randomUUID();
  await db.collection('governanceAudit').insertMany([
    { _id: oldId, ...scope, startedAt: old, completedAt: old, outcome: 'completed' },
    { _id: liveId, ...scope, startedAt: old, outcome: 'started' },
    {
      _id: foreignId,
      ...scope,
      workspaceId: 'another',
      startedAt: old,
      completedAt: old,
      outcome: 'completed',
    },
  ]);
  await service.cleanup(now);
  assert.ok(await db.collection('governanceAudit').findOne({ _id: oldId }));
  for (const role of ['user', 'agent', 'read-only'])
    await assert.rejects(
      service.save(
        { ...user, role },
        { enabled: true, retentionDays: 30, version: 0, confirmed: true },
      ),
      { status: 403 },
    );
  for (const invalid of [0, -1, 3651, '30', { $gt: 1 }])
    await assert.rejects(
      service.save(user, { enabled: true, retentionDays: invalid, version: 0, confirmed: true }),
      { status: 400 },
    );
  await assert.rejects(service.save(user, { enabled: true, retentionDays: 30, version: 0 }), {
    status: 400,
  });
  await service.save(user, { enabled: true, retentionDays: 30, version: 0, confirmed: true });
  await assert.rejects(service.save(user, { enabled: false, retentionDays: 30, version: 0 }), {
    status: 409,
  });
  await db.collection('auditRetentionSettings').updateOne(scope, { $set: { nextCleanupAt: old } });
  await service.cleanup(now);
  assert.equal(await db.collection('governanceAudit').findOne({ _id: oldId }), null);
  assert.ok(await db.collection('governanceAudit').findOne({ _id: liveId }));
  assert.ok(await db.collection('governanceAudit').findOne({ _id: foreignId }));
  assert.equal((await service.read(user)).lastDeletedCount, 1);
  assert.ok(
    await db.collection('governanceAudit').findOne({
      ...scope,
      action: 'audit-retention-cleanup',
      deletedCount: 1,
      outcome: 'completed',
    }),
  );
  await service.save(user, { enabled: false, retentionDays: 30, version: 1 });
  const retainedId = crypto.randomUUID();
  await db.collection('governanceAudit').insertOne({
    _id: retainedId,
    ...scope,
    startedAt: old,
    completedAt: old,
    outcome: 'completed',
  });
  await service.cleanup(new Date(now.getTime() + 7200000));
  assert.ok(await db.collection('governanceAudit').findOne({ _id: retainedId }));
  const chat = {
    _id: new ObjectId(),
    ownerId: user.id,
    workspaceId: user.workspaceId,
    providerOwnerId: user.id,
    actionRole: 'admin',
    assistantType: 'admin',
    helpdeskPurpose: 'workflow',
    responseId: crypto.randomUUID(),
  };
  await auditOperation(
    store,
    { ...user, ownerId: user.id },
    'execution-test',
    '/execution-test',
    async () => {
      await executeAgentTool(store, chat, {
        id: 'read-user',
        name: 'getCurrentUser',
        arguments: {},
      });
      await assert.rejects(
        executeAgentTool(store, chat, {
          id: 'denied-call',
          name: 'proposeArticle',
          arguments: { title: 'Private title', body: 'Private body' },
        }),
        { status: 403 },
      );
    },
  );
  const root = await db.collection('governanceAudit').findOne({ action: 'execution-test' });
  const calls = await db.collection('governanceAudit').find({ parentAuditId: root._id }).toArray();
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((call) => call.rootAuditId === root._id && call.responseId === chat.responseId),
  );
  assert.ok(
    calls.some((call) => call.toolCallId === 'denied-call' && call.outcome === 'denied-or-failed'),
  );
  assert.ok(!JSON.stringify(calls).includes('Private body'));
  await store.close();
}
test('audit retention defaults off, requires confirmed Admin settings, cleans only scoped completed logs and correlates all tool calls', async () =>
  verify(createMemoryDatabase()));
test(
  'audit retention and tool correlation work on MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI),
      db = client.db('az_audit_' + new ObjectId());
    try {
      await verify(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
test(
  'audit retention and tool correlation work on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(connection),
      name = 'az_audit_' + new ObjectId();
    await admin.query(`CREATE DATABASE ${name}`);
    const db = createPostgresDatabase({ ...connection, database: name });
    try {
      await verify(db);
    } finally {
      await db.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  },
);
