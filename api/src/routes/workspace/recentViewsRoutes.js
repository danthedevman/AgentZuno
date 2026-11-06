import { createRecentViewsController } from '../../controllers/workspace/recentViewsController.js';
export function installRecentViewRoutes(app, store, helpdesk) {
  const controller = createRecentViewsController(store, helpdesk);
  app.post('/api/helpdesk/recent-views', controller.postRecentViews);
  app.get('/api/helpdesk/recent-views', controller.getRecentViews);
}
