import { createHelpdeskRolesController } from '../../controllers/identity/helpdeskRolesController.js';
export function installHelpdeskMemberRoutes(app, store) {
  const controller = createHelpdeskRolesController(store);
  app.get('/api/helpdesk/access', controller.getAccess);
  app.get('/api/helpdesk/workspaces', controller.getWorkspaces);
  app.get('/api/helpdesk/members', controller.getMembers);
  app.delete('/api/helpdesk/members/:id', controller.deleteMembersId);
  app.post('/api/helpdesk/members', controller.postMembers);
  app.put('/api/helpdesk/members/:id', controller.putMembersId);
}
