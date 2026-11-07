import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { validateWorkflowApprovalTargets } from '../src/requests/approvalTargets.js';

async function verify(db) {
  const store = createIntegrationStore(db);
  const user = { id: String(new ObjectId()), workspaceId: String(new ObjectId()), role: 'admin' };
  const groupId = new ObjectId();
  const groups = store.collection('approvalGroups');
  const scope = { ownerId: user.id, workspaceId: user.workspaceId };
  await groups.insertOne({
    ...scope,
    _id: groupId,
    name: 'Legal Review',
    active: true,
    approvalEnabled: true,
    userIds: [],
  });
  const definition = {
    steps: [{ action: 'approval', params: { target: 'group', groupId: String(groupId) } }],
  };
  await assert.rejects(validateWorkflowApprovalTargets(store, user, definition), /has no members/);
  await groups.updateOne({ ...scope, _id: groupId }, { $set: { approvalEnabled: false } });
  await assert.rejects(
    validateWorkflowApprovalTargets(store, user, definition),
    /Enable approvals/,
  );
  await groups.updateOne({ ...scope, _id: groupId }, { $set: { active: false } });
  await assert.rejects(
    validateWorkflowApprovalTargets(store, user, definition),
    /active approval group/,
  );
  await groups.updateOne(
    { ...scope, _id: groupId },
    { $set: { active: true, approvalEnabled: true, userIds: [String(new ObjectId())] } },
  );
  await validateWorkflowApprovalTargets(store, user, definition);
  await assert.rejects(
    validateWorkflowApprovalTargets(
      store,
      { ...user, workspaceId: String(new ObjectId()) },
      definition,
    ),
    /active approval group/,
  );
  await assert.rejects(
    validateWorkflowApprovalTargets(store, { ...user, id: String(new ObjectId()) }, definition),
    /active approval group/,
  );
  await assert.rejects(
    validateWorkflowApprovalTargets(store, user, {
      steps: [{ action: 'approval', params: { target: 'group', groupId: { $ne: null } } }],
    }),
  );
}
test('approval groups distinguish inactive, disabled and empty targets without crossing workspaces', () =>
  verify(createMemoryDatabase()));
test('approval group validation on MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI),
    db = client.db('az_approval_targets_' + new ObjectId());
  try {
    await verify(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
test(
  'approval group validation on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const config = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(config),
      name = 'az_approval_targets_' + new ObjectId();
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
