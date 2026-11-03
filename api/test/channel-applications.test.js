import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { ObjectId, MongoClient } from 'mongodb';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createHelpdeskChannels } from '../src/helpdeskChannels.js';
import {
  channelApplication,
  saveChannelApplication,
  slackSigningSecret,
  requireCurrentChannelApplication,
} from '../src/channelApplications.js';
import { verifySlackSignature } from '../src/helpdeskSlack.js';
test(
  'connector application settings are scoped, versioned, encrypted and usable without server restarts',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const uri = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_channel_apps_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    for (const prefix of ['SLACK', 'TEAMS', 'GMAIL', 'OUTLOOK']) {
      delete process.env[`${prefix}_CLIENT_ID`];
      delete process.env[`${prefix}_CLIENT_SECRET`];
    }
    delete process.env.SLACK_SIGNING_SECRET;
    const store = createIntegrationStore();
    const client = new MongoClient(uri);
    const admin = { id: 'owner', workspaceId: new ObjectId().toHexString(), role: 'admin' };
    const other = { id: 'other', workspaceId: new ObjectId().toHexString(), role: 'admin' };
    const service = createHelpdeskChannels(store, () => {
      throw new Error('Unexpected provider request');
    });
    try {
      await store.ready();
      const empty = await service.list(admin);
      assert.ok(
        empty.every(
          (item) => item.status === 'Not Configured' && item.deliveryStatus === 'Not Configured',
        ),
      );
      for (const provider of ['slack', 'gmail', 'teams', 'outlook']) {
        const input = {
          clientId: `fictional-${provider}-client`,
          clientSecret: `fictional-${provider}-secret`,
          signingSecret: provider === 'slack' ? 'fictional-signing-secret' : '',
          version: 0,
        };
        const saved = await saveChannelApplication(store, admin, provider, input);
        assert.equal(saved.hasClientSecret, true);
        assert.equal(saved.clientSecret, undefined);
        const record = await store
          .collection('helpdeskChannelApplications')
          .findOne({ ownerId: admin.id, workspaceId: admin.workspaceId, provider });
        assert.ok(record.clientSecret.ciphertext);
        assert.ok(!JSON.stringify(record).includes(input.clientSecret));
        assert.equal(
          (await channelApplication(store, admin, provider)).clientSecret,
          input.clientSecret,
        );
        assert.equal((await channelApplication(store, other, provider)).clientSecret, '');
        const authorization = await service.start(admin, { provider });
        assert.equal(new URL(authorization.url).searchParams.get('client_id'), input.clientId);
        assert.ok(!authorization.url.includes(input.clientSecret));
        await assert.rejects(
          saveChannelApplication(store, { ...admin, role: 'user' }, provider, input),
          { status: 403 },
        );
        await assert.rejects(saveChannelApplication(store, admin, provider, input), {
          status: 409,
        });
        const kept = await saveChannelApplication(store, admin, provider, {
          ...input,
          version: 1,
          clientSecret: '',
          signingSecret: '',
        });
        assert.equal(kept.version, 2);
        assert.equal(
          (await channelApplication(store, admin, provider)).clientSecret,
          input.clientSecret,
        );
        assert.equal(
          await store
            .collection('helpdeskChannelOAuth')
            .countDocuments({ ownerId: admin.id, workspaceId: admin.workspaceId, provider }),
          0,
        );
        await assert.rejects(
          requireCurrentChannelApplication(store, {
            ownerId: admin.id,
            workspaceId: admin.workspaceId,
            provider,
            applicationVersion: 1,
          }),
          { status: 403 },
        );
      }
      const visible = JSON.stringify(await service.list(admin));
      assert.ok(!visible.includes('fictional-slack-secret'));
      assert.ok(!visible.includes('fictional-signing-secret'));
      assert.ok(!visible.includes('ciphertext'));
      assert.equal(await slackSigningSecret(store, admin.workspaceId), 'fictional-signing-secret');
      assert.equal(await slackSigningSecret(store, other.workspaceId), '');
      assert.throws(() => verifySlackSignature(Buffer.from('{}'), {}, 'fictional-signing-secret'), {
        status: 401,
      });
      await assert.rejects(
        saveChannelApplication(store, admin, 'slack', {
          clientId: 'new-app',
          clientSecret: '',
          signingSecret: '',
          version: 2,
        }),
        { status: 400 },
      );
      await assert.rejects(
        saveChannelApplication(store, admin, 'slack', {
          clientId: 'x',
          clientSecret: 'secret with spaces',
          signingSecret: 'x',
          version: 2,
        }),
        { status: 400 },
      );
    } finally {
      await store.close();
      await client.db(database).dropDatabase();
      await client.close();
    }
  },
);
