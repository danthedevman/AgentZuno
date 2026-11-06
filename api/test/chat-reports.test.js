import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createChatReportsController } from '../src/controllers/workspace/chatReportsController.js';
async function verify(db) {
  const controller = createChatReportsController({ collection: db.collection.bind(db) });
  const admin = { id: String(new ObjectId()), workspaceId: String(new ObjectId()), role: 'admin' };
  const chat = {
    _id: new ObjectId(),
    ownerId: 'employee',
    providerOwnerId: admin.id,
    workspaceId: admin.workspaceId,
    title: 'Fixture Chat',
    createdAt: new Date(),
    updatedAt: new Date(),
    helpdeskPurpose: 'slack-support',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Private fixture message',
        toolCalls: [
          { name: 'Fixture Tool', status: 'completed', arguments: { secret: 'excluded-secret' } },
        ],
      },
    ],
  };
  await db.collection('chats').insertOne(chat);
  await db.collection('chats').insertOne({
    ...chat,
    _id: new ObjectId(),
    workspaceId: String(new ObjectId()),
    title: 'Foreign Chat',
  });
  const request = {
    helpdeskUser: admin,
    query: { days: '30', list: '1' },
    params: { id: String(chat._id) },
  };
  let value;
  const response = {
    json(body) {
      value = body;
    },
  };
  await controller.list(request, response);
  assert.equal(value.total, 1);
  assert.equal(value.rows[0].channel, 'Slack');
  assert.ok(!JSON.stringify(value).includes('Private fixture message'));
  await controller.get(request, response);
  assert.equal(value.messages[0].text, 'Private fixture message');
  assert.equal(value.channel, 'Slack');
  assert.equal(value.assistant, 'Support Agent');
  assert.equal(new Date(value.createdAt).getTime(), chat.createdAt.getTime());
  assert.ok(!JSON.stringify(value).includes('excluded-secret'));
  assert.equal(
    await db.collection('governanceAudit').countDocuments({ action: 'admin-chat-transcript-read' }),
    1,
  );
  for (const role of ['agent', 'user', 'read-only'])
    await assert.rejects(
      controller.get(
        { ...request, helpdeskUser: { ...admin, role, readOnlyRequest: true } },
        response,
      ),
      { status: 403 },
    );
  await assert.rejects(
    controller.get(
      { ...request, helpdeskUser: { ...admin, workspaceId: String(new ObjectId()) } },
      response,
    ),
    { status: 404 },
  );
  await assert.rejects(controller.get({ ...request, params: { id: { $ne: null } } }, response), {
    status: 400,
  });
  await assert.rejects(controller.list({ ...request, query: { q: { $ne: null } } }, response), {
    status: 400,
  });
}
test('Admin chat reports audit transcript reads and exclude secrets and other workspaces', () =>
  verify(createMemoryDatabase()));
test('Admin chat reports on MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI),
    db = client.db('az_chat_reports_' + new ObjectId());
  try {
    await verify(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
test('Admin chat reports on PostgreSQL', { skip: !process.env.TEST_POSTGRES_URL }, async () => {
  const config = postgresConnection(process.env.TEST_POSTGRES_URL),
    admin = new pg.Pool(config),
    name = 'az_chat_reports_' + new ObjectId();
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
