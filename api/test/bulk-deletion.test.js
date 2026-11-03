import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createApi } from '../src/app.js';

test(
  'bulk deletion requires Admin confirmation and ownership; removes authored content and stops queued runs while preserving audits',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    process.env.MONGODB_DATABASE = `agentzuno_delete_${randomUUID().replaceAll('-', '')}`;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE);
    const app = createApi();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    async function call(cookie, path, body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    }
    try {
      const admin = await call(null, '/auth/register', {
        email: 'delete@fixture.test',
        password: 'Fictional-delete-password!',
      });
      const other = await call(null, '/auth/register', {
        email: 'other@fixture.test',
        password: 'Fictional-delete-password!',
      });
      const scope = { ownerId: admin.body.user.id, workspaceId: admin.body.user.workspaceId };
      const requestId = new ObjectId();
      const foreignId = new ObjectId();
      const articleId = new ObjectId();
      const attachmentId = new ObjectId();
      await db.collection('helpdeskRequests').insertMany([
        { _id: requestId, ...scope, requesterId: scope.ownerId, submissionState: 'submitted' },
        { _id: foreignId, ownerId: other.body.user.id, workspaceId: other.body.user.workspaceId },
      ]);
      await db
        .collection('workflowRuns')
        .insertOne({ ...scope, requestId: String(requestId), status: 'queued' });
      await db.collection('articles').insertOne({
        _id: articleId,
        ownerId: scope.ownerId,
        title: 'Delete me',
        status: 'Published',
        attachmentIds: [String(attachmentId)],
      });
      await db.collection('articleAttachments').insertOne({ _id: attachmentId, ...scope });
      const path = '/helpdesk/requests/bulk-delete';
      const payload = { ids: [String(requestId)], confirmed: true };
      assert.equal((await call(null, path, payload)).status, 401);
      assert.equal((await call(admin.cookie, path, { ids: payload.ids })).status, 400);
      assert.equal(
        (
          await call(admin.cookie, path, {
            ids: [String(requestId), String(foreignId)],
            confirmed: true,
          })
        ).status,
        404,
      );
      assert.ok(await db.collection('helpdeskRequests').findOne({ _id: requestId }));
      for (const role of ['agent', 'user', 'read-only']) {
        assert.equal(
          (
            await call(admin.cookie, '/auth/impersonation', {
              role,
              workspaceId: scope.workspaceId,
            })
          ).status,
          200,
        );
        assert.equal((await call(admin.cookie, path, payload)).status, 403);
      }
      await call(admin.cookie, '/auth/impersonation', {
        role: 'admin',
        workspaceId: scope.workspaceId,
      });
      await db
        .collection('workflowRuns')
        .updateOne({ requestId: String(requestId) }, { $set: { status: 'running' } });
      assert.equal((await call(admin.cookie, path, payload)).status, 409);
      await db
        .collection('workflowRuns')
        .updateOne({ requestId: String(requestId) }, { $set: { status: 'queued' } });
      const deleted = await call(admin.cookie, path, payload);
      assert.equal(deleted.status, 200);
      assert.equal(deleted.body.deletedCount, 1);
      assert.equal(await db.collection('helpdeskRequests').findOne({ _id: requestId }), null);
      assert.ok(await db.collection('helpdeskRequests').findOne({ _id: foreignId }));
      assert.equal(
        (await db.collection('workflowRuns').findOne({ requestId: String(requestId) })).status,
        'failed',
      );
      assert.equal(
        (
          await call(admin.cookie, '/helpdesk/articles/bulk-delete', {
            ids: [String(articleId)],
            confirmed: true,
          })
        ).status,
        200,
      );
      assert.equal(await db.collection('articles').findOne({ _id: articleId }), null);
      assert.equal(await db.collection('articleAttachments').findOne({ _id: attachmentId }), null);
      assert.ok(
        await db.collection('governanceAudit').findOne({
          action: 'articles.deleteOne',
          outcome: 'completed',
          resourceId: String(articleId),
        }),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await db.dropDatabase();
      await client.close();
    }
  },
);
