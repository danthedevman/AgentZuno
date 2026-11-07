import { createRateLimiter } from '../../middleware/rateLimits.js';

import { createCustomDomainsController } from '../../controllers/identity/customDomainsController.js';
export function installCustomDomainRoutes(app, service) {
  const controller = createCustomDomainsController(service);
  app.use(
    '/api/helpdesk/domain',
    createRateLimiter(app, 'customDomainsRoutes', {
      windowMs: 60000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Try again in a minute.' },
    }),
  );
  app.get('/api/helpdesk/domain', controller.getDomain);
  app.put('/api/helpdesk/domain', controller.putDomain);
  app.post('/api/helpdesk/domain/verify', controller.postDomainVerify);
  app.put('/api/helpdesk/domain/enabled', controller.putDomainEnabled);
  app.delete('/api/helpdesk/domain', controller.deleteDomain);
}
