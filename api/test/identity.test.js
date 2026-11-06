import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { once } from 'node:events';
import { createApiServer } from '../src/server.js';

const uri = process.env.TEST_MONGODB_URI;
test(
  'identity settings are owner-only, encrypt secrets, and reject untrusted issuers and callbacks',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = 'agentzuno_identity_test_' + randomUUID().replaceAll('-', '');
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const server = createApiServer();
    const client = new MongoClient(uri);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function register(email) {
      const response = await fetch(origin + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'An-example-password-123' }),
      });
      assert.equal(response.status, 201);
      return {
        cookie: response.headers.get('set-cookie').split(';')[0],
        user: (await response.json()).user,
      };
    }
    try {
      const owner = await register('owner@example.test');
      const other = await register('other@example.test');
      const providers = await (
        await fetch(origin + '/api/identity-providers', { headers: { Cookie: owner.cookie } })
      ).json();
      assert.ok(providers.some((item) => item.id === 'entra'));
      assert.ok(providers.some((item) => item.id === 'okta'));
      assert.equal((await fetch(origin + '/api/settings/identity')).status, 401);
      const settings = {
        provider: 'okta',
        issuer: 'https://example.okta.com/oauth2/default',
        clientId: 'client-123',
        clientSecret: 'test-secret-not-for-real-use',
        enabled: false,
      };
      const save = (value, cookie = owner.cookie) =>
        fetch(origin + '/api/settings/identity', {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        });
      const response = await save(settings);
      assert.equal(response.status, 200);
      assert.ok(!JSON.stringify(await response.json()).includes(settings.clientSecret));
      const stored = await client
        .db(process.env.MONGODB_DATABASE)
        .collection('identitySettings')
        .findOne({ ownerId: owner.user.id });
      assert.ok(stored.clientSecret.ciphertext);
      assert.notEqual(stored.clientSecret.ciphertext, settings.clientSecret);
      assert.equal(
        (
          await (
            await fetch(origin + '/api/settings/identity', { headers: { Cookie: other.cookie } })
          ).json()
        ).settings,
        null,
      );
      assert.equal((await save({ ...settings, issuer: 'http://127.0.0.1:3001' })).status, 400);
      assert.equal(
        (await save({ ...settings, issuer: 'https://untrusted.example.test' })).status,
        400,
      );
      assert.equal((await save({ ...settings, clientSecret: '' })).status, 200);
      assert.equal(
        (await fetch(origin + '/api/auth/oidc/callback?state=forged&code=forged')).status,
        401,
      );
      assert.equal(
        (await fetch(origin + '/api/auth/oidc/start?workspace=' + owner.user.workspaceId)).status,
        404,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await client.db(process.env.MONGODB_DATABASE).dropDatabase();
      await client.close();
    }
  },
);
