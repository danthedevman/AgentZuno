import { encryptSecret } from '../src/secrets.js';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { sourceClient } from '../src/connectors/index.js';
import { installConnectionOAuthRoutes } from '../src/connectionOAuth.js';

test('adapter credentials use provider-specific headers and fixed HTTPS hosts', async () => {
  const cases = [
    ['notion', { authType: 'api-key' }, 'Bearer fixture-secret'],
    [
      'zendesk',
      { tenant: 'example', authType: 'api-key', username: 'reader@example.test' },
      `Basic ${Buffer.from('reader@example.test/token:fixture-secret').toString('base64')}`,
    ],
    [
      'confluence',
      { tenant: 'example', authType: 'basic', username: 'reader@example.test' },
      `Basic ${Buffer.from('reader@example.test:fixture-secret').toString('base64')}`,
    ],
  ];
  for (const [provider, config, expected] of cases) {
    const client = sourceClient(provider, config, 'fixture-secret', async (url, options) => {
      assert.equal(url.protocol, 'https:');
      assert.equal(options.headers.Authorization, expected);
      assert.equal(options.redirect, 'error');
      return new Response(
        JSON.stringify(
          provider === 'zendesk'
            ? { user: { id: 1, name: 'Reader' } }
            : provider === 'confluence'
              ? { accountId: '1', displayName: 'Reader' }
              : { id: '1', name: 'Reader' },
        ),
      );
    });
    assert.ok((await client.principal()).id);
  }
  assert.throws(() => sourceClient('zendesk', { tenant: 'localhost/attack' }, 'secret'));
  assert.throws(() =>
    sourceClient('confluence', { authType: 'basic', tenant: 'example.test@localhost' }, 'secret'),
  );
});

test('source OAuth requires owner, browser-bound state, expiry and single-use callback', async () => {
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const flows = [];
  let exchanges = 0;
  let saves = 0;
  const store = {
    ready: async () => {},
    collection: () => ({
      findOne: async () => ({
        clientId: 'fixture-client',
        clientSecret: encryptSecret('fixture-client-secret'),
      }),
      insertOne: async (flow) => flows.push(flow),
      findOneAndDelete: async (query) => {
        const index = flows.findIndex(
          (flow) =>
            flow.stateHash === query.stateHash &&
            flow.browserHash === query.browserHash &&
            flow.ownerId === query.ownerId &&
            flow.workspaceId === query.workspaceId &&
            flow.expiresAt > query.expiresAt.$gt,
        );
        return index < 0 ? null : flows.splice(index, 1)[0];
      },
    }),
  };
  const app = express();
  app.use(express.json());
  app.use((request, response, next) => {
    request.user = request.headers['x-test-owner']
      ? { id: request.headers['x-test-owner'], workspaceId: 'workspace' }
      : null;
    next();
  });
  installConnectionOAuthRoutes(
    app,
    store,
    {
      validateOAuthInput: async (user, input) => {
        assert.equal(input.permissionMode, 'managed');
      },
      connect: async (user, input) => {
        assert.equal(user.id, 'owner');
        assert.equal(input.accessToken, 'fixture-access');
        assert.equal(input.acceptManagedAccess, true);
        saves++;
      },
    },
    async (url, options) => {
      exchanges++;
      assert.equal(url, 'https://api.notion.com/v1/oauth/token');
      assert.equal(options.redirect, 'error');
      assert.equal(
        JSON.parse(options.body).redirect_uri,
        'http://localhost:3000/api/connections/oauth/callback',
      );
      return new Response(JSON.stringify({ access_token: 'fixture-access' }));
    },
  );
  app.use((error, request, response, next) =>
    response.status(error.status || 500).json({ error: error.publicMessage || 'Failure' }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const start = (owner = 'owner') =>
    fetch(base + '/api/connections/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-owner': owner },
      body: JSON.stringify({
        provider: 'notion',
        knowledgeBaseId: 'kb',
        permissionMode: 'managed',
        connectionId: 'fixture-legacy-connection',
      }),
    });
  try {
    assert.equal((await start('')).status, 401);
    const started = await start();
    assert.equal(started.status, 200);
    const cookie = started.headers.get('set-cookie').split(';')[0];
    assert.match(started.headers.get('set-cookie'), /HttpOnly/);
    const { url } = await started.json();
    assert.equal(new URL(url).origin, 'https://api.notion.com');
    assert.ok(!url.includes('fixture-client-secret'));
    const callback = `${base}/api/connections/oauth/callback?state=${new URL(url).searchParams.get('state')}&code=fixture-code`;
    assert.equal((await fetch(callback, { headers: { 'x-test-owner': 'owner' } })).status, 401);
    assert.equal(
      (await fetch(callback, { headers: { 'x-test-owner': 'other', Cookie: cookie } })).status,
      401,
    );
    assert.equal(exchanges, 0);
    const complete = await fetch(callback, {
      headers: { 'x-test-owner': 'owner', Cookie: cookie },
      redirect: 'manual',
    });
    assert.equal(complete.status, 302);
    assert.equal(complete.headers.get('location'), '/workspace/workspace/integrations/notion');
    assert.equal(saves, 1);
    assert.equal(
      (await fetch(callback, { headers: { 'x-test-owner': 'owner', Cookie: cookie } })).status,
      401,
    );
    assert.equal(exchanges, 1);
    const expired = await start();
    const expiredUrl = new URL((await expired.json()).url);
    flows[0].expiresAt = new Date(0);
    assert.equal(
      (
        await fetch(
          `${base}/api/connections/oauth/callback?state=${expiredUrl.searchParams.get('state')}&code=code`,
          {
            headers: {
              'x-test-owner': 'owner',
              Cookie: expired.headers.get('set-cookie').split(';')[0],
            },
          },
        )
      ).status,
      401,
    );
    assert.equal(saves, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
