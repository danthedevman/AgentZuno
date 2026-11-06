import { randomUUID } from 'node:crypto';

import { safeConnection } from '../../shared/permissions.js';
import { error } from '../../integrations/integrations.js';
export function createIntegrationsController(store, service, queues) {
  const requireUser = (request, response, next) =>
    request.user && !request.user.isDemo
      ? next()
      : response
          .status(401)
          .json({ error: 'Use a registered account to manage live connections.' });
  const getConnections = async (request, response) =>
    response.json((await store.connections(request.user.id)).map(safeConnection));
  const getConnectionsIdBases = async (request, response) =>
    response.json(await service.sourceBases(request.user, request.params.id));
  const getConnectionsIdIndex = async (request, response) => {
    const connection = await store.connection(request.user.id, request.params.id);
    if (!connection || connection.workspaceId !== request.user.workspaceId)
      throw error('Connection not found.', 404);
    const counts = await store
      .collection('knowledgeDocuments')
      .aggregate([
        {
          $match: {
            ownerId: request.user.id,
            workspaceId: request.user.workspaceId,
            connectionId: request.params.id,
            runId: connection.sync?.activeRunId || '',
            deletedAt: { $exists: false },
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$semanticStatus', 'Pending'] },
            count: { $sum: 1 },
            chunks: { $sum: { $ifNull: ['$chunkCount', 0] } },
          },
        },
      ])
      .toArray();
    response.json({
      counts,
      semanticConfigured: !!process.env.OLLAMA_URL && !!process.env.QDRANT_URL,
    });
  };
  const getConnectionsId = async (request, response) => {
    const connection = await store.connection(request.user.id, request.params.id);
    if (!connection || connection.workspaceId !== request.user.workspaceId)
      throw error('Connection not found.', 404);
    response.json(safeConnection(connection));
  };
  const patchConnectionsId = async (request, response) => {
    const connection = await store.connection(request.user.id, request.params.id);
    if (!connection || connection.workspaceId !== request.user.workspaceId)
      throw error('Connection not found.', 404);
    if (connection.authType !== 'export')
      return response.json(
        await service.connect(request.user, request.body || {}, request.params.id),
      );
    const name = request.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 160)
      throw error('Enter a connection name up to 160 characters.');
    await store
      .collection('sourceConnections')
      .updateOne(
        { _id: connection._id, ownerId: request.user.id },
        { $set: { name: name.trim() } },
      );
    response.json({ ...safeConnection(connection), name: name.trim() });
  };
  const postConnectionsImportEndpoint = async (request, response) => {
    const input = request.body || {};
    const documents = await service.scanCustomEndpoint(request.user, input);
    response.status(201).json(
      await service.importExport(request.user, {
        ...input,
        provider: 'custom',
        documents,
      }),
    );
  };
  const postConnectionsImport = async (request, response) =>
    response.status(201).json(await service.importExport(request.user, request.body || {}));
  const postConnections = (request, response) =>
    response
      .status(410)
      .json({ error: 'New knowledge-source integrations have been removed. Use a Custom import.' });
  const postConnectionsIdSync = async (request, response) => {
    const connection = await store.connection(request.user.id, request.params.id);
    if (connection?.authType === 'export')
      throw error(
        'This connection is an imported snapshot. Import an updated export instead.',
        422,
      );
    if (!connection || connection.status !== 'Connected') throw error('Connection not found.', 404);
    await queues.sync(connection, `manual-${connection._id}-${randomUUID()}`);
    response.status(202).json({ status: 'Queued' });
  };
  const postConnectionsIdDisconnect = async (request, response) => {
    const connection = await store.connection(request.user.id, request.params.id);
    if (!connection) throw error('Connection not found.', 404);
    await store
      .collection('sourceConnections')
      .updateOne(
        { _id: connection._id, ownerId: request.user.id },
        { $set: { status: 'Disconnected' }, $unset: { credential: '' } },
      );
    await store
      .collection('knowledgeDocuments')
      .updateMany(
        { connectionId: request.params.id, ownerId: request.user.id },
        { $set: { deletedAt: new Date() } },
      );
    response.json({ status: 'Disconnected' });
  };
  const getKnowledgeDocumentsId = async (request, response) =>
    response.json(await service.readDocument(request.user, request.params.id));
  const postKnowledgeBrowserSearch = async (request, response) => {
    const bases = [
      ...new Set(
        (await store.connections(request.user.id))
          .filter((connection) => connection.status === 'Connected')
          .flatMap((connection) => connection.knowledgeBaseIds || [connection.knowledgeBaseId])
          .filter(Boolean),
      ),
    ];
    if (!bases.length) return response.json({ results: [] });
    response.json(
      await service.search(
        {
          user: request.user,
          agent: { knowledgeBaseIds: bases },
          token: { knowledgeBaseIds: bases, agentId: 'workspace-ui', _id: null },
        },
        request.body || {},
      ),
    );
  };
  return {
    getConnections,
    getConnectionsIdBases,
    getConnectionsIdIndex,
    getConnectionsId,
    patchConnectionsId,
    postConnectionsImportEndpoint,
    postConnectionsImport,
    postConnections,
    postConnectionsIdSync,
    postConnectionsIdDisconnect,
    getKnowledgeDocumentsId,
    postKnowledgeBrowserSearch,
    requireUser,
  };
}
