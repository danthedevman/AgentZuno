import { createSlackUserLinksController } from '../../controllers/channels/slackUserLinksController.js';
export function installSlackUserLinksRoutes(app, store) {
  const controller = createSlackUserLinksController(store);
  app.post('/api/helpdesk/channels/slack/users/discover', controller.discover);
  app.get('/api/helpdesk/channels/slack/users/reviews/:id', controller.page);
  app.post('/api/helpdesk/channels/slack/users/apply', controller.apply);
  app.post('/api/helpdesk/channels/slack/link/inspect', controller.inspect);
  app.post('/api/helpdesk/channels/slack/link/complete', controller.complete);
}
