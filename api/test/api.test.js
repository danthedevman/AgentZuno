import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createApiServer } from '../src/app.js';

async function withServer(run) {
  const server = createApiServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
test('workspace APIs require authentication and demo credentials never create sessions', async () => {
  await withServer(async (origin) => {
    for (const path of [
      '/api/workspace',
      '/api/explore',
      '/api/auth/demo-accounts',
      '/api/me/workspace',
      '/api/articles',
      '/api/files',
      '/api/images',
      '/api/agents',
      '/api/knowledge-bases',
      '/api/integration-catalog',
      '/api/helpdesk/requests',
    ])
      assert.equal((await fetch(origin + path)).status, 401, path);
    const demo = await fetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex@demo.agentzuno.test', password: 'ExploreAgentZuno!' }),
    });
    assert.equal(demo.status, 401);
    assert.equal(demo.headers.get('set-cookie'), null);
    assert.equal((await fetch(origin + '/api/site')).status, 200);
    const demoFixture = await (await fetch(origin + '/api/demo')).json();
    assert.equal(demoFixture.name, 'Northstar Demo');
    assert.ok(demoFixture.prompts.every((prompt) => typeof prompt.reply === 'string'));
    assert.equal(
      (
        await fetch(origin + '/api/demo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      405,
    );
    assert.deepEqual(await (await fetch(origin + '/api/auth/session')).json(), { user: null });
    for (const path of [
      '/mock-data/private/alex.json',
      '/private/users.json',
      '/src/app.js',
      '/package.json',
    ])
      assert.equal((await fetch(origin + path)).status, 404);
  });
});
test(
  'registered sessions isolate workspace records and logout removes access',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_auth_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
      await withServer(async (origin) => {
        async function register(email, name) {
          const response = await fetch(origin + '/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: 'Fictional-account-password!', name }),
          });
          assert.equal(response.status, 201);
          assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
          return {
            cookie: response.headers.get('set-cookie').split(';')[0],
            user: (await response.json()).user,
          };
        }
        const alex = await register('alex@accounts.test', '  Alex Test  ');
        assert.equal(alex.user.name, 'Alex Test');
        assert.equal(
          (await client.db(database).collection('users').findOne({ id: alex.user.id })).name,
          'Alex Test',
        );
        const jordan = await register('jordan@accounts.test');
        for (const [account, other] of [
          [alex, jordan],
          [jordan, alex],
        ]) {
          const headers = { Cookie: account.cookie };
          const workspace = await (await fetch(origin + '/api/workspace', { headers })).json();
          assert.equal(workspace.mode, 'personal');
          assert.equal(workspace.id, account.user.workspaceId);
          assert.deepEqual(workspace.articles, []);
          assert.equal(
            (await fetch(origin + `/api/workspaces/${other.user.workspaceId}`, { headers })).status,
            403,
          );
          assert.equal((await fetch(origin + '/api/explore', { headers })).status, 404);
          const catalog = await (
            await fetch(origin + '/api/integration-catalog', { headers })
          ).json();
          assert.deepEqual(
            catalog.map((item) => item.id),
            ['custom'],
          );
          const session = await (await fetch(origin + '/api/auth/session', { headers })).json();
          assert.equal(session.user.id, account.user.id);
          assert.ok(!JSON.stringify(session).includes('passwordHash'));
        }
        await fetch(origin + '/api/auth/logout', {
          method: 'POST',
          headers: { Cookie: alex.cookie },
        });
        assert.equal(
          (await fetch(origin + '/api/workspace', { headers: { Cookie: alex.cookie } })).status,
          401,
        );
        assert.equal(
          (await fetch(origin + '/api/workspace', { headers: { Cookie: jordan.cookie } })).status,
          200,
        );
      });
    } finally {
      await client.db(database).dropDatabase();
      await client.close();
    }
  },
);
test('invalid login and forged sessions deny access; browser writes reject untrusted origins', async () => {
  await withServer(async (origin) => {
    const response = await fetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@fixture.test', password: 'wrong' }),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(origin + '/api/workspace', { method: 'POST' })).status, 405);
    assert.deepEqual(
      await (
        await fetch(origin + '/api/auth/session', {
          headers: { Cookie: 'agentzuno_session=forged' },
        })
      ).json(),
      { user: null },
    );
    assert.equal(
      (
        await fetch(origin + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
          body: '{}',
        })
      ).status,
      403,
    );
  });
});
