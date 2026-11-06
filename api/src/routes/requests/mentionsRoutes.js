import { createMentionsController } from '../../controllers/requests/mentionsController.js';
export function installMentionRoutes(app, store, service) {
  const controller = createMentionsController(store, service);
  app.get('/api/helpdesk/requests/:id/mention-options', controller.getRequestsIdMentionOptions);
  app.get('/api/helpdesk/inbox/unread', controller.getInboxUnread);
  app.post('/api/helpdesk/inbox/viewed', controller.postInboxViewed);
}
