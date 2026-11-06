import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { ObjectId, MongoClient } from 'mongodb';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createHelpdeskController } from '../src/controllers/requests/helpdeskController.js';

async function verify(database) {
  const user = { id: String(new ObjectId()), workspaceId: String(new ObjectId()) };
  const chat = {
    _id: new ObjectId(),
    ownerId: user.id,
    workspaceId: user.workspaceId,
    providerOwnerId: user.id,
    helpdeskPurpose: 'slack-support',
    messages: [{ text: 'Private fixture' }],
  };
  await database.collection('chats').insertOne(chat);
  let normalReads = 0;
  const service = {
    async getSupport() {
      normalReads++;
      throw Object.assign(new Error('Not found'), { status: 404 });
    },
  };
  const controller = createHelpdeskController(database, service);
  let result;
  const response = {
    json(value) {
      result = value;
    },
  };
  const request = { helpdeskUser: user, params: { id: String(chat._id) }, query: {} };
  await controller.getSupportConversationsId(request, response);
  assert.deepEqual(result, { redirectTo: `/workspace/${user.workspaceId}/chat` });
  assert.equal(normalReads, 0);
  for (const changed of [
    { ...user, id: String(new ObjectId()) },
    { ...user, workspaceId: String(new ObjectId()) },
  ])
    await assert.rejects(
      controller.getSupportConversationsId({ ...request, helpdeskUser: changed }, response),
      { status: 404 },
    );
  await assert.rejects(
    controller.getSupportConversationsId({ ...request, params: { id: { $ne: null } } }, response),
    { status: 404 },
  );
}
test('legacy channel chat links redirect only for their current owner/workspace without exposing messages', () =>
  verify(createMemoryDatabase()));
test(
  'channel portal links preserve isolation on MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    const db = client.db('az_portal_' + new ObjectId());
    try {
      await verify(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);

test(
  'channel portal links preserve isolation on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const config = postgresConnection(process.env.TEST_POSTGRES_URL);
    const admin = new pg.Pool(config);
    const name = 'az_portal_' + new ObjectId();
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
