import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createSlackUserLinks } from '../src/channels/slackUserLinks.js';
import { createHelpdeskSlack } from '../src/channels/helpdeskSlack.js';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { encryptSecret } from '../src/shared/secrets.js';

async function verify(db) {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = createIntegrationStore(db),
    owner = {
      id: String(new ObjectId()),
      workspaceId: String(new ObjectId()),
      name: 'Owner',
      email: 'owner@fixture.test',
      role: 'admin',
    };
  owner.helpdeskOwnerId = owner.id;
  await store.ready();
  await db.collection('users').insertOne(owner);
  const people = {};
  for (const [name, email, role] of [
    ['Alice', 'alice@fixture.test', 'user'],
    ['Bob', 'bob@fixture.test', 'agent'],
    ['Audit', 'audit@fixture.test', 'read-only'],
    ['Other', 'other@fixture.test', 'user'],
  ]) {
    const person = { id: String(new ObjectId()), workspaceId: String(new ObjectId()), name, email };
    await db.collection('users').insertOne(person);
    if (name !== 'Other')
      await db.collection('helpdeskMembers').insertOne({
        ownerId: owner.id,
        workspaceId: owner.workspaceId,
        userId: person.id,
        active: true,
        role,
        queues: [],
        version: 1,
      });
    people[name] = { ...person, role, helpdeskOwnerId: owner.id, workspaceId: owner.workspaceId };
  }
  await db.collection('helpdeskChannelApplications').insertOne({
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    provider: 'slack',
    version: 1,
  });
  const source = {
    _id: new ObjectId(),
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    provider: 'slack',
    slackTeamId: 'T123TEAM',
    slackAppId: 'A123APP',
    slackBotUserId: 'U123BOT',
    slackGeneration: 'fixture-generation',
    slackScopeVersion: 1,
    slackGrantedScopes: ['users:read', 'users:read.email'],
    applicationVersion: 1,
    credential: encryptSecret(JSON.stringify({ accessToken: 'fixture-token' })),
    bot: { enabled: true, version: 1, identityBindings: [] },
  };
  await db.collection('helpdeskChannels').insertOne(source);
  const slack = createHelpdeskSlack(store, null);
  const fetcher = async (url, options) => {
    assert.equal(new URL(url).hostname, 'slack.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    return Response.json({
      ok: true,
      members: [
        { id: 'U123OWNER', real_name: 'Owner Slack', profile: { email: 'owner@fixture.test' } },
        { id: 'U123ALICE', real_name: 'Alice Slack', profile: { email: 'ALICE@fixture.test' } },
        { id: 'U123BOB', real_name: 'Bob Slack', profile: { email: 'bob@fixture.test' } },
        { id: 'U123UNKNOWN', real_name: 'Unknown', profile: { email: 'unknown@fixture.test' } },
        { id: 'U123GUEST', is_restricted: true, profile: { email: 'alice@fixture.test' } },
        { id: 'U123DELETED', deleted: true },
        { id: 'U123BOT', is_bot: true },
        { id: 'USLACKBOT', name: 'slackbot', is_bot: false },
      ],
      response_metadata: { next_cursor: '' },
    });
  };
  const service = createSlackUserLinks(store, slack.configure, fetcher);
  await assert.rejects(service.discover(people.Alice), { status: 403 });
  await assert.rejects(service.discover({ ...people.Audit, role: 'admin' }), { status: 403 });
  const review = await service.discover(owner);
  assert.equal(review.total, 4);
  assert.ok(!review.rows.some((row) => row.slackUserId === 'USLACKBOT'));
  await assert.rejects(
    service.apply(owner, {
      id: review.id,
      version: review.version,
      confirmed: true,
      bindings: [{ slackUserId: 'USLACKBOT', userId: owner.id }],
    }),
    { status: 400 },
  );
  assert.equal(
    (await service.page(owner, review.id, { selection: 'suggested' })).bindings.length,
    3,
  );
  assert.equal(review.rows.find((row) => row.slackUserId === 'U123ALICE').userId, people.Alice.id);
  assert.equal(
    (await db.collection('helpdeskChannels').findOne({ _id: source._id })).bot.identityBindings
      .length,
    0,
  );
  assert.ok(
    !JSON.stringify(await db.collection('slackLinkReviews').findOne({ _id: review.id })).includes(
      'alice@fixture.test',
    ),
  );
  await assert.rejects(service.page(owner, review.id, { search: { $ne: null } }), { status: 400 });
  assert.equal((await service.page(owner, review.id, { search: 'unknown' })).total, 1);
  await assert.rejects(
    service.apply(owner, { id: review.id, version: 1, confirmed: false, bindings: [] }),
    { status: 400 },
  );
  await assert.rejects(
    service.apply(owner, {
      id: review.id,
      version: 1,
      confirmed: true,
      bindings: [{ slackUserId: 'U123INJECTED', userId: people.Alice.id }],
    }),
    { status: 400 },
  );
  const applied = await service.apply(owner, {
    id: review.id,
    version: 1,
    confirmed: true,
    bindings: [
      { slackUserId: 'U123ALICE', userId: people.Alice.id },
      { slackUserId: 'U123OWNER', userId: owner.id },
    ],
  });
  assert.equal(applied.linked, 2);
  await assert.rejects(
    service.apply(owner, {
      id: review.id,
      version: 1,
      confirmed: true,
      bindings: [{ slackUserId: 'U123BOB', userId: people.Bob.id }],
    }),
    { status: 409 },
  );
  let current = await db.collection('helpdeskChannels').findOne({ _id: source._id });
  const url = await service.issue(current, 'U123BOB'),
    token = new URL(url).hash.slice(1);
  assert.ok(
    !JSON.stringify(await db.collection('slackSelfLinks').find({}).toArray()).includes(token),
  );
  await assert.rejects(service.inspect(people.Other, { token }), { status: 403 });
  await assert.rejects(service.inspect(people.Audit, { token }), { status: 403 });
  await assert.rejects(service.complete(people.Bob, { token, confirmed: false }), { status: 400 });
  assert.equal((await service.inspect(people.Bob, { token })).slackUserId, 'U123BOB');
  await service.complete(people.Bob, { token, confirmed: true });
  await assert.rejects(service.complete(people.Bob, { token, confirmed: true }), { status: 409 });
  current = await db.collection('helpdeskChannels').findOne({ _id: source._id });
  assert.equal(current.bot.identityBindings.length, 3);
  const membership = await db.collection('helpdeskMembers').findOne({ userId: people.Bob.id });
  assert.equal(membership.role, 'agent');
  assert.equal(membership.version, 1);
  const revoked = await service.issue(current, 'U123UNKNOWN'),
    revokedToken = new URL(revoked).hash.slice(1);
  await db
    .collection('helpdeskMembers')
    .updateOne({ userId: people.Bob.id }, { $set: { active: false } });
  await assert.rejects(service.complete(people.Bob, { token: revokedToken, confirmed: true }), {
    status: 403,
  });
  await db
    .collection('helpdeskChannels')
    .updateOne({ _id: source._id }, { $set: { slackGrantedScopes: [] } });
  await assert.rejects(service.discover(owner), { status: 409 });
  const deliveries = [];
  const bot = createHelpdeskSlack(
    store,
    {
      create() {
        throw new Error('Unmapped users must link before AI generation');
      },
    },
    async () => {},
    async (url, options) => {
      if (new URL(url).pathname.endsWith('conversations.info')) {
        assert.equal(options.method, 'GET');
        assert.equal(options.body, undefined);
        assert.equal(new URL(url).searchParams.get('channel'), 'D123DIRECT');
        return Response.json({ ok: true, channel: { is_im: true } });
      }
      deliveries.push(JSON.parse(options.body));
      return Response.json({ ok: true });
    },
  );
  await bot.receive(
    {
      type: 'event_callback',
      team_id: 'T123TEAM',
      api_app_id: 'A123APP',
      event_id: 'E123LINK',
      event: {
        type: 'message',
        channel: 'D123DIRECT',
        channel_type: 'im',
        user: 'U123UNLINKED',
        text: 'hello',
        ts: '1793910000.123456',
      },
    },
    owner.workspaceId,
  );
  await bot.process(current);
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].text, /slack\/link#[a-f0-9]{64}/);
  assert.equal(await db.collection('chats').countDocuments({}), 0);
  await store.close();
}
test('Slack reviewed matching and self-service links preserve roles and deny cross-workspace, replay and revoked access', async () =>
  verify(createMemoryDatabase()));
test(
  'Slack user linking persists safely with MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    await client.connect();
    const db = client.db('az_slack_links_' + new ObjectId());
    try {
      await verify(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
test(
  'Slack user linking persists safely with PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(connection),
      name = 'az_slack_links_' + new ObjectId();
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
