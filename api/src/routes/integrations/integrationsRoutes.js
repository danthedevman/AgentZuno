import { createIntegrationsController } from '../../controllers/integrations/integrationsController.js';
export function installIntegrationRoutes(app, store, service, queues) {
  const controller = createIntegrationsController(store, service, queues);
  app.get('/api/connections', controller.requireUser, controller.getConnections);
  app.get('/api/connections/:id/bases', controller.requireUser, controller.getConnectionsIdBases);
  app.get('/api/connections/:id/index', controller.requireUser, controller.getConnectionsIdIndex);
  app.get('/api/connections/:id', controller.requireUser, controller.getConnectionsId);
  app.patch('/api/connections/:id', controller.requireUser, controller.patchConnectionsId);
  app.post(
    '/api/connections/import-endpoint',
    controller.requireUser,
    controller.postConnectionsImportEndpoint,
  );
  app.post('/api/connections/import', controller.requireUser, controller.postConnectionsImport);
  app.post('/api/connections', controller.requireUser, controller.postConnections);
  app.post('/api/connections/:id/sync', controller.requireUser, controller.postConnectionsIdSync);
  app.post(
    '/api/connections/:id/disconnect',
    controller.requireUser,
    controller.postConnectionsIdDisconnect,
  );
  app.get(
    '/api/knowledge/documents/:id',
    controller.requireUser,
    controller.getKnowledgeDocumentsId,
  );
  app.post(
    '/api/knowledge/browser-search',
    controller.requireUser,
    controller.postKnowledgeBrowserSearch,
  );
}
