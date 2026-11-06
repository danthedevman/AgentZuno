import { createAuditRetentionController } from '../../controllers/audit/auditRetentionController.js';
export function installAuditRetentionRoutes(app, store) {
  const controller = createAuditRetentionController(store);
  app.get('/api/helpdesk/audit-retention', controller.getAuditRetention);
  app.put('/api/helpdesk/audit-retention', controller.putAuditRetention);
}
