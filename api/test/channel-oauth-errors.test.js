import test from 'node:test';
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ObjectId, MongoClient } from 'mongodb';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { encryptSecret } from '../src/shared/secrets.js';
import { createHelpdeskChannels } from '../src/channels/helpdeskChannels.js';

async function verify(database) {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = createIntegrationStore(database);
  const user = {
    id: new ObjectId().toHexString(),
    workspaceId: new ObjectId().toHexString(),
    role: 'admin',
  };
  user.helpdeskOwnerId = user.id;
  await store.ready();
  await store.collection('users').insertOne({ ...user, email: 'oauth@fixture.test' });
  await store.collection('helpdeskChannelApplications').insertOne({
    ownerId: user.id,
    workspaceId: user.workspaceId,
    provider: 'slack',
    clientId: 'fixture-client',
    clientSecret: encryptSecret('fixture-secret'),
    signingSecret: encryptSecret('fixture-signing-secret'),
    version: 1,
  });
  for (const [code, message] of [
    ['bad_client_secret', /rejected the Client Secret/],
    ['invalid_client_id', /rejected the Client ID/],
    ['invalid_code', /invalid or expired/],
    ['code_already_used', /already used/],
    ['bad_redirect_uri', /callback URL/],
    ['access_denied', /denied this installation/],
    ['unexpected-fixture-secret', /could not complete authorization/],
  ]) {
    let calls = 0;
    const service = createHelpdeskChannels(store, async () => {
      calls++;
      return Response.json({
        ok: false,
        error: code,
        error_description: 'fixture-secret must never be displayed',
        access_token: 'fixture-secret-token',
      });
    });
    const start = await service.start(user, { provider: 'slack' });
    const query = { state: new URL(start.url).searchParams.get('state'), code: 'fixture-code' };
    await assert.rejects(service.complete(user, query, start.browser), (error) => {
      assert.equal(error.status, 422);
      assert.match(error.publicMessage, message);
      assert.doesNotMatch(error.publicMessage, /fixture-secret/);
      return true;
    });
    await assert.rejects(service.complete(user, query, start.browser), { status: 401 });
    assert.equal(calls, 1);
    assert.equal(await store.collection('helpdeskChannels').countDocuments({}), 0);
  }
  await store.close();
}

test('Slack OAuth errors are actionable, bounded, secret-free and single-use in memory', async () => {
  await verify(createMemoryDatabase());
});
test(
  'Slack OAuth errors remain safe with MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    await client.connect();
    const database = client.db(`agentzuno_oauth_errors_${new ObjectId().toHexString()}`);
    try {
      await verify(database);
    } finally {
      await database.dropDatabase();
      await client.close();
    }
  },
);
test(
  'Slack OAuth errors remain safe with PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL);
    const admin = new pg.Pool(connection);
    const name = 'az_oauth_errors_' + new ObjectId().toHexString();
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
