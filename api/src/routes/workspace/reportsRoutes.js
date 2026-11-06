import { createChatReportsController } from '../../controllers/workspace/chatReportsController.js';
import { createReportsController } from '../../controllers/workspace/reportsController.js';
export function installReportRoutes(app, store) {
  const chatReports = createChatReportsController(store);
  app.get('/api/helpdesk/report-chats', chatReports.list);
  app.get('/api/helpdesk/report-chats/:id', chatReports.get);
  const controller = createReportsController(store);
  app.get('/api/helpdesk/reports/:kind', controller.getReportsKind);
}
