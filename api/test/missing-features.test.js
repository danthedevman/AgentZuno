import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createApi } from '../src/app.js';
test(
  'personal/team reports, member removal, custom table deletion, topics and attachments enforce scope and confirmation',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_missing_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(database);
    const app = createApi();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    async function call(actor, path, method = 'GET', body, headers = {}) {
      const result = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(actor ? { cookie: actor.cookie, 'X-Workspace-Id': actor.workspaceId } : {}),
          ...headers,
        },
        ...(body === undefined
          ? {}
          : {
              body:
                headers['Content-Type'] === 'application/octet-stream'
                  ? body
                  : JSON.stringify(body),
            }),
      });
      return {
        status: result.status,
        body: (result.headers.get('content-type') || '').includes('application/json')
          ? await result.json()
          : await result.text(),
        cookie: result.headers.get('set-cookie')?.split(';')[0],
      };
    }
    async function register(name) {
      const result = await call(null, '/auth/register', 'POST', {
        email: `${name}@missing.test`,
        password: 'Fictional-missing-test-password!',
      });
      assert.equal(result.status, 201);
      return { ...result.body.user, cookie: result.cookie };
    }
    try {
      const admin = await register('admin'),
        other = await register('other'),
        agent = await register('agent');
      const scope = { ownerId: admin.id, workspaceId: admin.workspaceId };
      await db.collection('helpdeskMembers').insertOne({
        ...scope,
        userId: agent.id,
        email: agent.email,
        role: 'agent',
        active: true,
        queues: ['Support'],
        canApprove: false,
        version: 1,
      });
      const actor = { ...agent, workspaceId: admin.workspaceId };
      await db.collection('approvalGroups').insertMany([
        {
          ...scope,
          name: 'Support',
          userIds: [agent.id],
          assignmentEnabled: true,
          approvalEnabled: false,
          unifiedVersion: 1,
          active: true,
          version: 1,
        },
        {
          ...scope,
          name: 'Finance',
          userIds: [],
          assignmentEnabled: true,
          approvalEnabled: false,
          unifiedVersion: 1,
          active: true,
          version: 1,
        },
      ]);
      await db.collection('helpdeskRequests').insertMany([
        {
          ...scope,
          requestId: randomUUID(),
          title: 'Mine',
          number: 'REQ-1',
          requesterId: admin.id,
          assignedToId: agent.id,
          queueName: 'Support',
          status: 'open',
          submissionState: 'submitted',
          updatedAt: new Date(),
        },
        {
          ...scope,
          requestId: randomUUID(),
          title: 'Other',
          number: 'REQ-2',
          requesterId: admin.id,
          assignedToId: admin.id,
          queueName: 'Finance',
          status: 'resolved',
          submissionState: 'submitted',
          updatedAt: new Date(),
        },
      ]);
      assert.equal((await call(actor, '/helpdesk/my-work?summary=1')).body.total, 1);
      assert.equal((await call(actor, '/helpdesk/my-work?list=1&status=resolved')).body.total, 0);
      assert.equal((await call(actor, '/helpdesk/my-team?summary=1')).body.total, 1);
      assert.equal((await call(admin, '/helpdesk/my-team?summary=1')).body.total, 2);
      assert.equal((await call(actor, '/helpdesk/my-team?list=1&kind=groups')).body.total, 1);
      assert.equal((await call(other, '/helpdesk/my-team?summary=1')).body.total, 0);
      assert.equal((await call(admin, '/helpdesk/ai-status')).body.enabled, false);
      assert.deepEqual(Object.keys((await call(admin, '/helpdesk/ai-status')).body), ['enabled']);
      assert.equal(
        (
          await call(admin, `/helpdesk/members/${admin.id}`, 'PUT', {
            role: 'admin',
            queues: [],
            active: false,
            canApprove: false,
            version: 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/workforce-profiles/${admin.id}/cover`, 'PUT', {
            theme: 'violet',
          })
        ).status,
        200,
      );
      assert.equal(
        (await call(admin, `/helpdesk/workforce-profiles/${admin.id}`)).body.coverTheme,
        'violet',
      );
      assert.equal(
        (
          await call(other, `/helpdesk/workforce-profiles/${admin.id}/cover`, 'PUT', {
            theme: 'violet',
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/workforce-profiles/${admin.id}/cover`, 'PUT', {
            theme: 'invalid',
          })
        ).status,
        400,
      );
      const table = await call(admin, '/helpdesk/data/tables', 'POST', {
        definition: {
          name: 'Custom Devices',
          description: '',
          fields: [{ id: 'name', label: 'Name', type: 'text', required: true }],
        },
      });
      assert.equal(table.status, 201, JSON.stringify(table.body));
      const tableId = table.body.id;
      assert.equal(
        (
          await call(admin, `/helpdesk/data/tables/${tableId}/records`, 'POST', {
            values: { name: 'Phone' },
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await call(other, `/helpdesk/data/tables/${tableId}`, 'DELETE', {
            name: 'Custom Devices',
            confirmed: true,
            version: 1,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/data/tables/${tableId}`, 'DELETE', {
            name: 'Wrong',
            confirmed: true,
            version: 1,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/data/tables/ref-asset', 'DELETE', {
            name: 'Assets',
            confirmed: true,
            version: 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/data/tables/${tableId}`, 'DELETE', {
            name: 'Custom Devices',
            confirmed: true,
            version: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        await db.collection('adminDataRecords').countDocuments({ ...scope, tableId }),
        0,
      );
      const article = {
        title: 'Help',
        body: '<p>Useful guidance</p>',
        knowledgeBaseId: admin.workspaceId,
        topicIds: [],
      };
      assert.equal((await call(admin, '/articles', 'POST', article)).status, 400);
      const previewWithoutTopic = await call(admin, '/helpdesk/article-proposals', 'POST', {
        draft: article,
      });
      assert.equal(previewWithoutTopic.status, 201, JSON.stringify(previewWithoutTopic.body));
      assert.equal(
        (
          await call(
            admin,
            `/helpdesk/article-proposals/${previewWithoutTopic.body.id}/approve`,
            'POST',
            { approved: true },
          )
        ).status,
        400,
      );
      const topic = await call(admin, '/topics', 'POST', {
        name: 'Support',
        description: '',
        articleIds: [],
      });
      assert.equal(topic.status, 201);
      assert.equal(
        (await call(admin, '/articles', 'POST', { ...article, topicIds: [topic.body.id] })).status,
        201,
      );
      const request = await call(admin, '/helpdesk/requests', 'POST', {
        requestId: randomUUID(),
        title: 'Attachment Request',
        text: 'Please help',
      });
      assert.equal(request.status, 201);
      const upload = await call(
        admin,
        `/helpdesk/request-attachments/${request.body.id}`,
        'POST',
        Buffer.from('Private contents'),
        { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'test.txt' },
      );
      assert.equal(upload.status, 201, JSON.stringify(upload.body));
      assert.equal(
        (await call(other, `/helpdesk/request-attachments/${request.body.id}`)).status,
        404,
      );
      assert.equal(
        (await call(admin, `/helpdesk/request-attachments/${request.body.id}`)).body.length,
        1,
      );
      assert.equal(
        (await call(other, `/helpdesk/request-attachments/${request.body.id}/${upload.body.id}`))
          .status,
        404,
      );
      await call(admin, '/auth/impersonation', 'POST', {
        role: 'read-only',
        workspaceId: admin.workspaceId,
      });
      assert.equal(
        (
          await call(
            admin,
            `/helpdesk/request-attachments/${request.body.id}`,
            'POST',
            Buffer.from('no'),
            { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'test.txt' },
          )
        ).status,
        403,
      );
      await call(admin, '/auth/impersonation', 'POST', {
        role: 'admin',
        workspaceId: admin.workspaceId,
      });
      assert.equal(
        (
          await call(admin, `/helpdesk/members/${agent.id}`, 'DELETE', {
            confirmed: false,
            version: 1,
          })
        ).status,
        400,
      );
      await db.collection('identitySettings').insertOne({ ...scope, enabled: true });
      assert.equal(
        (
          await call(admin, `/helpdesk/members/${agent.id}`, 'DELETE', {
            confirmed: true,
            version: 1,
          })
        ).status,
        409,
      );
      await db.collection('identitySettings').deleteMany(scope);
      assert.equal(
        (
          await call(admin, `/helpdesk/members/${admin.id}`, 'DELETE', {
            confirmed: true,
            version: 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/members/${agent.id}`, 'DELETE', {
            confirmed: true,
            version: 1,
          })
        ).status,
        200,
      );
      assert.equal((await call(actor, '/helpdesk/my-work?summary=1')).status, 403);
      assert.equal(
        (await db.collection('helpdeskRequests').findOne({ ...scope, title: 'Mine' })).assignedToId,
        undefined,
      );
      assert.ok(await db.collection('users').findOne({ id: agent.id }));
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await db.dropDatabase();
      await client.close();
    }
  },
);
