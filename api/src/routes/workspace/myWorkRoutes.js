import { createMyWorkController } from '../../controllers/workspace/myWorkController.js';
export function installMyWorkRoutes(app, store) {
  const controller = createMyWorkController(store);
  app.get('/api/helpdesk/my-work', controller.getMyWork);
  app.get('/api/helpdesk/my-team', controller.getMyTeam);
}
