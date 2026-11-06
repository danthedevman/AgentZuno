import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createUserAccess } from '../src/requests/userAccess.js';
import { createAdminData } from '../src/data/adminData.js';
import { defineWorkflow } from '../sdk/workflows/index.js';
async function verify(db) {
  const store = { collection: db.collection.bind(db), ready: async () => {} },
    service = createUserAccess(store);
  const admin = { id: String(new ObjectId()), workspaceId: String(new ObjectId()), role: 'admin' };
  const user = {
    ...admin,
    id: String(new ObjectId()),
    helpdeskOwnerId: admin.id,
    role: 'user',
    name: 'Fixture User',
  };
  const scope = { ownerId: admin.id, workspaceId: admin.workspaceId };
  await db
    .collection('workforceReferences')
    .insertOne({ _id: 'fixture-app', ...scope, type: 'application', name: 'Fixture App' });
  const workflow = {
    definition: defineWorkflow({
      version: 1,
      name: 'App Access',
      trigger: { department: 'it', phrases: ['access'] },
      steps: [{ id: 'route', action: 'route', params: { queueName: 'Support' } }],
      form: {
        title: 'App Access',
        fields: [
          {
            id: 'level',
            label: 'Access Level',
            type: 'select',
            required: true,
            options: ['Read', 'Write'],
          },
        ],
      },
      settings: { accessTracking: { applicationId: 'fixture-app', accessFieldId: 'level' } },
    }),
  };
  assert.throws(() =>
    defineWorkflow({
      ...workflow.definition,
      settings: { accessTracking: { applicationId: 'fixture-app', accessFieldId: 'invented' } },
    }),
  );
  const offer = randomUUID(),
    record = await service.reserve(user, workflow, { level: 'Read' }, offer);
  assert.equal(
    (await service.reserve(user, workflow, { level: 'Read' }, offer))._id.toString(),
    String(record._id),
  );
  await assert.rejects(service.reserve(user, workflow, { level: 'Read' }, randomUUID()), {
    status: 409,
  });
  await assert.rejects(
    service.reserve(
      { ...user, workspaceId: String(new ObjectId()) },
      workflow,
      { level: 'Read' },
      randomUUID(),
    ),
    { status: 400 },
  );
  const request = {
    _id: new ObjectId(),
    ...scope,
    requesterId: user.id,
    queueName: 'Support',
    approvals: [{ status: 'pending' }],
  };
  await db.collection('helpdeskRequests').insertOne(request);
  await service.attach(user, record, { id: String(request._id), number: 'REQ-001' });
  assert.equal((await service.get(user, String(record._id))).offerId, undefined);
  await assert.rejects(service.get({ ...user, id: 'other' }, String(record._id)), { status: 404 });
  await assert.rejects(service.get(admin, { $ne: null }), { status: 400 });
  await assert.rejects(
    service.change(user, String(record._id), { confirmed: true, status: 'active', version: 1 }),
    { status: 403 },
  );
  await assert.rejects(
    service.change(admin, String(record._id), { status: 'active', version: 1 }),
    { status: 400 },
  );
  await assert.rejects(
    service.change(admin, String(record._id), { confirmed: true, status: 'active', version: 1 }),
    { status: 409 },
  );
  await db
    .collection('helpdeskRequests')
    .updateOne({ _id: request._id }, { $set: { approvals: [{ status: 'approved' }] } });
  const active = await service.change(admin, String(record._id), {
    confirmed: true,
    status: 'active',
    version: 1,
  });
  assert.equal(active.status, 'active');
  await assert.rejects(service.reserve(user, workflow, { level: 'Read' }, randomUUID()), {
    status: 409,
  });
  assert.ok(await service.reserve(user, workflow, { level: 'Write' }, randomUUID()));
  await assert.rejects(
    service.change(admin, String(record._id), {
      confirmed: true,
      status: 'revoked',
      version: { $gt: 0 },
    }),
    { status: 400 },
  );
  const revoked = await service.change(admin, String(record._id), {
    confirmed: true,
    status: 'revoked',
    version: 2,
  });
  assert.equal(revoked.status, 'revoked');
  assert.equal(
    (await service.reserve(user, workflow, { level: 'Read' }, randomUUID())).status,
    'requested',
  );
  assert.equal((await createAdminData(store).table(admin, 'ref-user-access')).sourceManaged, true);
}
test('User Access prevents duplicate grants and requires authorized explicit fulfillment confirmation', () =>
  verify(createMemoryDatabase()));
test('User Access on MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI),
    db = client.db('az_access_' + new ObjectId());
  try {
    await verify(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
test('User Access on PostgreSQL', { skip: !process.env.TEST_POSTGRES_URL }, async () => {
  const config = postgresConnection(process.env.TEST_POSTGRES_URL),
    admin = new pg.Pool(config),
    name = 'az_access_' + new ObjectId();
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
