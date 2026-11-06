import { rateLimit } from 'express-rate-limit';

import { createConnectionOAuthController } from '../../controllers/integrations/connectionOAuthController.js';
export function installConnectionOAuthRoutes(app, store, service, fetcher = fetch) {
  const controller = createConnectionOAuthController(store, service, fetcher);
  app.use(
    '/api/connections/oauth/start',
    rateLimit({
      windowMs: 60000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Try again in a minute.' },
    }),
  );
  app.post('/api/connections/oauth/start', controller.postConnectionsOauthStart);
  app.get('/api/connections/oauth/callback', controller.getConnectionsOauthCallback);
}
