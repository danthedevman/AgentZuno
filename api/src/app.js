import { createWorkspaceLoader } from './workspace/workspaceLoader.js';
import { installApplicationMiddleware } from './middleware/applicationMiddleware.js';
import { installApiRoutes } from './routes/index.js';
import { installChannelEventRoutes } from './routes/channels/channelEventsRoutes.js';

import { createHelpdeskTeams } from './channels/helpdeskTeams.js';
import { createRateLimits, createRateLimiter } from './middleware/rateLimits.js';

import { installDatabaseSetupRoutes } from './routes/storage/setupRoutes.js';

import { createHelpdeskSlack } from './channels/helpdeskSlack.js';

import { createCustomDomains } from './identity/customDomains.js';

import { createKnowledgeAnalytics } from './knowledge/knowledgeAnalytics.js';

import { createQueues } from './identity/queues.js';
import { createChatService } from './chat/chat.js';

import { installAuditMiddleware } from './audit/audit.js';

import express from 'express';

import { createAuth } from './identity/auth.js';

import { createContentStore } from './knowledge/contentStore.js';

import { createIntegrationStore } from './storage/integrationStore.js';
import { createIntegrationService } from './integrations/integrations.js';

export function createApi(options = {}) {
  const app = express();
  app.locals.rateLimits = createRateLimits({
    redisUrl: options.database ? '' : process.env.REDIS_URL,
  });
  app.use(
    '/api',
    createRateLimiter(app, 'global', {
      windowMs: 60000,
      limit: 3000,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Try again shortly.' },
    }),
  );
  installDatabaseSetupRoutes(app);
  const auth = options.auth || createAuth();
  const store = createContentStore(undefined, options.database);
  const integrations = createIntegrationStore(options.database);
  const customDomains = createCustomDomains(integrations, options.domainDns);
  const loadWorkspace = createWorkspaceLoader(store, integrations);
  const integrationService = createIntegrationService(integrations, loadWorkspace);
  const queues = options.queues || createQueues();
  const chatService = createChatService(integrations, queues.chat);
  const analytics = createKnowledgeAnalytics(integrations, loadWorkspace, integrationService);
  app.locals.close = async () => {
    await Promise.allSettled([...(app.locals.auditPending || [])]);
    return Promise.all([
      store.close(),
      auth.close(),
      integrations.close(),
      queues.close(),
      app.locals.rateLimits.close(),
    ]);
  };

  app.disable('x-powered-by');
  installAuditMiddleware(app, integrations, auth, { forceStorage: Boolean(options.database) });
  const slack = createHelpdeskSlack(integrations, chatService, queues.slack);
  const teams = createHelpdeskTeams(integrations, chatService, queues.teams);
  installChannelEventRoutes(app, integrations, slack, teams);
  installApplicationMiddleware(app, { auth, integrations, customDomains, options });
  installApiRoutes(app, {
    auth,
    integrations,
    store,
    chatService,
    teams,
    slack,
    loadWorkspace,
    integrationService,
    queues,
    analytics,
    customDomains,
  });
  app.use((request, response) => response.status(404).json({ error: 'API route not found.' }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = [400, 401, 403, 404, 409, 413, 421, 422, 429, 501, 502, 503].includes(
      error.status,
    )
      ? error.status
      : 500;
    if (status === 500) console.error('API request failed:', error.message);
    response.status(status).json({
      ...(Array.isArray(error.removedFields) ? { removedFields: error.removedFields } : {}),
      error:
        error.publicMessage ||
        (status === 500
          ? 'The request could not be completed.'
          : status === 503
            ? 'MongoDB is not configured. Start the database to save content.'
            : status === 413
              ? 'The upload or article is too large.'
              : 'Invalid request.'),
    });
  });
  return app;
}
