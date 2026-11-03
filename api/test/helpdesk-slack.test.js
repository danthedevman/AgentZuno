import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createChatService } from '../src/chat.js';
import {
  createHelpdeskSlack,
  verifySlackSignature,
  authorizeSlackChat,
} from '../src/helpdeskSlack.js';
import { encryptSecret } from '../src/secrets.js';
test('Slack signatures reject tampering, stale requests and missing verification', () => {
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const raw = Buffer.from('{"type":"url_verification","challenge":"fixture"}');
  const secret = 'fixture-signing-secret';
  const headers = {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:`).update(raw).digest('hex')}`,
  };
  verifySlackSignature(raw, headers, secret, now);
  assert.throws(() => verifySlackSignature(Buffer.from('{}'), headers, secret, now), {
    status: 401,
  });
  assert.throws(() => verifySlackSignature(raw, headers, secret, now + 301000), { status: 401 });
  assert.throws(() => verifySlackSignature(raw, {}, secret), { status: 401 });
});
test(
  'Slack bot deduplicates events, privately replies with linked user context, and denies revoked identities',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const uri = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_slack_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const jobs = [];
    const sent = [];
    const owner = {
      id: new ObjectId().toHexString(),
      workspaceId: new ObjectId().toHexString(),
      role: 'admin',
    };
    owner.helpdeskOwnerId = owner.id;
    const chats = createChatService(
      store,
      async (job) => jobs.push(job),
      async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.match(body.instructions, /Slack support conversation/);
        return Response.json({
          output: [{ content: [{ type: 'output_text', text: 'Try reconnecting your keyboard.' }] }],
        });
      },
    );
    const slack = createHelpdeskSlack(
      store,
      chats,
      async () => {},
      async (url, options) => {
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, 'Bearer fixture-bot-token');
        const body = JSON.parse(options.body);
        if (url.endsWith('conversations.info'))
          return Response.json({ ok: true, channel: { is_member: true } });
        sent.push({ url, body });
        return Response.json({ ok: true, ts: '1780000000.000001' });
      },
    );
    try {
      await store.ready();
      await store.collection('users').insertOne({ ...owner, email: 'owner@fixture.test' });
      await chats.ai.save(owner, {
        provider: 'openai',
        model: 'gpt-6.1-sol',
        enabled: true,
        isDefault: true,
        apiKey: 'fixture-key',
        instructions: '',
        maxOutputTokens: 1024,
        reasoning: 'medium',
      });
      const source = {
        ownerId: owner.id,
        workspaceId: owner.workspaceId,
        provider: 'slack',
        slackTeamId: 'T123TEAM',
        slackAppId: 'A123APP',
        slackBotUserId: 'U123BOT',
        slackScopeVersion: 1,
        slackGeneration: 'fixture-generation',
        credential: encryptSecret(JSON.stringify({ accessToken: 'fixture-bot-token' })),
        bot: {
          enabled: true,
          version: 1,
          identityBindings: [{ slackUserId: 'U123USER', userId: owner.id }],
        },
      };
      source._id = (await store.collection('helpdeskChannels').insertOne(source)).insertedId;
      await assert.rejects(
        slack.configure(
          { ...owner, role: 'user' },
          { enabled: true, version: 1, identityBindings: [] },
        ),
        { status: 403 },
      );
      await assert.rejects(
        slack.configure(owner, {
          enabled: true,
          version: 1,
          identityBindings: [{ slackUserId: 'U123USER', userId: 'foreign' }],
        }),
        { status: 400 },
      );
      const event = {
        type: 'event_callback',
        team_id: 'T123TEAM',
        api_app_id: 'A123APP',
        event_id: 'Ev123',
        event: {
          type: 'app_mention',
          user: 'U123USER',
          channel: 'C123CHANNEL',
          text: '<@U123BOT> My keyboard is not working',
          ts: '1780000000.000001',
        },
      };
      await slack.receive({ ...event, team_id: { $ne: null } });
      assert.equal(await store.collection('helpdeskSlackMessages').countDocuments({}), 0);
      await slack.receive(event);
      await slack.receive(event);
      assert.equal(await store.collection('helpdeskSlackMessages').countDocuments({}), 1);
      await slack.process(source);
      assert.equal(jobs.length, 1);
      const chat = await store.collection('chats').findOne({});
      assert.equal(chat.ownerId, owner.id);
      assert.equal(chat.channelUserId, owner.id);
      await chats.process(jobs.shift());
      await slack.process(source);
      await slack.process(source);
      assert.equal(sent.length, 1);
      assert.ok(sent[0].url.endsWith('chat.postEphemeral'));
      assert.equal(sent[0].body.user, 'U123USER');
      assert.equal(sent[0].body.mrkdwn, false);
      assert.equal(await store.collection('helpdeskRequests').countDocuments({}), 0);
      await slack.receive({
        ...event,
        event_id: 'Ev124',
        event: {
          ...event.event,
          ts: '1780000000.000002',
          thread_ts: event.event.ts,
          text: 'Thanks',
        },
      });
      await store
        .collection('helpdeskChannels')
        .updateOne({ _id: source._id }, { $set: { 'bot.identityBindings': [] } });
      await assert.rejects(authorizeSlackChat(store, chat), { status: 403 });
      await slack.process(source);
      assert.equal(jobs.length, 0);
      assert.equal(sent.length, 1);
      assert.equal(
        (
          await store
            .collection('helpdeskSlackMessages')
            .findOne({ 'event.ts': '1780000000.000002' })
        ).status,
        'access-denied',
      );
      await store
        .collection('helpdeskChannels')
        .updateOne({ _id: source._id }, { $set: { 'bot.enabled': false } });
      await slack.receive({
        ...event,
        event_id: 'Ev125',
        event: { ...event.event, ts: '1780000000.000003' },
      });
      assert.equal(await store.collection('helpdeskSlackMessages').countDocuments({}), 2);
    } finally {
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
