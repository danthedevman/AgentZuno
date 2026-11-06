import { createApprovalTargetsController } from '../../controllers/requests/approvalTargetsController.js';
export function installApprovalGroupRoutes(app, store) {
  const controller = createApprovalTargetsController(store);
  app.get('/api/helpdesk/approval-groups', controller.getApprovalGroups);
  app.get('/api/helpdesk/approval-groups/:id', controller.getApprovalGroupsId);
  app.post('/api/helpdesk/approval-groups', controller.save);
  app.put('/api/helpdesk/approval-groups/:id', controller.save);
}
