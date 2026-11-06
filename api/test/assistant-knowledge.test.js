import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import {
  retrieveAssistantKnowledge,
  verifyAssistantKnowledge,
} from '../src/knowledge/assistantKnowledge.js';

test(
  'assistants retrieve published Slack guidance, isolate owners and reject changed or unpublished knowledge',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    await client.connect();
    const db = client.db(`agentzuno_assistant_knowledge_${randomUUID().replaceAll('-', '')}`);
    const store = { collection: (name) => db.collection(name), ready: async () => {} };
    const workspaceId = new ObjectId().toHexString();
    const chat = {
      ownerId: 'owner',
      workspaceId,
      messages: [{ role: 'user', text: 'how can I request slack?' }],
    };
    try {
      await db
        .collection('users')
        .insertOne({ id: 'owner', workspaceId, email: 'owner@fixture.test' });
      await db.collection('articles').insertMany([
        {
          ownerId: 'owner',
          title: 'Request Slack',
          body: '<p>Open the software request form.</p>',
          status: 'Published',
          updatedAt: new Date(),
        },
        {
          ownerId: 'owner',
          title: 'Slack draft',
          body: 'Unapproved instructions',
          status: 'Draft',
        },
        { ownerId: 'other', title: 'Slack private', body: 'Private policy', status: 'Published' },
      ]);
      const found = await retrieveAssistantKnowledge(store, chat);
      assert.equal(found.length, 1);
      assert.equal(found[0].text, 'Open the software request form.');
      await verifyAssistantKnowledge(store, chat, found);
      assert.equal(
        (await retrieveAssistantKnowledge(store, { ...chat, helpdeskPurpose: 'email-support' }))
          .length,
        0,
      );
      await db
        .collection('articles')
        .updateOne({ _id: found[0].id }, { $set: { body: '<p>Use the updated catalog.</p>' } });
      await assert.rejects(verifyAssistantKnowledge(store, chat, found));
      assert.equal(
        (await retrieveAssistantKnowledge(store, chat))[0].text,
        'Use the updated catalog.',
      );
      await db
        .collection('articles')
        .updateOne({ _id: found[0].id }, { $set: { status: 'Draft' } });
      assert.equal((await retrieveAssistantKnowledge(store, chat)).length, 0);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
