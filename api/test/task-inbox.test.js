import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createHelpdeskService, installHelpdeskRoutes } from '../src/helpdesk.js';
import { createRequestTasks } from '../src/requestTasks.js';
import { createRecordMentionDelivery } from '../src/recordMentions.js';
import { installRecordActivityRoutes } from '../src/recordActivity.js';

async function verify(database) {
  const ownerId = new ObjectId().toString(),
    workspaceId = new ObjectId().toString();
  const actors = {};
  for (const [name, role, queues] of [
    ['Admin', 'admin', []],
    ['Support', 'agent', ['Support']],
    ['Desktop', 'agent', ['Desktop']],
    ['Outside', 'agent', ['Other']],
    ['Employee', 'user', []],
    ['Audit', 'read-only', []],
  ]) {
    const id = name === 'Admin' ? ownerId : new ObjectId().toString();
    actors[name] = { id, name, role, queues, workspaceId, helpdeskOwnerId: ownerId };
    await database
      .collection('users')
      .insertOne({ ...actors[name], email: name + '@example.test' });
    await database
      .collection('helpdeskMembers')
      .insertOne({ ownerId, workspaceId, userId: id, role, queues, active: true });
  }
  const requestId = new ObjectId();
  await database.collection('helpdeskRequests').insertOne({
    _id: requestId,
    ownerId,
    workspaceId,
    requesterId: actors.Employee.id,
    queueName: 'Support',
    title: 'Laptop',
    number: 'REQ-000001',
    status: 'open',
    submissionState: 'submitted',
    updatedAt: new Date(),
  });
  await database
    .collection('helpdeskInbox')
    .createIndex({ ownerId: 1, workspaceId: 1, requestId: 1 }, { unique: true });
  const store = { collection: database.collection.bind(database), ready: async () => {} };
  const tasks = createRequestTasks(store);
  const first = await tasks.create(
    actors.Admin,
    String(requestId),
    { title: 'Set up laptop', description: 'Install apps', dueDate: '2028-02-29' },
    'one',
  );
  const second = await tasks.create(
    actors.Admin,
    String(requestId),
    { title: 'Set up screen' },
    'two',
  );
  await database
    .collection('helpdeskTasks')
    .updateOne({ _id: new ObjectId(second.id) }, { $set: { queueName: 'Desktop' } });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = req.helpdeskUser = actors[req.headers['x-test-user'] || 'Support'];
    next();
  });
  installHelpdeskRoutes(app, store, createHelpdeskService(store, {}));
  installRecordActivityRoutes(app, store);
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.publicMessage || error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  async function call(path, user = 'Support', method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/helpdesk${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-test-user': user },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  try {
    assert.equal((await call(`/tasks/${first.id}`, 'Admin')).body.dueDate, '2028-02-29');
    for (const dueDate of [
      '2027-02-29',
      '2026-04-31',
      '11/05/2026',
      { $ne: null },
      ['2026-11-05'],
      null,
    ]) {
      assert.equal(
        (await call(`/tasks/${first.id}`, 'Admin', 'PUT', { dueDate, status: 'open', version: 1 }))
          .status,
        400,
      );
    }
    const activityPath = `/record-activity/task/${first.id}`;
    assert.equal(
      (
        await call(activityPath, 'Employee', 'POST', {
          type: 'comment',
          text: 'Please help <script>no</script>',
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await call(activityPath, 'Support', 'POST', {
          type: 'note',
          text: 'Internal staff context',
        })
      ).status,
      201,
    );
    assert.equal((await call(activityPath + '?type=notes', 'Employee')).status, 403);
    assert.equal(
      (await call(activityPath, 'Employee', 'POST', { type: 'note', text: 'Forbidden' })).status,
      403,
    );
    assert.equal(
      (await call(activityPath, 'Audit', 'POST', { type: 'comment', text: 'Forbidden' })).status,
      403,
    );
    assert.equal((await call(activityPath, 'Outside')).status, 404);
    assert.equal(
      (await call(activityPath, 'Admin', 'POST', { type: 'comment', text: { $gt: '' } })).status,
      400,
    );
    assert.equal(
      (
        await call(activityPath, 'Admin', 'POST', {
          type: 'comment',
          text: 'Forged',
          authorId: actors.Admin.id,
        })
      ).status,
      400,
    );
    const comments = (await call(activityPath, 'Employee')).body;
    assert.equal(comments.total, 1);
    assert.equal(comments.rows[0].authorId, actors.Employee.id);
    assert.equal(comments.rows[0].ownerId, undefined);
    assert.equal(comments.permissions.canReadNotes, false);
    assert.ok(!JSON.stringify(comments).includes('Internal staff context'));
    assert.equal(
      (await call(activityPath + '?type=notes', 'Support')).body.rows[0].text,
      'Internal staff context',
    );
    const originalWorkspace = actors.Admin.workspaceId;
    actors.Admin.workspaceId = new ObjectId().toString();
    assert.equal((await call(activityPath, 'Admin')).status, 404);
    actors.Admin.workspaceId = originalWorkspace;
    const groupId = new ObjectId();
    await database
      .collection('approvalGroups')
      .insertOne({ _id: groupId, ownerId, workspaceId, name: 'Support' });
    const groupPath = `/record-activity/group/${groupId}`;
    assert.equal(
      (await call(groupPath, 'Admin', 'POST', { type: 'note', text: 'Group note' })).status,
      201,
    );
    assert.equal((await call(groupPath, 'Support')).status, 403);
    assert.equal((await call(groupPath + '?type=notes', 'Admin')).body.total, 1);
    const tableId = new ObjectId(),
      dataId = new ObjectId();
    await database.collection('adminDataTables').insertOne({
      _id: tableId,
      ownerId,
      workspaceId,
      name: 'Assets',
      fields: [{ id: 'name', label: 'Name', type: 'text' }],
    });
    await database.collection('adminDataRecords').insertOne({
      _id: dataId,
      ownerId,
      workspaceId,
      tableId: String(tableId),
      values: { name: 'Laptop' },
    });
    const dataPath = `/record-activity/data/${dataId}`;
    assert.equal(
      (
        await call(dataPath, 'Admin', 'POST', {
          type: 'comment',
          text: 'Data comment',
          tableId: String(tableId),
        })
      ).status,
      201,
    );
    assert.equal((await call(dataPath + `?tableId=${tableId}`, 'Admin')).body.total, 1);
    assert.equal((await call(dataPath + `?tableId=${new ObjectId()}`, 'Admin')).status, 404);
    assert.equal((await call(dataPath + `?tableId=${tableId}`, 'Employee')).status, 403);
    actors.Support.queues = [];
    assert.equal((await call(activityPath + '?type=notes', 'Support')).status, 404);
    actors.Support.queues = ['Support'];
    for (let index = 0; index < 21; index++)
      await call(activityPath, 'Admin', 'POST', { type: 'comment', text: `Comment ${index}` });
    const page = (await call(activityPath + '?page=2&pageSize=20', 'Admin')).body;
    assert.equal(page.total, 22);
    assert.equal(page.rows.length, 2);
    const inbox = await call('/inbox?list=1');
    assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
    assert.ok(inbox.body.rows.some((row) => row.id === first.id && row.kind === 'task'));
    assert.ok(!inbox.body.rows.some((row) => row.id === second.id));
    const desktop = await call('/inbox?list=1', 'Desktop');
    assert.deepEqual(
      desktop.body.rows.map((row) => row.id),
      [second.id],
    );
    assert.equal((await call('/inbox?list=1', 'Outside')).body.total, 0);
    assert.equal((await call('/inbox?list=1', 'Employee')).body.total, 0);
    const unread = await call('/inbox/unread', 'Desktop');
    assert.equal(unread.body.unread, true);
    await call('/inbox/viewed', 'Desktop', 'POST', {});
    assert.equal((await call('/inbox/unread', 'Desktop')).body.unread, false);
    const task = await call(`/tasks/${second.id}`, 'Desktop');
    assert.equal(task.body.permissions.canEdit, true);
    assert.equal(task.body.requestReference.href, undefined);
    assert.equal((await call(`/requests/${requestId}`, 'Desktop')).status, 404);
    assert.equal((await call(`/tasks/${second.id}`, 'Outside')).status, 404);
    assert.equal((await call(`/tasks/${first.id}`, 'Employee')).body.permissions.canEdit, false);
    for (const user of ['Employee', 'Audit'])
      assert.equal(
        (await call(`/tasks/${first.id}`, user, 'PUT', { status: 'closed', version: 1 })).status,
        403,
      );
    for (const payload of [
      { status: 'closed', version: { $ne: 0 } },
      { status: 'closed', version: [1] },
      { status: 'closed', version: Number.MAX_SAFE_INTEGER + 1 },
      { status: 'closed', version: 1, assignedToId: { $ne: null } },
      { status: 'closed', version: 1, assignedToId: ['Support'] },
    ]) {
      assert.equal((await call(`/tasks/${second.id}`, 'Admin', 'PUT', payload)).status, 400);
      assert.equal((await call(`/tasks/${second.id}`, 'Admin')).body.version, 1);
    }
    const updated = await call(`/tasks/${second.id}`, 'Desktop', 'PUT', {
      title: 'Screen setup',
      description: 'Connect the screen',
      status: 'closed',
      version: 1,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.title, 'Screen setup');
    assert.equal(updated.body.status, 'closed');
    assert.equal(
      (await call(`/tasks/${second.id}`, 'Desktop', 'PUT', { status: 'open', version: 1 })).status,
      409,
    );
    const assigned = await call(`/tasks/${first.id}`, 'Admin', 'PUT', {
      status: 'in-progress',
      assignedToId: actors.Support.id,
      version: 1,
    });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.assignedToName, 'Support');
    assert.equal(assigned.body.dueDate, '2028-02-29');
    const clearedDate = await call(`/tasks/${second.id}`, 'Admin', 'PUT', {
      dueDate: '',
      status: 'closed',
      version: 2,
    });
    assert.equal(clearedDate.status, 200);
    assert.equal(clearedDate.body.dueDate, '');
    assert.equal(
      (
        await call(`/tasks/${first.id}`, 'Admin', 'PUT', {
          status: 'open',
          assignedToId: actors.Employee.id,
          version: 2,
        })
      ).status,
      400,
    );
    // Two task archives must coexist with the existing request archive uniqueness constraint.
    await database
      .collection('helpdeskMembers')
      .updateOne({ userId: actors.Support.id }, { $set: { queues: ['Support', 'Desktop'] } });
    actors.Support.queues = ['Support', 'Desktop'];
    for (const id of [first.id, second.id])
      assert.equal((await call(`/inbox/${id}`, 'Support', 'PUT', { archived: true })).status, 200);
    assert.equal((await call('/inbox?list=1&tab=archive')).body.total, 2);
    assert.equal(
      (await call('/inbox?list=1')).body.rows.filter((row) => row.kind === 'task').length,
      0,
    );
    actors.Support.queues = [];
    assert.equal((await call('/inbox?list=1&tab=archive')).body.total, 1); // Directly assigned task remains visible.
    const mentionOptions = await call(activityPath + '/mention-options?kind=work-note', 'Admin');
    assert.equal(mentionOptions.status, 200);
    assert.ok(mentionOptions.body.some((item) => item.value === actors.Support.id));
    assert.ok(!mentionOptions.body.some((item) => item.value === actors.Employee.id));
    assert.equal(
      (
        await call(activityPath, 'Admin', 'POST', {
          type: 'note',
          text: '@Employee hidden',
          mentionIds: [actors.Employee.id],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(activityPath, 'Admin', 'POST', {
          type: 'comment',
          text: '@Employee ready',
          mentionIds: [actors.Employee.id],
        })
      ).status,
      201,
    );
    const mentionInbox = await call('/inbox?list=1', 'Employee');
    const notice = mentionInbox.body.rows.find((item) => item.kind === 'record-mention');
    assert.ok(notice);
    assert.equal(notice.inboxNotice, 'Mentioned You in a Comment');
    assert.ok(notice.href.includes(`/tasks/${first.id}?activity=comments`));
    assert.equal(notice.text, undefined);
    assert.equal(notice.notifications, undefined);
    assert.equal((await call('/inbox/unread', 'Employee')).body.unread, true);
    await call('/inbox/viewed', 'Employee', 'POST', {});
    assert.equal((await call('/inbox/unread', 'Employee')).body.unread, false);
    assert.equal(
      (await call(`/inbox/${notice.id}`, 'Employee', 'PUT', { archived: true })).status,
      200,
    );
    assert.equal((await call('/inbox?list=1', 'Employee')).body.total, 0);
    assert.equal((await call('/inbox?list=1&tab=archive', 'Employee')).body.total, 1);
    assert.equal(
      (
        await call(activityPath, 'Admin', 'POST', {
          type: 'note',
          text: '@Support private context',
          mentionIds: [actors.Support.id],
        })
      ).status,
      201,
    );
    const supportNotice = (await call('/inbox?list=1', 'Support')).body.rows.find(
      (item) => item.kind === 'record-mention',
    );
    assert.equal(supportNotice.inboxNotice, 'Mentioned You in a Work Note');
    assert.ok(supportNotice.href.endsWith('?activity=notes'));
    await database
      .collection('helpdeskMembers')
      .updateOne({ userId: actors.Employee.id }, { $set: { active: false } });
    const sent = [];
    const deliver = createRecordMentionDelivery(store, async (message) => sent.push(message));
    await deliver();
    await deliver();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'Support@example.test');
    assert.ok(!sent[0].text.includes('private context'));
    await database
      .collection('helpdeskTasks')
      .updateOne({ _id: new ObjectId(first.id) }, { $set: { assignedToId: '' } });
    assert.ok(
      !(await call('/inbox?list=1', 'Support')).body.rows.some(
        (item) => item.kind === 'record-mention',
      ),
    );
    actors.Support.workspaceId = new ObjectId().toString();
    assert.equal((await call(`/tasks/${first.id}`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test('task cards and assignment inbox permissions work in memory', async () =>
  verify(createMemoryDatabase()));
test(
  'task assignments and edits work with MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    const database = client.db('az_task_inbox_' + new ObjectId());
    try {
      await verify(database);
    } finally {
      await database.dropDatabase();
      await client.close();
    }
  },
);
test(
  'task assignments and edits work with PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL);
    const admin = new pg.Pool(connection);
    const name = 'az_task_inbox_' + new ObjectId();
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
