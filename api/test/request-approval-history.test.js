import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { requestApprovalHistory } from '../src/requests/requestApprovals.js';
import { resolveWorkflowApprovers } from '../src/requests/approvalTargets.js';

async function verify(db) {
  const store = createIntegrationStore(db);
  const user = {
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    role: 'admin',
    canApprove: false,
  };
  const scope = { ownerId: user.id, workspaceId: user.workspaceId };
  const groupId = new ObjectId();
  const request = {
    ...scope,
    _id: new ObjectId(),
    requesterId: user.id,
    queueName: 'Support',
    approvals: [],
  };
  await store.collection('approvalGroups').insertOne({
    ...scope,
    _id: groupId,
    name: 'Legal Review',
    active: true,
    approvalEnabled: true,
    userIds: [user.id],
  });
  const declared = (id) => ({
    id,
    action: 'approval',
    params: { target: 'group', groupId: String(groupId), reason: 'Review access' },
  });
  await store.collection('workflowRuns').insertOne({
    ...scope,
    _id: 'failed-run',
    requestId: String(request._id),
    actorId: user.id,
    status: 'failed',
    revision: 2,
    source: 'SECRET SOURCE',
    input: { private: 'SECRET INPUT' },
    definition: { steps: [declared('legal'), declared('later')] },
    steps: [
      {
        id: 'legal',
        action: 'approval',
        status: 'awaiting-approval',
        input: { reason: 'Review access' },
        startedAt: new Date(),
      },
    ],
  });
  await store.collection('workflowRuns').insertOne({
    ...scope,
    _id: 'completed-run',
    requestId: String(request._id),
    status: 'complete',
    revision: 1,
    definition: { steps: [declared('conditional'), declared('approved'), declared('rejected')] },
    steps: [
      {
        id: 'conditional',
        action: 'approval',
        status: 'complete',
        result: { approved: true, skipped: true },
      },
      {
        id: 'approved',
        action: 'approval',
        status: 'complete',
        result: { approved: true, decidedBy: user.id, comment: 'Confirmed' },
        completedAt: new Date(),
      },
      {
        id: 'rejected',
        action: 'approval',
        status: 'complete',
        result: { approved: false, comment: 'Needs review' },
      },
    ],
  });
  await store
    .collection('helpdeskMembers')
    .insertOne({ ...scope, userId: user.id, active: true, canApprove: true });
  await store.collection('users').insertOne({ id: user.id, name: 'Example approver' });
  const rows = await requestApprovalHistory(store, user, request);
  assert.equal(rows.length, 5);
  assert.equal(rows.find((row) => row.stepId === 'legal').status, 'blocked');
  assert.equal(rows.find((row) => row.stepId === 'legal').target, 'Legal Review');
  assert.equal(rows.find((row) => row.stepId === 'later').status, 'not-reached');
  assert.equal(rows.find((row) => row.stepId === 'conditional').status, 'skipped');
  assert.equal(rows.find((row) => row.stepId === 'approved').decidedBy, 'Example approver');
  assert.equal(rows.find((row) => row.stepId === 'rejected').status, 'rejected');
  assert.equal(
    rows.every((row) => !row.canDecide),
    true,
  );
  assert.doesNotMatch(JSON.stringify(rows), /SECRET/);
  await assert.rejects(
    requestApprovalHistory(store, { ...user, workspaceId: String(new ObjectId()) }, request),
    { status: 404 },
  );
  await assert.rejects(
    requestApprovalHistory(
      store,
      { ...user, id: String(new ObjectId()), helpdeskOwnerId: user.id, role: 'user' },
      request,
    ),
    { status: 404 },
  );
  assert.equal((await requestApprovalHistory(store, { ...user, role: 'user' }, request)).length, 5);
  await assert.rejects(
    resolveWorkflowApprovers(
      store,
      { ...scope, actorId: user.id },
      { target: 'group', groupId: String(groupId) },
    ),
    { approvalFailureCode: 'self-approval' },
  );
}
test('request approval history exposes states and safe decision metadata under request authorization', () =>
  verify(createMemoryDatabase()));
test('request approval history on MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI),
    db = client.db('az_request_approvals_' + new ObjectId());
  try {
    await verify(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
test(
  'request approval history on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const config = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(config),
      name = 'az_request_approvals_' + new ObjectId();
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
