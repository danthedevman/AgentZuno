import { createRateLimiter } from '../middleware/rateLimits.js';
import { installSlackUserLinksRoutes } from './channels/slackUserLinksRoutes.js';
import { installDataRecordOperationRoutes } from './data/dataRecordOperationsRoutes.js';
import { installRecordActivityRoutes } from './records/recordActivityRoutes.js';

import { installWorkflowReferenceRoutes } from './workflows/workflowReferencesRoutes.js';

import { installArticleAttachmentRoutes } from './knowledge/articleAttachmentsRoutes.js';
import { installInvitationRoutes } from './identity/invitationsRoutes.js';
import { installKnowledgeAccessRoutes } from './knowledge/knowledgeAccessRoutes.js';
import { installApprovalGroupRoutes } from './requests/approvalTargetsRoutes.js';

import { installHelpdeskQueueRoutes } from './identity/helpdeskQueuesRoutes.js';
import { installAdminDataRoutes } from './data/adminDataRoutes.js';
import { installKnowledgeListRoutes } from './knowledge/knowledgeListsRoutes.js';
import { installProfilePictureRoutes } from './identity/profilePicturesRoutes.js';
import { installReportRoutes } from './workspace/reportsRoutes.js';
import { installWorkforceRoutes } from './identity/workforceProfilesRoutes.js';

import { installCustomDomainRoutes } from './identity/customDomainsRoutes.js';

import { installKnowledgeAnalyticsRoutes } from './knowledge/knowledgeAnalyticsRoutes.js';

import { installChatRoutes } from './chat/chatRoutes.js';
import { createHelpdeskService } from '../requests/helpdesk.js';
import { installHelpdeskRoutes } from './requests/helpdeskRoutes.js';
import { installHelpdeskWorkflowRoutes } from './workflows/helpdeskWorkflowsRoutes.js';

import { installAuditRoutes } from './audit/auditRoutes.js';
import { installHelpdeskChannelRoutes } from './channels/helpdeskChannelsRoutes.js';
import { installProvisioningRoutes } from './identity/helpdeskProvisioningRoutes.js';

import { installHelpdeskMemberRoutes } from './identity/helpdeskRolesRoutes.js';

import { installConnectionOAuthRoutes } from './integrations/connectionOAuthRoutes.js';

import { installContentRoutes } from './knowledge/contentRoutes.js';

import { installIntegrationRoutes } from './integrations/integrationsRoutes.js';
import { installIdentityRoutes } from './identity/identityRoutes.js';

import { createApplicationController } from '../controllers/applicationController.js';
const collections = {
  'knowledge-bases': 'knowledgeBases',
  articles: 'articles',
  files: 'files',
  images: 'images',
  integrations: 'integrations',
  tasks: 'tasks',
};
export function installApiRoutes(app, context) {
  const {
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
  } = context;
  const controller = createApplicationController(context);
  installContentRoutes(app, auth, store, { chats: chatService, integrations });
  installIdentityRoutes(app, integrations, auth);
  installIntegrationRoutes(app, integrations, integrationService, queues);
  installChatRoutes(app, integrations, chatService);
  installHelpdeskRoutes(app, integrations, createHelpdeskService(integrations, chatService));
  app.get('/api/helpdesk/channels/teams/bot', controller.getChannelsTeamsBot);
  app.put('/api/helpdesk/channels/teams/bot', controller.putChannelsTeamsBot);
  app.put('/api/helpdesk/channels/slack/bot', controller.putChannelsSlackBot);
  installHelpdeskMemberRoutes(app, integrations);
  installHelpdeskQueueRoutes(app, integrations);
  installWorkforceRoutes(app, integrations);
  installApprovalGroupRoutes(app, integrations);
  installReportRoutes(app, integrations);
  installProfilePictureRoutes(app, integrations);
  installAdminDataRoutes(app, integrations, chatService);
  installKnowledgeListRoutes(app, loadWorkspace);
  installKnowledgeAccessRoutes(app, integrations);
  installArticleAttachmentRoutes(app, integrations);
  installInvitationRoutes(app, integrations);
  installHelpdeskChannelRoutes(app, integrations);
  installSlackUserLinksRoutes(app, integrations);
  app.put('/api/helpdesk/channels/:provider/inbox', controller.putChannelsProviderInbox);
  installProvisioningRoutes(app, integrations);
  installCustomDomainRoutes(app, customDomains);
  installHelpdeskWorkflowRoutes(app, integrations, chatService);
  installWorkflowReferenceRoutes(app, integrations);
  installAuditRoutes(app, integrations);
  installRecordActivityRoutes(app, integrations);
  installDataRecordOperationRoutes(app, integrations);
  installKnowledgeAnalyticsRoutes(app, integrations, analytics);
  installConnectionOAuthRoutes(app, integrations, integrationService);
  app.get('/health', controller.getHealth);
  app.get('/api/integration-catalog', controller.getIntegrationCatalog);
  app.get('/api/portal', controller.getPortal);
  app.get('/api/site', controller.getSite);
  app.get('/api/auth/preferences', controller.getAuthPreferences);
  app.put('/api/auth/preferences', controller.putAuthPreferences);
  app.post('/api/auth/impersonation', controller.postAuthImpersonation);
  app.get('/api/auth/session', controller.getAuthSession);
  const loginLimit = createRateLimiter(app, 'authentication', { limit: 15 });
  app.post('/api/auth/login', loginLimit, auth.login);
  app.post('/api/auth/register', loginLimit, auth.register);
  app.get('/api/workspaces/:id', controller.getWorkspacesId);
  app.post('/api/auth/logout', auth.logout);
  app.get('/api/workspace', controller.getWorkspace);
  app.get('/api/me/workspace', controller.getMeWorkspace);
  for (const [route, key] of Object.entries(collections))
    app.get(`/api/${route}`, controller.getRoute(key));
  app.get('/api/articles/:id', controller.getArticlesId);
}
