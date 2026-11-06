import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createHelpdeskWorkflows } from '../src/workflows/helpdeskWorkflows.js';
import { deleteWorkflow } from '../src/workflows/deleteWorkflow.js';

async function verify(db) {
  const store = createIntegrationStore(db);
  await store.ready();
  const user = { id: String(new ObjectId()), workspaceId: String(new ObjectId()), role: 'admin' };
  const scope = { ownerId: user.id, workspaceId: user.workspaceId };
  await store.collection('helpdeskQueues').insertOne({ ...scope, name: 'Support' });
  const service = createHelpdeskWorkflows(store, {});
  const fixture = async () => {
    const workflow = await service.save(user, null, {
      name: 'IT Request',
      department: 'it',
      keywords: [],
      action: 'route',
      queueName: 'Support',
      enabled: true,
      intent: 'publish',
    });
    const related = { ...scope, workflowId: workflow.id };
    const request = {
      _id: new ObjectId(),
      ...related,
      requestId: String(new ObjectId()),
      title: 'Existing request',
      status: 'waiting-for-approval',
      approvalUserIds: ['approver'],
      version: 1,
    };
    await store.collection('helpdeskRequests').insertOne(request);
    await store
      .collection('helpdeskTasks')
      .insertOne({ ...scope, requestId: String(request._id), name: 'Prepare device' });
    await store
      .collection('requestAttachments')
      .insertOne({ ...scope, requestId: String(request._id), name: 'device.png' });
    await store.collection('workflowRuns').insertOne({
      _id: String(new ObjectId()),
      ...related,
      requestId: String(request._id),
      status: 'awaiting-approval',
      steps: [],
    });
    return {
      workflow,
      related,
      request,
      input: {
        confirmed: true,
        name: workflow.name,
        version: workflow.version,
        preserveRequests: false,
        preserveHistory: false,
      },
    };
  };
  const { workflow, related, request, input } = await fixture();
  for (const role of ['agent', 'user', 'read-only'])
    await assert.rejects(
      deleteWorkflow(store, { ...user, role, readOnlyRequest: true }, workflow.id, input),
      { status: 403 },
    );
  await assert.rejects(
    deleteWorkflow(store, { ...user, workspaceId: String(new ObjectId()) }, workflow.id, input),
    { status: 404 },
  );
  await assert.rejects(
    deleteWorkflow(store, { ...user, id: String(new ObjectId()) }, workflow.id, input),
    { status: 404 },
  );
  for (const id of [{ $ne: null }, [], 'invalid'])
    await assert.rejects(deleteWorkflow(store, user, id, input), { status: 400 });
  for (const changes of [
    { confirmed: false },
    { confirmed: undefined },
    { name: { $ne: null } },
    { version: { $gt: 0 } },
    { version: 0 },
    { preserveRequests: 'false' },
    { preserveHistory: [] },
    { preserveHistory: undefined },
    { ownerId: 'foreign' },
  ])
    await assert.rejects(deleteWorkflow(store, user, workflow.id, { ...input, ...changes }), {
      status: 400,
    });
  await assert.rejects(deleteWorkflow(store, user, workflow.id, { ...input, name: 'Wrong name' }), {
    status: 409,
  });
  await assert.rejects(deleteWorkflow(store, user, workflow.id, { ...input, version: 2 }), {
    status: 409,
  });
  for (const status of ['running', 'delivery-unknown']) {
    await store.collection('workflowRuns').updateMany(related, { $set: { status } });
    await assert.rejects(deleteWorkflow(store, user, workflow.id, input), { status: 409 });
    assert.ok(
      await store
        .collection('helpdeskWorkflows')
        .findOne({ ...scope, _id: new ObjectId(workflow.id) }),
    );
    assert.ok(await store.collection('helpdeskRequests').findOne({ ...scope, _id: request._id }));
  }
  await store
    .collection('workflowRuns')
    .updateMany(related, { $set: { status: 'awaiting-approval' } });
  const foreign = { ...related, ownerId: 'foreign', workspaceId: String(new ObjectId()) };
  await store
    .collection('workflowRuns')
    .insertOne({ ...foreign, requestId: String(new ObjectId()), status: 'complete' });
  await store.collection('helpdeskRequests').insertOne({ ...foreign, title: 'Foreign request' });
  await deleteWorkflow(store, user, workflow.id, input);
  assert.equal(await store.collection('helpdeskRequests').countDocuments(related), 0);
  assert.equal(
    await store
      .collection('helpdeskTasks')
      .countDocuments({ ...scope, requestId: String(request._id) }),
    0,
  );
  assert.equal(
    await store
      .collection('requestAttachments')
      .countDocuments({ ...scope, requestId: String(request._id) }),
    0,
  );
  for (const name of ['workflowRuns', 'workflowRevisions', 'workflowVersions'])
    assert.equal(await store.collection(name).countDocuments(related), 0);
  assert.equal(await store.collection('helpdeskRequests').countDocuments(foreign), 1);
  assert.equal(await store.collection('workflowRuns').countDocuments(foreign), 1);
  assert.equal(
    await store
      .collection('governanceAudit')
      .countDocuments({ ...related, action: 'workflow.deleted', outcome: 'completed' }),
    1,
  );
  await assert.rejects(service.save(user, workflow.id, { version: 1 }), { status: 404 });
  await assert.rejects(deleteWorkflow(store, user, workflow.id, input), { status: 404 });
  for (const [preserveRequests, preserveHistory] of [
    [true, true],
    [true, false],
    [false, true],
  ]) {
    const item = await fixture();
    await deleteWorkflow(store, user, item.workflow.id, {
      ...item.input,
      preserveRequests,
      preserveHistory,
    });
    assert.equal(
      await store.collection('helpdeskRequests').countDocuments(item.related),
      preserveRequests ? 1 : 0,
    );
    assert.equal(
      await store.collection('workflowRuns').countDocuments(item.related),
      preserveHistory ? 1 : 0,
    );
    assert.equal(
      (await store.collection('workflowVersions').countDocuments(item.related)) > 0,
      preserveHistory,
    );
    assert.equal(
      (await store.collection('workflowRevisions').countDocuments(item.related)) > 0,
      preserveHistory,
    );
    if (preserveRequests) {
      const retained = await store
        .collection('helpdeskRequests')
        .findOne({ ...scope, _id: item.request._id });
      assert.equal(retained.status, 'open');
      assert.deepEqual(retained.approvalUserIds, []);
      assert.equal(
        await store
          .collection('helpdeskTasks')
          .countDocuments({ ...scope, requestId: String(item.request._id) }),
        1,
      );
    }
    if (preserveHistory)
      assert.equal((await store.collection('workflowRuns').findOne(item.related)).status, 'failed');
  }
}
test('workflow deletion validates confirmation, preserves choices, blocks uncertain work and isolates workspaces', () =>
  verify(createMemoryDatabase()));
test('workflow deletion on MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI),
    db = client.db('az_workflow_deletion_' + new ObjectId());
  try {
    await verify(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
test('workflow deletion on PostgreSQL', { skip: !process.env.TEST_POSTGRES_URL }, async () => {
  const config = postgresConnection(process.env.TEST_POSTGRES_URL),
    admin = new pg.Pool(config),
    name = 'az_workflow_deletion_' + new ObjectId();
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
