import { createGlobalSearchController } from '../../controllers/workspace/globalSearchController.js';
export function installGlobalSearch(app, store, helpdesk) {
  const controller = createGlobalSearchController(store, helpdesk);
  app.get('/api/helpdesk/global-search', controller.getGlobalSearch);
}
