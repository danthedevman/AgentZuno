import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { MongoClient, ObjectId } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createChatService } from '../src/chat.js';
import { createHelpdeskTeams, authorizeTeamsChat } from '../src/helpdeskTeams.js';
import { saveChannelApplication } from '../src/channelApplications.js';
import { saveConnectorActions } from '../src/connectorActions.js';

async function verify(database) {
  const oldKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = createIntegrationStore(database),
    owner = {
      id: String(new ObjectId()),
      workspaceId: String(new ObjectId()),
      role: 'admin',
      email: 'admin@example.test',
    },
    employee = {
      id: String(new ObjectId()),
      workspaceId: String(new ObjectId()),
      name: 'Employee',
      email: 'employee@example.test',
    };
  const scope = { ownerId: owner.id, workspaceId: owner.workspaceId };
  const clientId = randomUUID(),
    tenantId = randomUUID(),
    aadObjectId = randomUUID();
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const key = { ...(await exportJWK(publicKey)), kid: 'teams-test-key', endorsements: ['msteams'] };
  let sends = 0,
    modelCalls = 0,
    uncertain = false;
  const pending = [];
  const fetcher = async (url, options = {}) => {
    if (url === 'https://login.botframework.com/v1/.well-known/openidconfiguration')
      return Response.json({
        issuer: 'https://api.botframework.com',
        jwks_uri: 'https://login.botframework.com/v1/.well-known/keys',
        id_token_signing_alg_values_supported: ['RS256'],
      });
    if (url === 'https://login.botframework.com/v1/.well-known/keys')
      return Response.json({ keys: [key] });
    if (url === `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`)
      return Response.json({ access_token: 'fictional-token' });
    if (url === 'https://api.openai.com/v1/responses') {
      modelCalls++;
      const body = JSON.parse(options.body);
      assert.ok(!body.tools.some((tool) => tool.name === 'createGroup'));
      return Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: 'Choose Company Wi-Fi and sign in with your work account.',
              },
            ],
          },
        ],
      });
    }
    assert.ok(url.startsWith('https://smba.trafficmanager.net/amer/v3/conversations/'));
    sends++;
    if (uncertain) throw new Error('Simulated connection interruption after sending');
    return Response.json({ id: 'reply-' + sends });
  };
  const chats = createChatService(store, async (job) => pending.push(job), fetcher);
  const teams = createHelpdeskTeams(store, chats, async () => {}, fetcher);
  let source;
  const activity = (id = 'message-1', personal = true) => ({
    type: 'message',
    id,
    channelId: 'msteams',
    serviceUrl: 'https://smba.trafficmanager.net/amer/',
    channelData: { tenant: { id: tenantId } },
    conversation: { id: 'conversation-1', conversationType: personal ? 'personal' : 'channel' },
    from: { id: '29:employee', aadObjectId },
    recipient: { id: '28:bot' },
    text: '<at>AgentZuno</at> How do I connect to Wi-Fi?',
  });
  async function signed(body, aud = clientId, expires = 60) {
    return (
      'Bearer ' +
      (await new SignJWT({ serviceUrl: body.serviceUrl })
        .setProtectedHeader({ alg: 'RS256', kid: key.kid })
        .setIssuer('https://api.botframework.com')
        .setAudience(aud)
        .setNotBefore(Math.floor(Date.now() / 1000) - 1)
        .setExpirationTime(Math.floor(Date.now() / 1000) + expires)
        .sign(privateKey))
    );
  }
  try {
    await store.ready();
    await database.collection('users').insertMany([owner, employee]);
    await database.collection('helpdeskMembers').insertMany([
      { ...scope, userId: owner.id, email: owner.email, role: 'admin', active: true, queues: [] },
      {
        ...scope,
        userId: employee.id,
        email: employee.email,
        role: 'user',
        active: true,
        queues: [],
      },
    ]);
    await saveChannelApplication(store, owner, 'teams', {
      clientId,
      clientSecret: 'fictional-client-secret',
      signingSecret: '',
      version: 0,
    });
    await teams.configure(owner, {
      tenantId,
      enabled: true,
      identityBindings: [{ aadObjectId, userId: employee.id }],
      version: 0,
    });
    source = await database.collection('helpdeskTeamsBots').findOne(scope);
    await chats.ai.save(owner, {
      provider: 'openai',
      model: 'gpt-6.1-sol',
      instructions: '',
      maxOutputTokens: 4096,
      reasoning: 'medium',
      enabled: true,
      isDefault: true,
      apiKey: 'fictional-provider-key',
    });
    const first = activity();
    assert.equal(
      (await teams.receive(first, await signed(first), owner.workspaceId)).accepted,
      true,
    );
    await teams.receive(first, await signed(first), owner.workspaceId);
    assert.equal(await database.collection('helpdeskTeamsEvents').countDocuments(scope), 1);
    await teams.process(source);
    assert.equal(pending.length, 1);
    const chat = await database.collection('chats').findOne({ ...scope, ownerId: employee.id });
    assert.equal(chat.assistantType, 'support');
    assert.equal(chat.helpdeskPurpose, 'teams-support');
    await chats.process(pending.shift());
    const completed = await chats.get(
      { id: employee.id, workspaceId: owner.workspaceId },
      String(chat._id),
    );
    assert.equal(completed.status, 'complete', JSON.stringify(completed));
    await teams.process(source);
    assert.equal(sends, 1);
    await teams.process(source);
    assert.equal(sends, 1);
    assert.equal(
      await database.collection('helpdeskTeamsEvents').countDocuments({ ...scope, status: 'sent' }),
      1,
    );
    const channel = activity('channel-mention', false);
    await teams.receive(channel, await signed(channel), owner.workspaceId);
    await teams.process(source);
    assert.equal(sends, 2);
    assert.equal(modelCalls, 1);
    for (const [body, token] of [
      [first, ''],
      [first, await signed(first, randomUUID())],
      [first, await signed(first, clientId, -120)],
      [{ ...first, serviceUrl: 'https://127.0.0.1/' }, await signed(first)],
      [{ ...first, channelData: { tenant: { id: randomUUID() } } }, await signed(first)],
      [{ ...first, from: { ...first.from, aadObjectId: randomUUID() } }, await signed(first)],
    ])
      await assert.rejects(teams.receive(body, token, owner.workspaceId));
    const next = activity('uncertain-reply');
    await teams.receive(next, await signed(next), owner.workspaceId);
    await teams.process(source);
    await chats.process(pending.shift());
    uncertain = true;
    await teams.process(source);
    assert.equal(sends, 3);
    await teams.process(source);
    assert.equal(sends, 3);
    assert.equal(
      await database
        .collection('helpdeskTeamsEvents')
        .countDocuments({ ...scope, status: 'uncertain' }),
      1,
    );
    await saveConnectorActions(store, owner, 'teams', {
      version: 0,
      actions: { receiveMessages: false, respondToUsers: true },
    });
    await assert.rejects(teams.receive(first, await signed(first), owner.workspaceId), {
      status: 403,
    });
    await saveConnectorActions(store, owner, 'teams', {
      version: 1,
      actions: { receiveMessages: true, respondToUsers: true },
    });
    await teams.configure(owner, { tenantId, enabled: false, identityBindings: [], version: 1 });
    await assert.rejects(authorizeTeamsChat(store, chat), { status: 403 });
    await assert.rejects(teams.receive(first, await signed(first), owner.workspaceId), {
      status: 403,
    });
    await assert.rejects(
      teams.configure(
        { ...owner, role: 'user' },
        { tenantId, enabled: true, identityBindings: [], version: 2 },
      ),
      { status: 403 },
    );
  } finally {
    await store.close();
    if (oldKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = oldKey;
  }
}
test('Teams verifies signed activities, maps identities, isolates private replies and never retries uncertain sends', () =>
  verify(createMemoryDatabase()));
test(
  'Teams bot records and permission checks work on MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI),
      db = client.db('az_teams_' + new ObjectId());
    try {
      await verify(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
test(
  'Teams bot records and permission checks work on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(connection),
      name = 'az_teams_' + new ObjectId();
    await admin.query(`CREATE DATABASE ${name}`);
    const db = createPostgresDatabase({ ...connection, database: name });
    try {
      await verify(db);
    } finally {
      await db.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  },
);
