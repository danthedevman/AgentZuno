import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createApi } from '../src/app.js';
test(
  'My Work scopes assigned lists and reports by person, workspace and current agent access',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    process.env.MONGODB_DATABASE = `agentzuno_work_${randomUUID().replaceAll('-', '')}`;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE);
    const app = createApi();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    async function call(cookie, path, body, workspace) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { cookie } : {}),
          ...(workspace ? { 'X-Workspace-Id': workspace } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    }
    try {
      const admin = await call(null, '/auth/register', {
        email: 'owner@mywork.test',
        password: 'Fictional-mywork-password!',
      });
      const agent = await call(null, '/auth/register', {
        email: 'agent@mywork.test',
        password: 'Fictional-mywork-password!',
      });
      const scope = { ownerId: admin.body.user.id, workspaceId: admin.body.user.workspaceId };
      const actor = agent.body.user.id;
      await db
        .collection('helpdeskMembers')
        .insertOne({
          ...scope,
          userId: actor,
          active: true,
          role: 'agent',
          queues: ['Desktop'],
          canApprove: false,
          version: 1,
        });
      await db.collection('helpdeskRequests').insertMany([
        {
          _id: new ObjectId(),
          ...scope,
          requesterId: scope.ownerId,
          assignedToId: scope.ownerId,
          title: 'Owner assignment',
          status: 'open',
          queueName: 'Desktop',
          updatedAt: new Date(),
        },
        {
          _id: new ObjectId(),
          ...scope,
          requesterId: scope.ownerId,
          assignedToId: actor,
          title: 'Agent assignment',
          status: 'waiting-for-employee',
          queueName: 'Desktop',
          description: 'Private details excluded',
          updatedAt: new Date(),
        },
        {
          _id: new ObjectId(),
          ...scope,
          requesterId: scope.ownerId,
          assignedToId: actor,
          title: 'Outside agent group',
          status: 'open',
          queueName: 'Finance',
          updatedAt: new Date(),
        },
        {
          _id: new ObjectId(),
          ownerId: actor,
          workspaceId: agent.body.user.workspaceId,
          assignedToId: scope.ownerId,
          title: 'Foreign workspace',
          status: 'open',
          updatedAt: new Date(),
        },
      ]);
      assert.equal((await call(null, '/helpdesk/my-work')).status, 401);
      const report = await call(
        admin.cookie,
        '/helpdesk/my-work?summary=1',
        undefined,
        scope.workspaceId,
      );
      assert.equal(report.status, 200);
      assert.equal(report.body.total, 1);
      const agentReport = await call(
        agent.cookie,
        '/helpdesk/my-work?summary=1',
        undefined,
        scope.workspaceId,
      );
      assert.equal(agentReport.status, 200);
      assert.equal(agentReport.body.total, 1);
      assert.deepEqual(agentReport.body.statuses, [{ name: 'waiting-for-employee', value: 1 }]);
      const list = await call(
        agent.cookie,
        '/helpdesk/my-work?list=1&sort=Request&q=Agent&pageSize=20',
        undefined,
        scope.workspaceId,
      );
      assert.equal(list.status, 200);
      assert.equal(list.body.total, 1);
      assert.equal(list.body.rows[0].title, 'Agent assignment');
      assert.equal(list.body.rows[0].description, undefined);
      assert.equal(
        (
          await call(
            agent.cookie,
            '/helpdesk/my-work?list=1&sort=Request&q=Outside',
            undefined,
            scope.workspaceId,
          )
        ).body.total,
        0,
      );
      await db
        .collection('helpdeskMembers')
        .updateOne({ workspaceId: scope.workspaceId, userId: actor }, { $set: { role: 'user' } });
      assert.equal(
        (await call(agent.cookie, '/helpdesk/my-work?summary=1', undefined, scope.workspaceId))
          .status,
        403,
      );
      await call(admin.cookie, '/auth/impersonation', {
        workspaceId: scope.workspaceId,
        role: 'read-only',
      });
      assert.equal(
        (await call(admin.cookie, '/helpdesk/my-work?summary=1', undefined, scope.workspaceId))
          .status,
        403,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await db.dropDatabase();
      await client.close();
    }
  },
);
