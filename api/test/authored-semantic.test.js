import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createAuthoredSemantic } from '../src/knowledge/authoredSemantic.js';
import { createContentStore } from '../src/knowledge/contentStore.js';
import {
  retrieveAssistantKnowledge,
  verifyAssistantKnowledge,
} from '../src/knowledge/assistantKnowledge.js';
import { bulkDeleteRecords } from '../src/records/bulkDeletion.js';

test(
  'manually authored semantic knowledge backfills, reindexes, revokes, isolates and retires deleted articles',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const old = [process.env.OLLAMA_URL, process.env.QDRANT_URL, process.env.MONGODB_DATABASE];
    process.env.OLLAMA_URL = 'http://ollama.fixture';
    process.env.QDRANT_URL = 'http://qdrant.fixture';
    process.env.MONGODB_DATABASE = `agentzuno_authored_vector_${randomUUID().replaceAll('-', '')}`;
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE),
      store = { collection: (name) => db.collection(name), ready: async () => {} };
    const content = createContentStore(process.env.TEST_MONGODB_URI);
    const workspaceId = new ObjectId().toHexString(),
      ownerId = 'owner',
      base = new ObjectId().toHexString();
    const user = { id: 'employee', workspaceId, role: 'user', helpdeskOwnerId: ownerId };
    const points = new Map(),
      calls = [];
    const service = createAuthoredSemantic(store, async (url, options = {}) => {
      const path = new URL(url).pathname,
        body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body });
      if (path === '/api/embed')
        return Response.json({ embeddings: body.input.map(() => Array(768).fill(0.1)) });
      if (path.endsWith('/points/query'))
        return Response.json({
          result: { points: [...points.values()].map((point) => ({ ...point, score: 0.8 })) },
        });
      if (path.endsWith('/points') && body?.points)
        for (const point of body.points) points.set(point.id, point);
      if (path.endsWith('/points/delete'))
        for (const [id, point] of points) {
          const matches = (rule) => point.payload[rule.key] === rule.match.value;
          if (body.filter.must.every(matches) && !(body.filter.must_not || []).some(matches))
            points.delete(id);
        }
      return Response.json({ result: true });
    });
    try {
      await db.collection('users').insertOne({ id: ownerId, workspaceId });
      await db
        .collection('helpdeskMembers')
        .insertOne({ ownerId, workspaceId, userId: user.id, active: true, role: 'user' });
      await db
        .collection('knowledgePermissions')
        .insertOne({ ownerId, workspaceId, kind: 'base', resourceId: base, mode: 'workspace' });
      const article = await content.saveArticle(ownerId, {
        workspaceId,
        title: 'Slack Access',
        body: '<p>Use Software Access to obtain Slack.</p>',
        status: 'Published',
        base,
        topicIds: [],
        updatedAt: new Date().toISOString(),
      });
      assert.equal(article.semanticStatus, 'Pending');
      await service.process({ id: article.id, ownerId, workspaceId });
      assert.ok(points.size > 0);
      assert.equal((await content.article(ownerId, article.id)).semanticStatus, 'Ready');
      const chat = {
        ownerId: user.id,
        providerOwnerId: ownerId,
        workspaceId,
        helpdeskPurpose: 'support',
        messages: [{ role: 'user', text: 'collaborate remotely with coworkers' }],
      };
      const found = await retrieveAssistantKnowledge(store, chat, service);
      assert.equal(found[0].title, 'Slack Access');
      assert.equal(found[0].retrievalMethod, 'semantic');
      assert.ok(
        calls
          .find((call) => call.path.endsWith('/points/query'))
          .body.filter.must.some(
            (rule) => rule.key === 'workspaceId' && rule.match.value === workspaceId,
          ),
      );
      await verifyAssistantKnowledge(store, chat, found);
      await db.collection('knowledgePermissions').insertOne({
        ownerId,
        workspaceId,
        kind: 'article',
        resourceId: article.id,
        mode: 'restricted',
        userIds: [],
        roles: [],
      });
      assert.equal((await retrieveAssistantKnowledge(store, chat, service)).length, 0);
      await assert.rejects(verifyAssistantKnowledge(store, chat, found));
      await db.collection('knowledgePermissions').deleteOne({ kind: 'article' });
      await content.updateArticle(ownerId, article.id, {
        body: '<p>Use the approved software catalog.</p>',
        updatedAt: new Date().toISOString(),
      });
      assert.equal((await retrieveAssistantKnowledge(store, chat, service)).length, 0);
      await service.process({ id: article.id, ownerId, workspaceId });
      assert.equal(new Set([...points.values()].map((point) => point.payload.runId)).size, 1);
      await content.updateArticle(ownerId, article.id, { status: 'Draft' });
      assert.equal((await retrieveAssistantKnowledge(store, chat, service)).length, 0);
      await service.process({ id: article.id, ownerId, workspaceId });
      assert.equal(points.size, 0);
      await content.updateArticle(ownerId, article.id, { status: 'Published' });
      await service.process({ id: article.id, ownerId, workspaceId });
      await bulkDeleteRecords(store, { id: ownerId, workspaceId, role: 'admin' }, 'articles', {
        ids: [article.id],
        confirmed: true,
      });
      await service.process({ id: article.id, ownerId, workspaceId });
      assert.equal(points.size, 0);
      assert.equal(await db.collection('authoredKnowledgeChunks').countDocuments({}), 0);
      assert.equal((await retrieveAssistantKnowledge(store, chat, service)).length, 0);
      assert.equal(
        (await db.collection('authoredSemanticRetirements').findOne({ _id: article.id })).status,
        'Retired',
      );
    } finally {
      await content.close();
      await db.dropDatabase();
      await client.close();
      for (const [key, value] of ['OLLAMA_URL', 'QDRANT_URL', 'MONGODB_DATABASE'].map(
        (key, index) => [key, old[index]],
      ))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
  },
);
