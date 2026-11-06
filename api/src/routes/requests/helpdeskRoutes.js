import { installUserAccessRoutes } from './userAccessRoutes.js';
import { installMentionRoutes } from './mentionsRoutes.js';

import { installGlobalSearch } from '../workspace/globalSearchRoutes.js';

import { installRequestTaskRoutes } from './requestTasksRoutes.js';
import { installRequestAttachmentRoutes } from './requestAttachmentsRoutes.js';
import { installDemoRoutes } from '../demo/demoModeRoutes.js';

import { installMyWorkRoutes } from '../workspace/myWorkRoutes.js';

import { installBulkDeletionRoutes } from '../records/bulkDeletionRoutes.js';
import { installSmtpRoutes } from '../channels/smtpSettingsRoutes.js';
import { installCatalogImageRoutes } from '../workflows/catalogImagesRoutes.js';
import { installGroupRoutes } from '../identity/groupsRoutes.js';

import { installChatAttachmentRoutes } from '../chat/chatAttachmentsRoutes.js';

import { installRecentViewRoutes } from '../workspace/recentViewsRoutes.js';

import { createHelpdeskController } from '../../controllers/requests/helpdeskController.js';
export function installHelpdeskRoutes(app, store, service) {
  const controller = createHelpdeskController(store, service);
  app.use('/api/helpdesk', controller.useApiHelpdesk);
  app.get('/api/helpdesk/ai-status', controller.getAiStatus);
  installMyWorkRoutes(app, store);
  installUserAccessRoutes(app, store);
  installRequestAttachmentRoutes(app, store, service);
  installRequestTaskRoutes(app, store);
  installGlobalSearch(app, store, service);
  installDemoRoutes(app, store, service);
  installBulkDeletionRoutes(app, store);
  installChatAttachmentRoutes(app, store);
  installRecentViewRoutes(app, store, service);
  installGroupRoutes(app, store);
  installSmtpRoutes(app, store);
  installCatalogImageRoutes(app, store);
  app.get('/api/helpdesk/catalog', controller.getCatalog);
  app.get('/api/helpdesk/support/conversations', controller.getSupportConversations);
  app.post('/api/helpdesk/support/conversations', controller.postSupportConversations);
  app.post(
    '/api/helpdesk/support/conversations/:id/form',
    controller.postSupportConversationsIdForm,
  );
  app.post(
    '/api/helpdesk/support/conversations/:id/ticket',
    controller.postSupportConversationsIdTicket,
  );
  app.get('/api/helpdesk/support/conversations/:id', controller.getSupportConversationsId);
  app.post(
    '/api/helpdesk/support/conversations/:id/messages',
    controller.postSupportConversationsIdMessages,
  );
  app.post(
    '/api/helpdesk/support/conversations/:id/actions',
    controller.postSupportConversationsIdActions,
  );
  app.get('/api/helpdesk/chat-settings', controller.getChatSettings);
  app.put('/api/helpdesk/chat-settings', controller.putChatSettings);
  app.get('/api/helpdesk/settings', controller.getSettings);
  app.put('/api/helpdesk/settings', controller.putSettings);
  app.post('/api/helpdesk/requests/:id/review', controller.postRequestsIdReview);
  installMentionRoutes(app, store, service);
  app.get('/api/helpdesk/inbox', controller.getInbox);
  app.put('/api/helpdesk/inbox/:id', controller.putInboxId);
  app.get('/api/helpdesk/requests', controller.getRequests);
  app.post('/api/helpdesk/requests', controller.postRequests);
  app.get('/api/helpdesk/requests/:id', controller.getRequestsId);
  app.patch('/api/helpdesk/requests/:id', controller.patchRequestsId);
  for (const [path, action] of [
    ['assign-self', 'assign-self'],
    ['messages', 'message'],
    ['comments', 'message'],
    ['work-notes', 'work-note'],
    ['approvals', 'approval'],
    ['approval-decisions', 'decision'],
  ]) {
    app.post(`/api/helpdesk/requests/:id/${path}`, controller.postRequestsIdPath(path, action));
  }
  app.get('/api/helpdesk/requests/:id/drafts/:chatId', controller.getRequestsIdDraftsChatId);
  app.post('/api/helpdesk/requests/:id/drafts', controller.postRequestsIdDrafts);
}
