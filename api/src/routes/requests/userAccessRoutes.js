import { createUserAccessController } from '../../controllers/requests/userAccessController.js';
export function installUserAccessRoutes(app, store) {
  const controller = createUserAccessController(store);
  app.get('/api/helpdesk/user-access', controller.list);
  app.get('/api/helpdesk/user-access/:id', controller.get);
  app.patch('/api/helpdesk/user-access/:id', controller.change);
}
