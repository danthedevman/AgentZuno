import { installWorkflowExecutionRoutes } from './workflowExecutionRoutes.js';

import { createHelpdeskWorkflowsController } from '../../controllers/workflows/helpdeskWorkflowsController.js';
import { createWorkflowVersionsController } from '../../controllers/workflows/workflowVersionsController.js';
export function installHelpdeskWorkflowRoutes(app, store, chats) {
  const controller = createHelpdeskWorkflowsController(store, chats);
  const versions = createWorkflowVersionsController(store, chats);
  app.get('/api/helpdesk/workflows/:id/versions', versions.list);
  app.get('/api/helpdesk/workflows/:id/versions/:version', versions.read);
  app.post('/api/helpdesk/workflows/:id/versions/:version/restore', versions.restore);
  installWorkflowExecutionRoutes(app, store);
  app.post('/api/helpdesk/workflows/test', controller.postWorkflowsTest);
  app.get('/api/helpdesk/workflow-sdk', controller.getWorkflowSdk);
  app.get('/api/helpdesk/workflows', controller.getWorkflows);
  app.get('/api/helpdesk/workflows/:id/view', controller.getWorkflowsIdView);
  app.put('/api/helpdesk/workflows/:id/view', controller.putWorkflowsIdView);
  app.get('/api/helpdesk/workflow-conversations', controller.getWorkflowConversations);
  app.get('/api/helpdesk/workflow-conversations/:id', controller.getWorkflowConversationsId);
  app.post('/api/helpdesk/workflows', controller.postWorkflows);
  app.put('/api/helpdesk/workflows/:id', controller.putWorkflowsId);
  app.delete('/api/helpdesk/workflows/:id', controller.deleteWorkflowsId);
  app.post('/api/helpdesk/workflow-conversations', controller.postWorkflowConversations);
  app.post(
    '/api/helpdesk/workflow-conversations/:id/messages',
    controller.postWorkflowConversationsIdMessages,
  );
}
