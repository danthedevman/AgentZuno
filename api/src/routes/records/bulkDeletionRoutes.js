import { createBulkDeletionController } from '../../controllers/records/bulkDeletionController.js';
export function installBulkDeletionRoutes(app, store) {
  const controller = createBulkDeletionController(store);
  for (const kind of ['requests', 'articles'])
    app.post(`/api/helpdesk/${kind}/bulk-delete`, controller.postKindBulkDelete(kind));
}
