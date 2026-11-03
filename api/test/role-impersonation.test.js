import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createApi } from '../src/app.js';
const uri = process.env.TEST_MONGODB_URI;
test(
  'only real Admins can impersonate roles; effective permissions and audits apply without changing membership',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_impersonation_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const cleanup = new MongoClient(uri);
    const app = createApi();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(cookie, path, method = 'GET', body, workspace, role) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { cookie } : {}),
          ...(workspace ? { 'X-Workspace-Id': workspace } : {}),
          ...(role ? { 'X-Helpdesk-Role': role } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    }
    try {
      const admin = await call(null, '/auth/register', 'POST', {
        email: 'admin@impersonation.test',
        password: 'Fictional-impersonation-password!',
      });
      const user = await call(null, '/auth/register', 'POST', {
        email: 'user@impersonation.test',
        password: 'Fictional-impersonation-password!',
      });
      const workspace = admin.body.user.workspaceId;
      assert.equal(
        (
          await call(
            admin.cookie,
            '/helpdesk/members',
            'POST',
            {
              email: 'user@impersonation.test',
              role: 'user',
              active: true,
              queues: [],
              canApprove: false,
            },
            workspace,
          )
        ).status,
        201,
      );
      await call(
        user.cookie,
        '/helpdesk/requests',
        'POST',
        { requestId: randomUUID(), title: 'Employee private request', text: 'Help please' },
        workspace,
      );
      const access = await call(
        admin.cookie,
        '/helpdesk/access',
        'GET',
        undefined,
        workspace,
        'user',
      );
      assert.equal(access.body.role, 'user');
      assert.equal(access.body.actualRole, 'admin');
      assert.equal(access.body.canImpersonate, true);
      assert.equal(access.body.canApprove, false);
      assert.deepEqual(
        (await call(admin.cookie, '/helpdesk/requests', 'GET', undefined, workspace, 'user')).body,
        [],
      );
      assert.equal(
        (await call(admin.cookie, '/helpdesk/workflows', 'POST', {}, workspace, 'user')).status,
        403,
      );
      assert.equal(
        (await call(admin.cookie, '/settings/ai', 'GET', undefined, workspace, 'user')).status,
        403,
      );
      assert.equal(
        (await call(admin.cookie, '/helpdesk/members', 'GET', undefined, workspace, 'agent'))
          .status,
        403,
      );
      assert.equal(
        (await call(user.cookie, '/helpdesk/access', 'GET', undefined, workspace, 'admin')).status,
        403,
      );
      assert.equal(
        (await call(user.cookie, '/helpdesk/access', 'GET', undefined, workspace, 'user')).status,
        403,
      );
      assert.equal(
        (await call(admin.cookie, '/helpdesk/access', 'GET', undefined, workspace, 'root')).status,
        400,
      );
      assert.equal(
        (await call(admin.cookie, '/helpdesk/requests', 'GET', undefined, workspace)).body.length,
        1,
      );
      assert.equal(
        (
          await call(admin.cookie, '/auth/impersonation', 'POST', {
            workspaceId: workspace,
            role: 'user',
          })
        ).status,
        200,
      );
      // A second tab uses the same cookie without any role header.
      assert.equal((await call(admin.cookie, '/helpdesk/access')).body.role, 'user');
      assert.equal(
        (await call(admin.cookie, '/helpdesk/workflows', 'GET', undefined, workspace)).status,
        403,
      );
      assert.equal(
        (await call(admin.cookie, '/helpdesk/members', 'GET', undefined, workspace, 'admin'))
          .status,
        403,
      );
      assert.equal((await call(admin.cookie, '/settings/ai')).status, 403);
      assert.equal(
        (await call(admin.cookie, '/helpdesk/access', 'GET', undefined, user.body.user.workspaceId))
          .status,
        403,
      );
      assert.equal(
        (
          await call(user.cookie, '/auth/impersonation', 'POST', {
            workspaceId: workspace,
            role: 'admin',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call(admin.cookie, '/auth/impersonation', 'POST', {
            workspaceId: workspace,
            role: 'admin',
          })
        ).status,
        200,
      );
      assert.equal(
        (await call(admin.cookie, '/helpdesk/access', 'GET', undefined, workspace)).body.role,
        'admin',
      );
      assert.equal(
        (await call(admin.cookie, '/helpdesk/members', 'GET', undefined, workspace)).status,
        200,
      );
      assert.equal(
        (
          await call(admin.cookie, '/auth/impersonation', 'POST', {
            workspaceId: workspace,
            role: 'read-only',
          })
        ).status,
        200,
      );
      assert.equal((await call(admin.cookie, '/helpdesk/access')).body.role, 'read-only');
      assert.equal((await call(admin.cookie, '/auth/preferences')).body.listPageSize, 20);
      assert.equal(
        (await call(admin.cookie, '/auth/preferences', 'PUT', { listPageSize: 50 })).status,
        200,
      );
      assert.equal((await call(admin.cookie, '/auth/preferences')).body.listPageSize, 50);
      assert.equal((await call(user.cookie, '/auth/preferences')).body.listPageSize, 20);
      assert.equal(
        (await call(admin.cookie, '/helpdesk/members', 'GET', undefined, workspace)).status,
        200,
      );
      assert.equal(
        (await call(admin.cookie, '/helpdesk/settings', 'PUT', {}, workspace)).status,
        403,
      );
      assert.equal((await call(admin.cookie, '/articles', 'POST', {}, workspace)).status, 403);
      assert.equal(
        (
          await call(admin.cookie, '/auth/impersonation', 'POST', {
            workspaceId: workspace,
            role: 'admin',
          })
        ).status,
        200,
      );
      await cleanup.connect();
      assert.equal(
        (
          await cleanup
            .db(database)
            .collection('helpdeskMembers')
            .findOne({ workspaceId: workspace, userId: admin.body.user.id })
        ).role,
        'admin',
      );
      assert.ok(
        await cleanup.db(database).collection('governanceAudit').findOne({
          workspaceId: workspace,
          isImpersonating: true,
          role: 'user',
          actualRole: 'admin',
        }),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
