import { createGroupsController } from '../../controllers/identity/groupsController.js';
export function installGroupRoutes(app, store) {
  const controller = createGroupsController(store);
  app.get('/api/helpdesk/groups', controller.getGroups);
  app.get('/api/helpdesk/groups/:id', controller.getGroupsId);
  app.post('/api/helpdesk/groups', controller.save);
  app.put('/api/helpdesk/groups/:id', controller.save);
}
