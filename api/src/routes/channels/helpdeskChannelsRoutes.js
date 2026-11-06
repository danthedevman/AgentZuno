import { createHelpdeskChannelsController } from '../../controllers/channels/helpdeskChannelsController.js';
export function installHelpdeskChannelRoutes(app, store) {
  const controller = createHelpdeskChannelsController(store);
  app.put('/api/helpdesk/channels/:provider/actions', controller.putChannelsProviderActions);
  app.put(
    '/api/helpdesk/channels/:provider/application',
    controller.putChannelsProviderApplication,
  );
  app.get('/api/helpdesk/channels/slack/manifest', controller.getChannelsSlackManifest);
  app.get('/api/helpdesk/channels', controller.getChannels);
  app.post('/api/helpdesk/channels/oauth/start', controller.postChannelsOauthStart);
  app.get('/api/helpdesk/channels/oauth/callback', controller.getChannelsOauthCallback);
  app.post(
    '/api/helpdesk/channels/:provider/disconnect',
    controller.postChannelsProviderDisconnect,
  );
}
