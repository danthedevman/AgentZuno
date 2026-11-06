import { createDemoModeController } from '../../controllers/demo/demoModeController.js';
export function installDemoRoutes(app, store, service) {
  const controller = createDemoModeController(store, service);
  app.get('/api/helpdesk/demo/settings', controller.getDemoSettings);
  app.get('/api/helpdesk/demo/removal-preview', controller.getDemoRemovalPreview);
  app.put('/api/helpdesk/demo/settings', controller.putDemoSettings);
}
