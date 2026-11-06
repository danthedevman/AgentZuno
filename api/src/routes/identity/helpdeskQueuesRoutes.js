import { createHelpdeskQueuesController } from '../../controllers/identity/helpdeskQueuesController.js';
export function installHelpdeskQueueRoutes(app, store) {
  const controller = createHelpdeskQueuesController(store);
  app.get('/api/helpdesk/queues', controller.getQueues);
  app.get('/api/helpdesk/queues/:id', controller.getQueuesId);
  app.post('/api/helpdesk/queues', controller.save);
  app.put('/api/helpdesk/queues/:id', controller.save);
}
