import { installAuditRetentionRoutes } from './auditRetentionRoutes.js';

import { createAuditController } from '../../controllers/audit/auditController.js';
export function installAuditRoutes(app, store) {
  const controller = createAuditController(store);
  installAuditRetentionRoutes(app, store);
  app.post('/api/helpdesk/exports', controller.postExports);
  app.get('/api/helpdesk/audit/workflows', controller.getAuditWorkflows);
  app.get('/api/helpdesk/audit/:id', controller.getAuditId);
  app.get('/api/helpdesk/audit/:id/events', controller.getAuditIdEvents);
  app.get('/api/helpdesk/audit', controller.getAudit);
}
