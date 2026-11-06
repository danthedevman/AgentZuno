import { createReportsController } from '../../controllers/workspace/reportsController.js';
export function installReportRoutes(app, store) {
  const controller = createReportsController(store);
  app.get('/api/helpdesk/reports/:kind', controller.getReportsKind);
}
