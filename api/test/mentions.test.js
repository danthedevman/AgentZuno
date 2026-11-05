import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createHelpdeskService, installHelpdeskRoutes } from '../src/helpdesk.js';
import { createMentionDelivery } from '../src/mentions.js';

async function verify(database) {
  const workspaceId = new ObjectId().toString();
  const adminId = new ObjectId().toString();
  const actors = {};
  for (const [name, role, queues] of [
    ['Admin', 'admin', []],
    ['Agent', 'agent', ['Support']],
    ['Requester', 'user', []],
    ['Outsider', 'user', []],
  ]) {
    const id = name === 'Admin' ? adminId : new ObjectId().toString();
    actors[name] = {
      id,
      name,
      email: name.toLowerCase() + '@example.test',
      workspaceId,
      helpdeskOwnerId: adminId,
      role,
      queues,
    };
    await database.collection('users').insertOne(actors[name]);
    await database
      .collection('helpdeskMembers')
      .insertOne({ ownerId: adminId, workspaceId, userId: id, role, queues, active: true });
  }
  const request = {
    _id: new ObjectId(),
    ownerId: adminId,
    workspaceId,
    requesterId: actors.Requester.id,
    queueName: 'Support',
    title: 'Laptop',
    description: 'A new laptop',
    number: 'REQ-000001',
    chatId: new ObjectId().toString(),
    status: 'open',
    channel: 'web',
    submissionState: 'submitted',
    messages: [],
    workNotes: [],
    events: [],
    approvals: [],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await database.collection('helpdeskRequests').insertOne(request);
  const store = { collection: database.collection.bind(database), ready: async () => {} };
  const service = createHelpdeskService(store, {});
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.helpdeskUser = actors[req.headers['x-test-user'] || 'Agent'];
    req.user = req.helpdeskUser;
    next();
  });
  installHelpdeskRoutes(app, store, service);
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.publicMessage || error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  async function call(path, method = 'GET', body, actor = 'Agent') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/helpdesk${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Test-User': actor },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  try {
    const options = await call(`/requests/${request._id}/mention-options?q=Request`);
    assert.equal(options.status, 200);
    assert.deepEqual(
      options.body.map((item) => item.label),
      ['Requester'],
    );
    const internal = await call(`/requests/${request._id}/mention-options?kind=work-note`);
    assert.ok(!internal.body.some((item) => item.value === actors.Requester.id));
    assert.equal(
      (
        await call(`/requests/${request._id}/work-notes`, 'POST', {
          version: 1,
          text: '@Requester private',
          mentionIds: [actors.Requester.id],
        })
      ).status,
      400,
    );
    const comment = await call(`/requests/${request._id}/comments`, 'POST', {
      version: 1,
      text: '@Requester please review',
      mentionIds: [actors.Requester.id],
    });
    assert.equal(comment.status, 200, JSON.stringify(comment.body));
    assert.equal(comment.body.notifications, undefined);
    const inbox = await call('/inbox?list=1', 'GET', null, 'Requester');
    assert.equal(inbox.body.total, 1);
    assert.equal(inbox.body.rows[0].inboxNotice, 'Mentioned You');
    assert.equal((await call('/inbox/unread', 'GET', null, 'Requester')).body.unread, true);
    assert.equal((await call('/inbox/viewed', 'POST', {}, 'Requester')).status, 200);
    assert.equal((await call('/inbox/unread', 'GET', null, 'Requester')).body.unread, false);
    assert.equal((await call('/inbox/unread', 'GET', null, 'Outsider')).body.hasMentions, false);
    const note = await call(`/requests/${request._id}/work-notes`, 'POST', {
      version: 2,
      text: '@Admin a private work note',
      mentionIds: [adminId],
    });
    assert.equal(note.status, 200, JSON.stringify(note.body));
    const employeeView = await call(`/requests/${request._id}`, 'GET', null, 'Requester');
    assert.equal(employeeView.body.workNotes, undefined);
    assert.equal(employeeView.body.notifications, undefined);
    assert.equal(
      (
        await call(`/requests/${request._id}/comments`, 'POST', {
          version: 3,
          text: '@Outsider no access',
          mentionIds: [actors.Outsider.id],
        })
      ).status,
      400,
    );
    await database
      .collection('helpdeskMembers')
      .updateOne({ userId: actors.Requester.id }, { $set: { active: false } });
    const sent = [];
    const deliver = createMentionDelivery(store, service, async (message) => sent.push(message));
    await deliver();
    await deliver();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, actors.Admin.email);
    assert.ok(!sent[0].text.includes('private work note'));
    const saved = await database.collection('helpdeskRequests').findOne({ _id: request._id });
    assert.equal(
      saved.notifications.find((item) => item.recipientId === adminId).emailStatus,
      'sent',
    );
    assert.equal(
      saved.notifications.find((item) => item.recipientId === actors.Requester.id).emailStatus,
      'denied',
    );
    const next = await call(`/requests/${request._id}/comments`, 'POST', {
      version: 3,
      text: '@Admin update',
      mentionIds: [adminId],
    });
    assert.equal(next.status, 200);
    const uncertain = createMentionDelivery(store, service, async () => {
      throw new Error('SMTP connection lost');
    });
    await uncertain();
    await deliver();
    assert.equal(sent.length, 1);
    const final = await database.collection('helpdeskRequests').findOne({ _id: request._id });
    assert.equal(final.notifications.at(-1).emailStatus, 'delivery-unknown');
    assert.equal(final.notifications[1].emailStatus, 'sent');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('mentions preserve request and work-note permissions, Inbox read state, and durable email delivery in memory', async () =>
  verify(createMemoryDatabase()));
test(
  'mentions and notification outbox work with MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    const database = client.db('az_mentions_' + new ObjectId());
    try {
      await verify(database);
    } finally {
      await database.dropDatabase();
      await client.close();
    }
  },
);
test(
  'mentions and notification outbox work with PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL);
    const admin = new pg.Pool(connection);
    const name = 'az_mentions_' + new ObjectId();
    await admin.query(`CREATE DATABASE ${name}`);
    const database = createPostgresDatabase({ ...connection, database: name });
    try {
      await verify(database);
    } finally {
      await database.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  },
);
