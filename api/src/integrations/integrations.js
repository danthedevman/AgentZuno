import { createSemanticService } from '../knowledge/semantic.js';
import { scanEndpoint } from './customImport.js';
import { adapterRegistry, validateAdapterConfig } from '../connectors/registry.js';
import {
  destinationMode,
  sourceKnowledgeBase,
  createKnowledgeDestination,
} from './knowledgeDestinations.js';
import sanitizeHtml from 'sanitize-html';
import { readData } from '../data/data.js';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { encryptSecret, decryptSecret } from '../shared/secrets.js';
import { sourceClient } from '../connectors/index.js';
import { canReadKnowledge, safeConnection } from '../shared/permissions.js';

export const error = (message, status = 400) =>
  Object.assign(new Error(message), { status, publicMessage: message });

export function createIntegrationService(store, loadWorkspace, fetcher = fetch) {
  const semantic = createSemanticService(store, fetcher);
  const clientFor = (connection) =>
    sourceClient(
      connection.provider,
      connection.config,
      decryptSecret(connection.credential),
      fetcher,
    );

  async function validateOAuthInput(user, input) {
    if (!['notion', 'confluence'].includes(input.provider))
      throw error('Unsupported OAuth adapter.', 422);
    const workspace = await loadWorkspace(user);
    if (
      destinationMode(input) === 'existing' &&
      !workspace.knowledgeBases.some((base) => base.id === input.knowledgeBaseId)
    )
      throw error('Choose a knowledge base in your workspace.', 403);
    if (
      !['source', 'managed'].includes(input.permissionMode) ||
      (input.provider === 'notion' && input.permissionMode !== 'managed')
    )
      throw error('Choose an available permission mode.');
    sourceClient(input.provider, { cloudId: input.cloudId }, 'validation-only', fetcher);
  }
  async function connect(user, input, connectionId) {
    const existing = connectionId ? await store.connection(user.id, connectionId) : null;
    if (connectionId && (!existing || existing.workspaceId !== user.workspaceId))
      throw error('Connection not found.', 404);
    if (existing?.authType === 'export')
      throw error('Edit snapshot details separately; reimport to replace its content.', 422);
    if (existing && existing.sync?.leaseUntil > new Date())
      throw error('Wait for the current import to finish before editing.', 409);
    if (existing && existing.provider !== input.provider)
      throw error('The connection provider cannot be changed.');
    if (existing && !input.accessToken)
      input = { ...input, accessToken: decryptSecret(existing.credential) };
    if (!Object.hasOwn(adapterRegistry, input.provider))
      throw error('This app needs a provider-specific adapter before it can be connected.', 501);
    if (!['source', 'managed'].includes(input.permissionMode))
      throw error('Select a permission mode.');
    if (
      typeof input.accessToken !== 'string' ||
      !input.accessToken.trim() ||
      input.accessToken.length > 10000
    )
      throw error('Enter a delegated source access token.');
    const workspace = await loadWorkspace(user);
    if (
      destinationMode(input) === 'existing' &&
      !workspace.knowledgeBases.some((base) => base.id === input.knowledgeBaseId)
    )
      throw error('Choose a knowledge base in your workspace.', 403);
    const authType = input.authType || adapterRegistry[input.provider].authenticationMethods[0].id;
    const config = {
      ...validateAdapterConfig(input.provider, input, authType),
      destination: destinationMode(input),
    };
    if (input.permissionMode === 'source' && authType !== 'oauth')
      throw error('Source-enforced permissions require a delegated OAuth token.', 422);
    if (/[\r\n]/.test(input.accessToken)) throw error('Invalid credential.');
    const source = sourceClient(input.provider, config, input.accessToken, fetcher);
    if (input.permissionMode === 'source' && !source.supportsUserPermissions)
      throw error(
        'This adapter cannot verify effective user permissions. Choose AgentZuno-managed access explicitly, or leave it disconnected.',
        422,
      );
    if (input.permissionMode === 'managed' && input.acceptManagedAccess !== true)
      throw error('Explicitly accept local permissions for the imported copy.');
    const sourcePrincipal = await source.principal();
    if (!sourcePrincipal?.id) throw error('The source identity could not be verified.', 422);
    if (input.provider === 'servicenow') config.expectedPrincipalId = sourcePrincipal.id;
    const connection = {
      ownerId: user.id,
      workspaceId: user.workspaceId,
      provider: input.provider,
      name: (await readData('integration-catalog.json')).find((item) => item.id === input.provider)
        .name,
      knowledgeBaseId: destinationMode(input) === 'existing' ? input.knowledgeBaseId : null,
      destination: destinationMode(input),
      permissionMode: input.permissionMode,
      allowedUserIds: [user.id],
      sourcePrincipal,
      config,
      authType,
      credential: encryptSecret(input.accessToken.trim()),
      status: 'Connected',
      createdAt: new Date(),
      ...(input.permissionMode === 'managed' ? { managedAccessAcceptedAt: new Date() } : {}),
      sync: { status: 'Not synced', nextAt: new Date() },
    };
    if (existing) {
      connection.createdAt = existing.createdAt;
      const result = await store.collection('sourceConnections').updateOne(
        {
          _id: existing._id,
          ownerId: user.id,
          $or: [
            { 'sync.leaseUntil': { $exists: false } },
            { 'sync.leaseUntil': { $lt: new Date() } },
          ],
        },
        { $set: connection },
      );
      if (!result.matchedCount)
        throw error('An import started. Try editing again when it finishes.', 409);
      return safeConnection({ ...connection, _id: existing._id });
    }
    const result = await store.collection('sourceConnections').insertOne(connection);
    return safeConnection({ ...connection, _id: result.insertedId });
  }

  async function sync(connection) {
    const now = new Date();
    const leaseId = randomUUID();
    const lease = await store.collection('sourceConnections').findOneAndUpdate(
      {
        _id: connection._id,
        status: 'Connected',
        $or: [{ 'sync.leaseUntil': { $exists: false } }, { 'sync.leaseUntil': { $lt: now } }],
      },
      {
        $set: {
          'sync.status': 'Syncing',
          'sync.leaseId': leaseId,
          'sync.leaseUntil': new Date(Date.now() + 10 * 60 * 1000),
        },
      },
      { returnDocument: 'after' },
    );
    if (!lease)
      throw Object.assign(error('An import is already running.', 409), {
        retryAfter: Math.max(
          30000,
          new Date(connection.sync?.leaseUntil || 0).getTime() - Date.now(),
        ),
      });
    const runId = randomUUID();
    let count = 0;
    const knowledgeBaseIds = new Set();
    const resolveDestination = createKnowledgeDestination(store, lease);
    try {
      const source = clientFor(lease);
      for await (const item of source.documents()) {
        if (count >= 5000) throw error('Import exceeds the current 5,000-document limit.', 422);
        if (
          !item.id ||
          String(item.id).length > 200 ||
          typeof item.title !== 'string' ||
          !item.title.trim() ||
          item.title.length > 500 ||
          typeof item.text !== 'string' ||
          item.text.length > 100000
        )
          throw error('The source returned an invalid document.', 502);
        const knowledgeBaseId = await resolveDestination(item);
        knowledgeBaseIds.add(knowledgeBaseId);
        const document = {
          ...item,
          ownerId: lease.ownerId,
          workspaceId: lease.workspaceId,
          connectionId: lease._id.toHexString(),
          knowledgeBaseId,
          sourceId: String(item.id),
          checkedAt: new Date(),
          semanticStatus: 'Pending',
          runId,
        };
        delete document.id;
        await store
          .collection('knowledgeDocuments')
          .updateOne(
            { connectionId: document.connectionId, sourceId: document.sourceId, runId },
            { $set: document, $unset: { deletedAt: '' } },
            { upsert: true },
          );
        const renewed = await store
          .collection('sourceConnections')
          .updateOne(
            { _id: lease._id, status: 'Connected', 'sync.leaseId': leaseId },
            { $set: { 'sync.leaseUntil': new Date(Date.now() + 10 * 60 * 1000) } },
          );
        if (!renewed.matchedCount) throw error('Import was cancelled.', 409);
        count++;
      }
      const current = await store.connection(lease.ownerId, lease._id.toHexString());
      if (current?.status !== 'Connected') return;
      await store
        .collection('knowledgeDocuments')
        .updateMany(
          { connectionId: lease._id.toHexString(), runId: { $ne: runId } },
          { $set: { deletedAt: new Date() } },
        );
      await store.collection('sourceConnections').updateOne(
        { _id: lease._id, status: 'Connected', 'sync.leaseId': leaseId },
        {
          $set: {
            knowledgeBaseIds: [...knowledgeBaseIds],
            sync: {
              status: 'Synced',
              lastAt: new Date(),
              nextAt: new Date(Date.now() + 5 * 60 * 1000),
              documentCount: count,
              activeRunId: runId,
            },
          },
        },
      );
    } catch (failure) {
      await store.collection('sourceConnections').updateOne(
        { _id: lease._id, status: 'Connected', 'sync.leaseId': leaseId },
        {
          $set: {
            'sync.status': 'Needs attention',
            'sync.nextAt': new Date(Date.now() + 5 * 60 * 1000),
            'sync.error': 'Import failed. Check source access and try again.',
          },
          $unset: { 'sync.leaseUntil': '', 'sync.leaseId': '' },
        },
      );
      throw failure;
    }
  }

  async function readDocument(user, id) {
    if (!ObjectId.isValid(id)) throw error('Document not found.', 404);
    const document = await store.collection('knowledgeDocuments').findOne({
      _id: new ObjectId(id),
      ownerId: user.id,
      workspaceId: user.workspaceId,
      deletedAt: { $exists: false },
    });
    if (!document) throw error('Document not found.', 404);
    const connection = await store.connection(user.id, document.connectionId);
    const agent = { knowledgeBaseIds: [document.knowledgeBaseId] };
    if (
      document.runId !== connection?.sync?.activeRunId ||
      !canReadKnowledge({
        user,
        agent,
        document,
        connection,
        knowledgeBaseIds: agent.knowledgeBaseIds,
      })
    )
      throw error('Document not found.', 404);
    let content = document;
    if (connection.permissionMode === 'source') {
      try {
        content = await clientFor(connection).read(document.sourceId);
      } catch {
        throw error('Source access could not be verified.', 403);
      }
    }
    return {
      id,
      title: content.title,
      text: content.text,
      sourceUrl: content.url,
      knowledgeBaseId: document.knowledgeBaseId,
      permissionMode: connection.permissionMode,
    };
  }

  async function importExport(user, input) {
    const catalog = await readData('integration-catalog.json');
    const app = catalog.find((item) => item.id === input.provider);
    const workspace = await loadWorkspace(user);
    const existing = input.connectionId
      ? await store.connection(user.id, input.connectionId)
      : null;
    if (
      input.connectionId &&
      (!existing ||
        existing.authType !== 'export' ||
        existing.provider !== input.provider ||
        existing.workspaceId !== user.workspaceId)
    )
      throw error('Snapshot not found.', 404);
    if (
      !app ||
      (destinationMode(input) === 'existing' &&
        !workspace.knowledgeBases.some((base) => base.id === input.knowledgeBaseId))
    )
      throw error('Choose an app and knowledge base in your workspace.', 403);
    if (input.acceptManagedAccess !== true)
      throw error('Explicitly accept AgentZuno-managed access for this imported copy.');
    if (!Array.isArray(input.documents) || !input.documents.length || input.documents.length > 1000)
      throw error('Provide a JSON export with 1–1,000 documents.');
    const documents = input.documents.map((item, index) => {
      if (
        !item ||
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        item.title.length > 500 ||
        typeof item.text !== 'string' ||
        item.text.length > 100000
      )
        throw error('Every export document needs a title and text within the size limits.');
      const url =
        typeof item.url === 'string' && /^https:\/\//.test(item.url)
          ? item.url.slice(0, 2000)
          : undefined;
      return {
        ...(destinationMode(input) === 'source'
          ? { knowledgeBase: sourceKnowledgeBase(item.knowledgeBase) }
          : {}),
        sourceId: String(item.id || index).slice(0, 200),
        title: item.title.trim(),
        text: item.text,
        ...(url ? { url } : {}),
      };
    });
    if (new Set(documents.map((item) => item.sourceId)).size !== documents.length)
      throw error('Export document IDs must be unique.');
    const runId = randomUUID();
    const connection = {
      ownerId: user.id,
      workspaceId: user.workspaceId,
      provider: app.id,
      name: existing?.name || app.name,
      knowledgeBaseId: destinationMode(input) === 'existing' ? input.knowledgeBaseId : null,
      destination: destinationMode(input),
      permissionMode: 'managed',
      allowedUserIds: [user.id],
      managedAccessAcceptedAt: new Date(),
      sourcePrincipal: { id: user.id, name: 'Owner-supplied export' },
      authType: 'export',
      status: 'Importing',
      createdAt: new Date(),
    };
    const inserted = existing
      ? { insertedId: existing._id }
      : await store.collection('sourceConnections').insertOne(connection);
    const id = inserted.insertedId.toHexString();
    if (existing) connection.createdAt = existing.createdAt;
    connection._id = inserted.insertedId;
    const resolveDestination = createKnowledgeDestination(store, connection);
    const assigned = [];
    for (const item of documents)
      assigned.push({ ...item, knowledgeBaseId: await resolveDestination(item) });
    await store.collection('knowledgeDocuments').insertMany(
      assigned.map((item) => ({
        ...item,
        ownerId: user.id,
        workspaceId: user.workspaceId,
        connectionId: id,
        checkedAt: new Date(),
        semanticStatus: 'Pending',
        runId,
      })),
    );
    const sync = {
      status: 'Synced',
      lastAt: new Date(),
      documentCount: documents.length,
      activeRunId: runId,
    };
    await store.collection('sourceConnections').updateOne(
      { _id: inserted.insertedId },
      {
        $set: {
          ...connection,
          status: 'Connected',
          sync,
          knowledgeBaseIds: [...new Set(assigned.map((item) => item.knowledgeBaseId))],
        },
      },
    );
    await store
      .collection('knowledgeDocuments')
      .updateMany({ connectionId: id, runId: { $ne: runId } }, { $set: { deletedAt: new Date() } });
    return safeConnection({
      ...connection,
      knowledgeBaseIds: [...new Set(assigned.map((item) => item.knowledgeBaseId))],
      _id: inserted.insertedId,
      status: 'Connected',
      sync,
    });
  }

  async function listKnowledgeBases(context) {
    const { user, agent } = context;
    const workspace = await loadWorkspace(user);
    const verified = new Map();
    const bases = [];
    for (const base of workspace.knowledgeBases || []) {
      if (!agent.knowledgeBaseIds?.includes(base.id)) continue;
      if (base.sourceConnectionId) {
        const connection = await store.connection(user.id, base.sourceConnectionId);
        if (
          !connection ||
          connection.workspaceId !== user.workspaceId ||
          connection.status !== 'Connected'
        )
          continue;
        if (
          connection.permissionMode === 'managed' &&
          (!connection.managedAccessAcceptedAt || !connection.allowedUserIds?.includes(user.id))
        )
          continue;
        if (!['source', 'managed'].includes(connection.permissionMode)) continue;
        if (connection.permissionMode === 'source') {
          if (!connection.sourcePrincipal?.id) continue;
          if (!verified.has(base.sourceConnectionId)) {
            try {
              verified.set(
                base.sourceConnectionId,
                new Set((await clientFor(connection).knowledgeBases()).map((item) => item.id)),
              );
            } catch {
              verified.set(base.sourceConnectionId, new Set());
            }
          }
          if (!verified.get(base.sourceConnectionId).has(base.sourceBaseId)) continue;
        }
      }
      bases.push({ id: base.id, name: base.name });
    }
    return { knowledgeBases: bases.sort((a, b) => a.name.localeCompare(b.name)) };
  }
  async function search(context, input) {
    const started = Date.now();
    const { user, agent, token } = context;
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    const requested = input.knowledgeBaseIds || agent.knowledgeBaseIds;
    if (
      !query ||
      query.length > 500 ||
      !Array.isArray(requested) ||
      !requested.length ||
      requested.some((id) => !agent.knowledgeBaseIds?.includes(id))
    )
      throw error('A query and authorized knowledge bases are required.', 403);
    const results = [];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let candidates = await store
      .collection('knowledgeDocuments')
      .find({
        ownerId: user.id,
        workspaceId: user.workspaceId,
        knowledgeBaseId: { $in: requested },
        deletedAt: { $exists: false },
        $or: [
          { title: { $regex: escaped, $options: 'i' } },
          { text: { $regex: escaped, $options: 'i' } },
        ],
      })
      .limit(50)
      .toArray();
    let semanticIds = [];
    let retrievalMode = 'keyword';
    try {
      semanticIds = await semantic.search(user, requested, query);
      if (semanticIds.length) {
        const semanticDocuments = await store
          .collection('knowledgeDocuments')
          .find({
            _id: { $in: semanticIds.map((id) => new ObjectId(id)) },
            ownerId: user.id,
            workspaceId: user.workspaceId,
            knowledgeBaseId: { $in: requested },
            deletedAt: { $exists: false },
          })
          .toArray();
        const ranked = semanticIds
          .map((id) => semanticDocuments.find((item) => item._id.toHexString() === id))
          .filter(Boolean);
        candidates = [
          ...new Map(
            [...ranked, ...candidates].map((item) => [item._id.toHexString(), item]),
          ).values(),
        ];
        retrievalMode = 'hybrid';
      }
    } catch {
      retrievalMode = 'keyword-fallback';
    }
    const deadline = Date.now() + 20000;
    for (const document of candidates) {
      if (Date.now() > deadline) break;
      const connection = await store.connection(user.id, document.connectionId);
      if (document.runId !== connection?.sync?.activeRunId) continue;
      if (!canReadKnowledge({ user, agent, document, connection, knowledgeBaseIds: requested }))
        continue;
      let current = document;
      if (connection.permissionMode === 'source') {
        try {
          current = await clientFor(connection).read(document.sourceId);
        } catch {
          continue;
        }
      }
      if (
        !semanticIds.includes(document._id.toHexString()) &&
        !`${current.title} ${current.text}`.toLowerCase().includes(query.toLowerCase())
      )
        continue;
      results.push({
        id: document._id.toHexString(),
        title: current.title,
        text: current.text.slice(0, 12000),
        sourceUrl: current.url,
        sourceDocumentId: document._id.toHexString(),
        knowledgeBaseId: document.knowledgeBaseId,
        permissionMode: connection.permissionMode,
      });
      if (results.length >= 10) break;
    }
    // Locally authored articles are owner-only and still require the agent's KB grant.
    const articles = await store
      .collection('articles')
      .find({ ownerId: user.id, base: { $in: requested } })
      .limit(1000)
      .toArray();
    for (const article of articles) {
      if (results.length >= 10) break;
      if (`${article.title} ${article.summary}`.toLowerCase().includes(query.toLowerCase()))
        results.push({
          id: article._id.toHexString(),
          title: article.title,
          text: sanitizeHtml(article.body, { allowedTags: [], allowedAttributes: {} }).slice(
            0,
            12000,
          ),
          knowledgeBaseId: article.base,
          permissionMode: 'managed',
        });
    }
    await store.collection('knowledgeAudit').insertOne({
      ownerId: user.id,
      workspaceId: user.workspaceId,
      durationMs: Date.now() - started,
      references: results.map((item) => ({
        documentId: item.sourceDocumentId || item.id,
        kind: item.sourceDocumentId ? 'source' : 'article',
        knowledgeBaseId: item.knowledgeBaseId,
      })),
      agentId: token.agentId,
      tokenId: token._id,
      knowledgeBaseIds: requested,
      resultIds: results.map((item) => item.id),
      at: new Date(),
    });
    return { results, retrievalMode };
  }

  return {
    validateOAuthInput,
    async sourceBases(user, id) {
      const connection = await store.connection(user.id, id);
      if (
        !connection ||
        connection.workspaceId !== user.workspaceId ||
        connection.status !== 'Connected' ||
        connection.provider !== 'servicenow'
      )
        throw error('ServiceNow connection not found.', 404);
      return clientFor(connection).knowledgeBases();
    },
    connect,
    sync,
    search,
    listKnowledgeBases,
    async scanCustomEndpoint(user, input) {
      if (input.connectionId) {
        const existing = await store.connection(user.id, input.connectionId);
        if (
          !existing ||
          existing.authType !== 'export' ||
          existing.provider !== 'custom' ||
          existing.workspaceId !== user.workspaceId
        )
          throw error('Snapshot not found.', 404);
      }
      const workspace = await loadWorkspace(user);
      if (
        input.acceptManagedAccess !== true ||
        (destinationMode(input) === 'existing' &&
          !workspace.knowledgeBases.some((base) => base.id === input.knowledgeBaseId))
      )
        throw error('Choose a knowledge base and AgentZuno-managed import.', 403);
      return scanEndpoint(input);
    },
    importExport,
    readDocument,
  };
}
