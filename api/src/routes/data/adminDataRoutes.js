import { createAdminDataController } from '../../controllers/data/adminDataController.js';
export function installAdminDataRoutes(app, store, chats) {
  const controller = createAdminDataController(store, chats);
  app.get('/api/helpdesk/data/tables', controller.getDataTables);
  app.post('/api/helpdesk/data/tables', controller.postDataTables);
  app.get('/api/helpdesk/data/tables/:id', controller.getDataTablesId);
  app.put('/api/helpdesk/data/tables/:id', controller.putDataTablesId);
  app.get('/api/helpdesk/data/tables/:id/options', controller.getDataTablesIdOptions);
  app.get('/api/helpdesk/data/tables/:id/records', controller.getDataTablesIdRecords);
  app.get(
    '/api/helpdesk/data/tables/:id/records/:recordId',
    controller.getDataTablesIdRecordsRecordId,
  );

  app.delete('/api/helpdesk/data/tables/:id', controller.deleteDataTablesId);
  app.post('/api/helpdesk/data/tables/:id/records', controller.postDataTablesIdRecords);
  app.put(
    '/api/helpdesk/data/tables/:id/records/:recordId',
    controller.putDataTablesIdRecordsRecordId,
  );
  app.post('/api/helpdesk/data/conversations', controller.postDataConversations);
  app.post(
    '/api/helpdesk/data/conversations/:id/messages',
    controller.postDataConversationsIdMessages,
  );
  app.get('/api/helpdesk/data/conversations/:id', controller.getDataConversationsId);
}
