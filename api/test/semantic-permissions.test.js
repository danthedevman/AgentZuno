import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from 'mongodb';
import { randomUUID, randomBytes } from 'node:crypto';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createIntegrationService } from '../src/integrations.js';
import { encryptSecret } from '../src/secrets.js';

test(
  'semantic matches recheck ServiceNow access and never return denied content',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    process.env.MONGODB_DATABASE = 'agentzuno_semantic_' + randomUUID().replaceAll('-', '');
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.OLLAMA_URL = 'http://ollama.test';
    process.env.QDRANT_URL = 'http://qdrant.test';
    const store = createIntegrationStore();
    await store.ready();
    const cleanup = new MongoClient(process.env.MONGODB_URI);
    const user = { id: 'owner', workspaceId: 'workspace' };
    const sourceId = 'a'.repeat(32);
    const principal = 'reader';
    const connectionId = new ObjectId();
    const documentId = new ObjectId();
    let allowed = true;
    let reads = 0;
    try {
      await store.collection('sourceConnections').insertOne({
        _id: connectionId,
        ownerId: user.id,
        workspaceId: user.workspaceId,
        provider: 'servicenow',
        status: 'Connected',
        permissionMode: 'source',
        sourcePrincipal: { id: principal },
        authType: 'oauth',
        config: { tenant: 'example', namespace: 'x_agentzuno', expectedPrincipalId: principal },
        credential: encryptSecret('test-credential'),
        sync: { activeRunId: 'generation' },
      });
      await store.collection('knowledgeDocuments').insertOne({
        _id: documentId,
        ownerId: user.id,
        workspaceId: user.workspaceId,
        connectionId: connectionId.toHexString(),
        knowledgeBaseId: 'base',
        sourceId,
        runId: 'generation',
        title: 'VPN',
        text: 'Protected instructions',
      });
      const service = createIntegrationService(
        store,
        async () => ({}),
        async (url) => {
          const target = new URL(url);
          if (target.hostname === 'ollama.test')
            return Response.json({ embeddings: [Array(768).fill(0.1)] });
          if (target.hostname === 'qdrant.test')
            return Response.json(
              target.pathname.endsWith('/points/query')
                ? { result: { points: [{ payload: { documentId: documentId.toHexString() } }] } }
                : { result: {} },
            );
          if (target.pathname.endsWith('/me'))
            return Response.json({
              result: { id: principal, name: 'Reader', permissionCheck: 'KBKnowledge.canRead' },
            });
          reads++;
          return allowed
            ? Response.json({
                result: { id: sourceId, title: 'VPN', text: 'Current authorized instructions' },
              })
            : Response.json({ error: 'Denied' }, { status: 403 });
        },
      );
      const context = {
        user,
        agent: { knowledgeBaseIds: ['base'] },
        token: { agentId: 'agent', _id: new ObjectId() },
      };
      const result = await service.search(context, { query: 'remote access' });
      assert.equal(result.retrievalMode, 'hybrid');
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].text, 'Current authorized instructions');
      allowed = false;
      assert.deepEqual((await service.search(context, { query: 'remote access' })).results, []);
      assert.equal(reads, 2);
      const edited = await service.connect(
        user,
        {
          provider: 'servicenow',
          permissionMode: 'source',
          authType: 'oauth',
          accessToken: '',
          config: { tenant: 'example', namespace: 'x_agentzuno' },
          destination: 'source',
        },
        connectionId.toHexString(),
      );
      assert.equal(edited.id, connectionId.toHexString());
      assert.equal(edited.sync.activeRunId, undefined);
      assert.equal(JSON.stringify(edited).includes('test-credential'), false);
      assert.equal((await service.search(context, { query: 'remote access' })).results.length, 0);
      await assert.rejects(
        service.connect(
          { ...user, id: 'other' },
          { provider: 'servicenow' },
          connectionId.toHexString(),
        ),
        { status: 404 },
      );
      await assert.rejects(
        service.search({ ...context, agent: { knowledgeBaseIds: [] } }, { query: 'remote access' }),
        /authorized/,
      );
    } finally {
      await cleanup.db(process.env.MONGODB_DATABASE).dropDatabase();
      await cleanup.close();
      await store.close();
    }
  },
);
