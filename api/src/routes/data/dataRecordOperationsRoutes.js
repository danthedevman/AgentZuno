import { createDataRecordOperationsController } from '../../controllers/data/dataRecordOperationsController.js';
export function installDataRecordOperationRoutes(app, store) {
  const controller = createDataRecordOperationsController(store);
  app.post(
    '/api/helpdesk/data/tables/:tableId/records/:id/deletion-review',
    controller.postDataTablesTableIdRecordsIdDeletionReview,
  );
  app.get('/api/helpdesk/data/deletions/:id', controller.getDataDeletionsId);
  app.post('/api/helpdesk/data/deletions/:id/confirm', controller.postDataDeletionsIdConfirm);
}
