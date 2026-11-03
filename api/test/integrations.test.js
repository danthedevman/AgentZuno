import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { ObjectId, MongoClient } from 'mongodb';
import { once } from 'node:events';
import { createApiServer } from '../src/app.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createIntegrationService } from '../src/integrations.js';
import { canReadKnowledge } from '../src/permissions.js';

const uri = process.env.TEST_MONGODB_URI;

test('permission evaluation denies missing grants, cross-workspace access, and unaccepted managed copies', () => {
  const user = { id: 'user', workspaceId: 'workspace' };
  const agent = { knowledgeBaseIds: ['kb'] };
  const connection = {
    ownerId: user.id,
    workspaceId: user.workspaceId,
    status: 'Connected',
    permissionMode: 'managed',
    managedAccessAcceptedAt: new Date(),
    allowedUserIds: [user.id],
  };
  const document = { ownerId: user.id, workspaceId: user.workspaceId, knowledgeBaseId: 'kb' };
  const input = { user, agent, connection, document, knowledgeBaseIds: ['kb'] };
  assert.equal(canReadKnowledge(input), true);
  assert.equal(canReadKnowledge({ ...input, agent: { knowledgeBaseIds: [] } }), false);
  assert.equal(canReadKnowledge({ ...input, user: { ...user, id: 'other' } }), false);
  assert.equal(
    canReadKnowledge({ ...input, document: { ...document, workspaceId: 'other' } }),
    false,
  );
  assert.equal(
    canReadKnowledge({ ...input, connection: { ...connection, managedAccessAcceptedAt: null } }),
    false,
  );
  assert.equal(
    canReadKnowledge({ ...input, connection: { ...connection, status: 'Disconnected' } }),
    false,
  );
});

test(
  'imports, permission rechecks, local fallback, owner authorization fail closed',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = 'agentzuno_permissions_test_' + randomUUID().replaceAll('-', '');
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const user = { id: 'reader', workspaceId: new ObjectId().toHexString() };
    let sourceAccess = true;
    let deleted = false;
    let failSync = false;
    let sourceReads = 0;
    const fetcher = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/api/v2/users/me.json')
        return Response.json({ user: { id: 'source-reader', name: 'Source Reader' } });
      if (path === '/api/v2/help_center/articles.json')
        return Response.json({ articles: deleted ? [] : [{ id: 42 }], next_page: null });
      if (path === '/api/v2/help_center/articles/42.json') {
        sourceReads++;
        if (!sourceAccess || failSync) return new Response('', { status: 403 });
        return Response.json({
          article: {
            id: 42,
            title: 'Permission policy',
            body: '<p>Private source policy</p>',
            html_url: 'https://example.zendesk.com/hc/articles/42',
            updated_at: '2026-10-29',
          },
        });
      }
      if (path === '/v1/users/me') return Response.json({ id: 'notion-bot', name: 'Integration' });
      throw new Error('Unexpected source URL: ' + path);
    };
    const service = createIntegrationService(
      store,
      async () => ({ knowledgeBases: [{ id: 'kb' }] }),
      fetcher,
    );
    try {
      const input = {
        provider: 'zendesk',
        tenant: 'example',
        accessToken: 'source-token-secret',
        knowledgeBaseId: 'kb',
        permissionMode: 'source',
      };
      await assert.rejects(service.connect(user, { ...input, knowledgeBaseId: 'foreign' }), {
        status: 403,
      });
      await assert.rejects(service.connect(user, { ...input, provider: 'notion' }), {
        status: 422,
      });
      await assert.rejects(service.connect(user, { ...input, permissionMode: 'managed' }), {
        status: 400,
      });
      const connection = await service.connect(user, input);
      assert.ok(!JSON.stringify(connection).includes('source-token-secret'));
      const privateConnection = await store.connection(user.id, connection.id);
      assert.ok(privateConnection.credential.ciphertext);
      await service.sync(privateConnection);
      const context = {
        user,
        agent: { knowledgeBaseIds: ['kb'] },
        token: { agentId: 'workspace-ui', _id: null },
      };
      const result = await service.search(context, { query: 'policy' });
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].permissionMode, 'source');
      sourceAccess = false;
      assert.deepEqual((await service.search(context, { query: 'policy' })).results, []);
      sourceAccess = true;
      await assert.rejects(
        service.search(context, { query: 'policy', knowledgeBaseIds: ['foreign'] }),
        { status: 403 },
      );
      await assert.rejects(
        service.search({ ...context, agent: { knowledgeBaseIds: [] } }, { query: 'policy' }),
        { status: 403 },
      );
      const managed = await service.connect(user, {
        ...input,
        permissionMode: 'managed',
        acceptManagedAccess: true,
      });
      await service.sync(await store.connection(user.id, managed.id));
      sourceAccess = false;
      const readsBefore = sourceReads;
      const copy = await service.search(context, { query: 'policy' });
      assert.equal(copy.results.length, 1);
      assert.equal(copy.results[0].permissionMode, 'managed');
      assert.equal(sourceReads, readsBefore + 1); // Only the source-enforced connection was rechecked.
      sourceAccess = true;
      deleted = true;
      await service.sync(await store.connection(user.id, connection.id));
      await service.sync(await store.connection(user.id, managed.id));
      assert.deepEqual((await service.search(context, { query: 'policy' })).results, []);
      const snapshot = await service.importExport(user, {
        provider: 'document360',
        knowledgeBaseId: 'kb',
        acceptManagedAccess: true,
        documents: [
          {
            id: 'export-1',
            title: 'Snapshot policy',
            text: 'Private export policy',
            url: 'https://example.test/policy',
          },
        ],
      });
      assert.equal(snapshot.permissionMode, 'managed');
      const exported = await service.search(context, { query: 'Snapshot' });
      assert.equal(exported.results.length, 1);
      assert.equal(
        (await service.readDocument(user, exported.results[0].sourceDocumentId)).title,
        'Snapshot policy',
      );
      await assert.rejects(
        service.readDocument({ ...user, id: 'other' }, exported.results[0].sourceDocumentId),
        { status: 404 },
      );
      await assert.rejects(
        service.importExport(user, {
          provider: 'notion',
          knowledgeBaseId: 'kb',
          documents: [{ title: 'No consent', text: 'Body' }],
        }),
        { status: 400 },
      );
    } finally {
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
