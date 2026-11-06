import { createRequestTasksController } from '../../controllers/requests/requestTasksController.js';
export function installRequestTaskRoutes(app, store) {
  const controller = createRequestTasksController(store);
  app.get('/api/helpdesk/tasks', controller.getTasks);
  app.get('/api/helpdesk/tasks/:taskId', controller.getTasksTaskId);
  app.get('/api/helpdesk/tasks/:taskId/assignees', controller.getTasksTaskIdAssignees);
  app.put('/api/helpdesk/tasks/:taskId', controller.putTasksTaskId);
  app.get('/api/helpdesk/requests/:id/tasks', controller.getRequestsIdTasks);
  app.post('/api/helpdesk/requests/:id/tasks', controller.postRequestsIdTasks);
  app.put('/api/helpdesk/requests/:id/tasks/:taskId', controller.putRequestsIdTasksTaskId);
}
