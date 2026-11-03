import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createApi } from '../src/app.js';
import { createInvitationDelivery } from '../src/invitations.js';
import { decryptSecret } from '../src/secrets.js';
test(
  'workspace invitations email a private single-use grant and require matching authenticated acceptance',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_invites_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const cleanup = new MongoClient(process.env.MONGODB_URI);
    await cleanup.connect();
    const db = cleanup.db(database);
    const store = { collection: (name) => db.collection(name) };
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
        email: 'admin@invites.test',
        password: 'Fictional-invites-password!',
      });
      const workspace = admin.body.user.workspaceId;
      const smtp = await call(
        admin.cookie,
        '/helpdesk/smtp',
        'PUT',
        {
          host: 'smtp.fixture.test',
          port: 587,
          from: 'invites@fixture.test',
          username: 'fixture',
          password: 'fictional-mail-secret',
          version: 0,
        },
        workspace,
      );
      assert.equal(smtp.status, 200);
      const smtpMetadata = await call(admin.cookie, '/helpdesk/smtp', 'GET', undefined, workspace);
      assert.equal(smtpMetadata.body.password, undefined);
      assert.equal(smtpMetadata.body.hasPassword, true);
      const smtpRecord = await db.collection('smtpSettings').findOne({ workspaceId: workspace });
      assert.ok(!JSON.stringify(smtpRecord).includes('fictional-mail-secret'));

      const invited = await call(
        admin.cookie,
        '/helpdesk/invitations',
        'POST',
        {
          email: 'new@invites.test',
          role: 'read-only',
          queues: [],
          canApprove: false,
          active: true,
        },
        workspace,
      );
      assert.equal(invited.status, 202);
      assert.equal(invited.body.token, undefined);
      assert.equal(await db.collection('users').countDocuments({ email: 'new@invites.test' }), 0);
      const row = await db
        .collection('workspaceInvitations')
        .findOne({ email: 'new@invites.test' });
      const message = JSON.parse(decryptSecret(row.message));
      const token = message.text.match(/#([a-f0-9]{64})/)[1];
      let sends = 0;
      const deliver = createInvitationDelivery(store, async (mail) => {
        sends++;
        assert.equal(mail.to, 'new@invites.test');
        assert.ok(mail.text.includes(token));
      });
      await deliver();
      await deliver();
      assert.equal(sends, 1);
      assert.equal(
        (await call(admin.cookie, '/helpdesk/invitations/accept', 'POST', { token })).status,
        403,
      );
      const employee = await call(null, '/auth/register', 'POST', {
        email: 'new@invites.test',
        password: 'Fictional-invites-password!',
      });
      assert.equal(
        (await call(employee.cookie, '/helpdesk/access', 'GET', undefined, workspace)).status,
        403,
      );
      const accepted = await call(employee.cookie, '/helpdesk/invitations/accept', 'POST', {
        token,
      });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.body.workspaceId, workspace);
      assert.equal(
        (await call(employee.cookie, '/helpdesk/access', 'GET', undefined, workspace)).body.role,
        'read-only',
      );
      assert.equal(
        (await call(employee.cookie, '/helpdesk/requests', 'POST', {}, workspace)).status,
        403,
      );
      assert.equal(
        (await call(employee.cookie, '/helpdesk/invitations/accept', 'POST', { token })).status,
        200,
      );
      assert.equal(
        await db
          .collection('helpdeskMembers')
          .countDocuments({ workspaceId: workspace, userId: employee.body.user.id }),
        1,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await db.dropDatabase();
      await cleanup.close();
    }
  },
);
