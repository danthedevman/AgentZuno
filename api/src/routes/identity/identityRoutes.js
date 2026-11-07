import { createRateLimiter } from '../../middleware/rateLimits.js';

import { createIdentityController } from '../../controllers/identity/identityController.js';
export function installIdentityRoutes(app, store, auth) {
  const controller = createIdentityController(store, auth);
  app.use(
    '/api/auth/oidc',
    createRateLimiter(app, 'identityRoutes', {
      windowMs: 60000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Try again in a minute.' },
    }),
  );
  app.get('/api/identity-providers', controller.getIdentityProviders);
  app.get('/api/settings/identity', controller.requireUser, controller.getSettingsIdentity);
  app.post('/api/settings/identity', controller.requireUser, controller.postSettingsIdentity);
  app.get('/api/auth/oidc/provider', controller.getAuthOidcProvider);
  app.get('/api/auth/oidc/start', controller.getAuthOidcStart);
  app.get('/api/auth/oidc/callback', controller.getAuthOidcCallback);
}
