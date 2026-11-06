import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createIntegrationService } from '../src/integrations/integrations.js';
import { createKnowledgeDestination } from '../src/integrations/knowledgeDestinations.js';

const uri = process.env.TEST_MONGODB_URI;
test(
  'source-name imports preserve grouping, remain owner-scoped and do not grant agents new bases',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_destinations_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const user = { id: 'owner', workspaceId: 'workspace' };
    const service = createIntegrationService(store, async () => ({
      knowledgeBases: [{ id: 'existing', name: 'Bundled' }],
    }));
    const documents = [
      {
        id: '1',
        title: 'Support policy',
        text: 'Policy text',
        knowledgeBase: { id: 'support', name: 'Support' },
      },
      {
        id: '2',
        title: 'Support guide',
        text: 'Guide text',
        knowledgeBase: { id: 'support', name: 'Support' },
      },
      {
        id: '3',
        title: 'Engineering',
        text: 'Engineering text',
        knowledgeBase: { id: 'engineering', name: 'Engineering' },
      },
    ];
    try {
      await store.ready();
      await assert.rejects(
        service.importExport(user, {
          provider: 'notion',
          destination: 'source',
          acceptManagedAccess: true,
          documents: [{ title: 'Missing base', text: 'No metadata' }],
        }),
        { status: 422 },
      );
      const imported = await service.importExport(user, {
        provider: 'notion',
        destination: 'source',
        acceptManagedAccess: true,
        documents,
      });
      assert.equal(imported.knowledgeBaseIds.length, 2);
      const bases = await store.collection('records').find({ ownerId: user.id }).toArray();
      assert.deepEqual(bases.map((base) => base.name).sort(), ['Engineering', 'Support']);
      const saved = await store
        .collection('knowledgeDocuments')
        .find({ connectionId: imported.id })
        .toArray();
      assert.equal(saved[0].knowledgeBaseId, saved[1].knowledgeBaseId);
      assert.notEqual(saved[0].knowledgeBaseId, saved[2].knowledgeBaseId);
      const connection = await store.connection(user.id, imported.id);
      const resolve = createKnowledgeDestination(store, connection);
      assert.equal(await resolve(documents[0]), saved[0].knowledgeBaseId);
      assert.equal(await store.collection('records').countDocuments({ ownerId: user.id }), 2);
      await assert.rejects(
        service.readDocument({ ...user, id: 'other' }, saved[0]._id.toHexString()),
        { status: 404 },
      );
      await assert.rejects(
        service.search(
          {
            user,
            agent: { knowledgeBaseIds: ['existing'] },
            token: { knowledgeBaseIds: ['existing'] },
          },
          { query: 'policy', knowledgeBaseIds: [saved[0].knowledgeBaseId] },
        ),
        { status: 403 },
      );
      await store
        .collection('records')
        .updateOne(
          { _id: new ObjectId(saved[0].knowledgeBaseId), ownerId: user.id },
          { $set: { name: 'My renamed support base', nameCustomized: true } },
        );
      const nextResolve = createKnowledgeDestination(store, connection);
      await nextResolve({ knowledgeBase: { id: 'support', name: 'Updated source support name' } });
      assert.equal(
        (await store.collection('records').findOne({ _id: new ObjectId(saved[0].knowledgeBaseId) }))
          .name,
        'My renamed support base',
      );
      const bundled = await service.importExport(user, {
        provider: 'notion',
        destination: 'existing',
        knowledgeBaseId: 'existing',
        acceptManagedAccess: true,
        documents,
      });
      assert.deepEqual(bundled.knowledgeBaseIds, ['existing']);
      assert.equal(await store.collection('records').countDocuments({ ownerId: user.id }), 2);
      const replacement = await service.importExport(user, {
        provider: 'notion',
        connectionId: bundled.id,
        destination: 'existing',
        knowledgeBaseId: 'existing',
        acceptManagedAccess: true,
        documents: [{ id: 'replacement', title: 'Updated export', text: 'Replacement body' }],
      });
      assert.equal(replacement.id, bundled.id);
      assert.equal(replacement.sync.documentCount, 1);
      assert.equal(
        await store
          .collection('knowledgeDocuments')
          .countDocuments({ connectionId: bundled.id, deletedAt: { $exists: false } }),
        1,
      );
      await assert.rejects(
        service.importExport(
          { ...user, id: 'other' },
          {
            provider: 'notion',
            connectionId: bundled.id,
            destination: 'existing',
            knowledgeBaseId: 'existing',
            acceptManagedAccess: true,
            documents,
          },
        ),
        { status: 404 },
      );
      await assert.rejects(
        service.importExport(user, {
          provider: 'notion',
          destination: 'existing',
          knowledgeBaseId: new ObjectId().toHexString(),
          acceptManagedAccess: true,
          documents,
        }),
        { status: 403 },
      );
    } finally {
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
