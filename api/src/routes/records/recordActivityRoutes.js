import { createRecordActivityController } from '../../controllers/records/recordActivityController.js';
export function installRecordActivityRoutes(app, store) {
  const controller = createRecordActivityController(store);
  app.get(
    '/api/helpdesk/record-activity/:kind/:id/mention-options',
    controller.getRecordActivityKindIdMentionOptions,
  );
  app.get('/api/helpdesk/record-activity/:kind/:id', controller.getRecordActivityKindId);
  app.post('/api/helpdesk/record-activity/:kind/:id', controller.postRecordActivityKindId);
}
