import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createChatService } from '../src/chat.js';

const uri = process.env.TEST_MONGODB_URI;
test(
  'chat preserves queued input, isolates owners and applies encrypted provider instructions and limits',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_chat_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const user = { id: 'owner', workspaceId: new ObjectId().toHexString(), role: 'admin' };
    const pending = [];
    const service = createChatService(
      store,
      async (job) => pending.push(job),
      async (url, options) => {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(options.headers.Authorization, 'Bearer fixture-provider-key');
        assert.equal(options.redirect, 'error');
        const body = JSON.parse(options.body);
        assert.ok(body.instructions.includes('Be concise.'));
        assert.ok(
          body.instructions.includes(`[My Requests](/workspace/${user.workspaceId}/requests)`),
        );
        assert.ok(
          body.instructions.includes('Do not volunteer explanations about missing articles'),
        );
        assert.ok(!JSON.stringify(body.input).includes('Keep these instructions private'));
        assert.ok(body.instructions.includes('Fixture attachment content for this conversation.'));
        assert.ok(body.instructions.includes('Submit the software catalog form for Slack.'));
        assert.ok(!body.instructions.includes('Other owner private guidance'));
        assert.ok(!body.instructions.includes('Unpublished Slack guidance'));
        assert.ok(body.instructions.includes('You are Zuno, the employee support agent.'));
        assert.equal(body.max_output_tokens, 4096);
        assert.equal(body.store, false);
        assert.equal(JSON.stringify(body).includes('fixture-provider-key'), false);
        return new Response(
          JSON.stringify({
            output: [{ content: [{ type: 'output_text', text: 'A useful answer.' }] }],
          }),
        );
      },
    );
    try {
      await store.ready();
      await store
        .collection('users')
        .insertOne({ id: user.id, workspaceId: user.workspaceId, email: 'owner@fixture.test' });
      await store.collection('articles').insertMany([
        {
          ownerId: user.id,
          title: 'Slack access',
          body: '<p>Submit the software catalog form for Slack.</p>',
          status: 'Published',
        },
        {
          ownerId: 'other',
          title: 'Slack private',
          body: 'Other owner private guidance',
          status: 'Published',
        },
        {
          ownerId: user.id,
          title: 'Slack draft',
          body: 'Unpublished Slack guidance',
          status: 'Draft',
        },
      ]);
      const file = await store.collection('chatAttachments').insertOne({
        ownerId: user.id,
        workspaceId: user.workspaceId,
        name: 'request.txt',
        size: 49,
        text: 'Fixture attachment content for this conversation.',
        expiresAt: new Date(Date.now() + 60000),
      });
      const foreignFile = await store.collection('chatAttachments').insertOne({
        ownerId: 'other',
        workspaceId: user.workspaceId,
        name: 'private.txt',
        text: 'Private attachment',
      });
      await assert.rejects(
        service.create(user, {
          text: 'Read this',
          requestId: randomUUID(),
          attachmentIds: [foreignFile.insertedId.toHexString()],
        }),
        { status: 403 },
      );
      const input = {
        text: 'How can I request Slack?',
        requestId: randomUUID(),
        attachmentIds: [file.insertedId.toHexString()],
      };
      const created = await service.create(user, input);
      assert.equal(created.status, 'queued');
      assert.equal(created.messages[0].attachments[0].name, 'request.txt');
      assert.equal(created.messages[0].attachments[0].text, undefined);
      assert.equal(
        (await store.collection('chatAttachments').findOne({ _id: file.insertedId })).expiresAt,
        undefined,
      );
      assert.equal((await service.create(user, input)).id, created.id);
      assert.equal(pending.length, 1);
      await assert.rejects(service.get({ ...user, id: 'other' }, created.id), { status: 404 });
      await assert.rejects(service.send(user, created.id, { text: 'Concurrent message' }), {
        status: 409,
      });
      await service.process(pending.shift());
      const failed = await service.get(user, created.id);
      assert.equal(failed.status, 'failed');
      assert.equal(failed.messages[0].text, input.text);
      const config = {
        provider: 'openai',
        model: 'gpt-6.1-sol',
        instructions: 'Be concise.',
        maxOutputTokens: 4096,
        reasoning: 'medium',
        enabled: true,
        isDefault: true,
        apiKey: 'fixture-provider-key',
      };
      await assert.rejects(service.ai.save(user, { ...config, model: 'untrusted-model' }), {
        status: 400,
      });
      await service.ai.save(user, config);
      const safe = await service.ai.settings(user);
      assert.equal(safe.providers[0].hasApiKey, true);
      assert.equal(JSON.stringify(safe).includes('fixture-provider-key'), false);
      assert.equal((await service.ai.settings({ ...user, id: 'other' })).providers.length, 0);
      const stored = await store.collection('aiProviders').findOne({ ownerId: user.id });
      assert.notEqual(stored.credential, config.apiKey);
      await service.send(user, created.id, { retry: true });
      await service.process(pending.shift());
      const complete = await service.get(user, created.id);
      assert.equal(complete.status, 'complete');
      assert.ok(
        complete.messages[1].progress.some((event) => event.phase === 'reading-attachments'),
      );
      assert.ok(complete.messages[1].progress.some((event) => event.phase === 'generating'));
      assert.equal(complete.messages.length, 2);
      assert.equal(complete.messages[1].text, 'A useful answer.');
      await service.ai.save(user, { ...config, apiKey: '', isDefault: false });
      assert.equal((await service.ai.settings(user)).defaultProvider, null);
      assert.equal((await service.ai.settings(user)).providers[0].hasApiKey, true);
      await service.ai.save(user, { ...config, apiKey: '', enabled: false });
      await service.send(user, created.id, { text: 'Another question' });
      await service.process(pending.shift());
      assert.equal((await service.get(user, created.id)).status, 'failed');
    } finally {
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
