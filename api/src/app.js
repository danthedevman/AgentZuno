import { rateLimit } from 'express-rate-limit';
import { installInteractiveDemoRoutes } from './interactiveDemo.js';
import { installWorkflowReferenceRoutes } from './workflowReferences.js';
import { installDatabaseSetupRoutes } from './storage/setup.js';
import { installArticleAttachmentRoutes } from './articleAttachments.js';
import { installInvitationRoutes } from './invitations.js';
import { installKnowledgeAccessRoutes } from './knowledgeAccess.js';
import { installApprovalGroupRoutes } from './approvalTargets.js';
import { slackSigningSecret } from './channelApplications.js';
import { createHelpdeskSlack, verifySlackSignature } from './helpdeskSlack.js';
import { installHelpdeskQueueRoutes } from './helpdeskQueues.js';
import { installAdminDataRoutes } from './adminData.js';
import { installKnowledgeListRoutes } from './knowledgeLists.js';
import { installProfilePictureRoutes } from './profilePictures.js';
import { installReportRoutes } from './reports.js';
import { installWorkforceRoutes } from './workforceProfiles.js';
import { createCustomDomains, installCustomDomainRoutes } from './customDomains.js';
import { isAllowedBrowserOrigin } from './browserOrigin.js';
import { createHelpdeskEmail } from './helpdeskEmail.js';
import { createKnowledgeAnalytics, installKnowledgeAnalyticsRoutes } from './knowledgeAnalytics.js';
import { publicAdapter } from './connectors/registry.js';
import { createQueues } from './queues.js';
import { createChatService, installChatRoutes } from './chat.js';
import { createHelpdeskService, installHelpdeskRoutes } from './helpdesk.js';
import { installHelpdeskWorkflowRoutes } from './helpdeskWorkflows.js';
import { installAuditMiddleware, installAuditRoutes } from './audit.js';
import { installHelpdeskChannelRoutes } from './helpdeskChannels.js';
import { installProvisioningRoutes } from './helpdeskProvisioning.js';
import {
  resolveHelpdeskUser,
  assumeHelpdeskRole,
  installHelpdeskMemberRoutes,
} from './helpdeskRoles.js';
import express from 'express';
import { installConnectionOAuthRoutes } from './connectionOAuth.js';
import { createServer } from 'node:http';
import { createAuth } from './auth.js';
import { readData, readWorkspace } from './data.js';
import { createContentStore } from './contentStore.js';
import { installContentRoutes } from './content.js';
import { createIntegrationStore } from './integrationStore.js';
import { createIntegrationService, installIntegrationRoutes } from './integrations.js';
import { installIdentityRoutes } from './identity.js';
import { safeConnection } from './permissions.js';

const collections = {
  'knowledge-bases': 'knowledgeBases',
  articles: 'articles',
  files: 'files',
  images: 'images',
  integrations: 'integrations',
  tasks: 'tasks',
};

export function createApi(options = {}) {
  const app = express();
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 3000,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Try again shortly.' },
    }),
  );
  app.locals.isInteractiveDemo = options.isInteractiveDemo === true;
  if (!options.isInteractiveDemo) {
    installDatabaseSetupRoutes(app);
    installInteractiveDemoRoutes(app, createApi);
    app.use('/api', (request, response, next) => {
      try {
        if (
          request.headers.referer &&
          /^\/demo(?:\/|$)/.test(new URL(request.headers.referer).pathname) &&
          !request.path.startsWith('/demo')
        )
          return response
            .status(403)
            .json({ error: 'Interactive demo actions must use isolated demo storage.' });
      } catch {}
      next();
    });
  }
  app.get('/api/demo', async (request, response) =>
    response.json(await readData('interactive-demo.json')),
  );
  const auth = options.auth || createAuth();
  const store = createContentStore(undefined, options.database);
  const integrations = createIntegrationStore(options.database);
  const customDomains = createCustomDomains(integrations, options.domainDns);
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
      app.locals.closeInteractiveDemo?.(),
    ]);
  };
  async function loadWorkspace(user, requestedSections, metadataOnly = false) {
    const sections = new Set(
      requestedSections || [
        'articles',
        'knowledgeBases',
        'files',
        'images',
        'integrations',
        'tasks',
        'topics',
      ],
    );
    const workspace = await readWorkspace(user);
    workspace.topics ||= [];
    if (user?.helpdeskRolePreview)
      return {
        ...workspace,
        articles: [],
        files: [],
        images: [],
        knowledgeBases: [],
        integrations: [],
        topics: [],
      };
    if (user) workspace.id = user.workspaceId;
    if (user) {
      if (sections.has('articles'))
        workspace.articles.unshift(...(await store.articles(user.id, metadataOnly)));
      const keys = {
        'knowledge-base': 'knowledgeBases',
        file: 'files',
        connection: 'integrations',
        topic: 'topics',
      };
      for (const connection of sections.has('integrations')
        ? await integrations.connections(user.id)
        : [])
        workspace.integrations.unshift({
          ...safeConnection(connection),
          type: 'connection',
          description:
            connection.permissionMode === 'managed'
              ? 'AgentZuno-managed private copy'
              : 'Source-enforced access',
        });
      const types = Object.keys(keys).filter((type) => sections.has(keys[type]));
      for (const record of types.length ? await store.records(user.id, types) : [])
        if (keys[record.type]) {
          const items = workspace[keys[record.type]];
          const index = items.findIndex((item) => item.id === record.id);
          if (index < 0) items.unshift(record);
          else items.splice(index, 1, record);
        }
    }
    for (const section of [
      'articles',
      'knowledgeBases',
      'files',
      'images',
      'integrations',
      'tasks',
      'topics',
    ])
      if (!sections.has(section)) workspace[section] = [];
    return workspace;
  }
  function requestedSections(request) {
    if (request.query.sections === undefined) return undefined;
    if (request.query.sections === 'none') return [];
    if (typeof request.query.sections !== 'string' || request.query.sections.length > 150)
      throw Object.assign(new Error('Invalid workspace sections.'), { status: 400 });
    const sections = request.query.sections.split(',');
    if (
      sections.some(
        (section) =>
          ![
            'articles',
            'knowledgeBases',
            'files',
            'images',
            'integrations',
            'tasks',
            'topics',
          ].includes(section),
      )
    )
      throw Object.assign(new Error('Invalid workspace sections.'), { status: 400 });
    return sections;
  }
  app.disable('x-powered-by');
  installAuditMiddleware(app, integrations, auth, { forceStorage: Boolean(options.database) });
  const slack = createHelpdeskSlack(integrations, chatService, queues.slack);
  app.post(
    ['/api/helpdesk/channels/slack/events', '/api/helpdesk/channels/slack/events/:workspaceId'],
    express.raw({ type: 'application/json', limit: '128kb' }),
    async (request, response) => {
      verifySlackSignature(
        request.body,
        request.headers,
        await slackSigningSecret(integrations, request.params.workspaceId),
      );
      let body;
      try {
        body = JSON.parse(request.body.toString('utf8'));
      } catch {
        return response.status(400).json({ error: 'Invalid Slack event.' });
      }
      response.json(await slack.receive(body, request.params.workspaceId));
    },
  );
  app.use(async (request, response, next) => {
    if (!request.path.startsWith('/api/')) return next();
    let host;
    try {
      const authority = new URL(`http://${request.headers.host || ''}`);
      if (
        authority.username ||
        authority.password ||
        authority.pathname !== '/' ||
        authority.search ||
        authority.hash
      )
        throw new Error('Invalid host');
      host = authority.hostname.toLowerCase();
    } catch {
      return response.status(400).json({ error: 'Invalid host.' });
    }
    const portal = await customDomains.resolve(host);
    if (portal) {
      request.portalDomain = portal.domain;
      request.portalWorkspaceId = portal.workspaceId;
    }
    const pathWorkspace = /^\/api\/workspaces\/([a-f0-9]{24})(?:\/|$)/.exec(request.path)?.[1];
    if (portal && pathWorkspace && pathWorkspace !== portal.workspaceId)
      return response.status(403).json({ error: 'This portal belongs to another workspace.' });
    if (
      portal &&
      [
        '/api/auth/oidc/start',
        '/api/connections/oauth/start',
        '/api/helpdesk/channels/oauth/start',
      ].includes(request.path)
    )
      return response.status(409).json({
        error:
          'Start identity and integration OAuth setup from the canonical application hostname.',
      });
    if (
      portal &&
      request.headers['x-workspace-id'] &&
      request.headers['x-workspace-id'] !== portal.workspaceId
    )
      return response.status(403).json({ error: 'This portal belongs to another workspace.' });
    next();
  });
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const authPost =
      request.method === 'POST' &&
      [
        '/api/auth/register',
        '/api/auth/login',
        '/api/auth/logout',
        '/api/auth/impersonation',
        '/api/articles',
        '/api/uploads/images',
        '/api/uploads/files',
        '/api/records/knowledge-base',
        '/api/records/file',
        '/api/records/connection',
        '/api/topics',
        '/api/knowledge/views',
        '/api/settings/identity',
        '/api/settings/ai',
        '/api/chats',
        '/api/connections',
        '/api/connections/import',
        '/api/connections/import-endpoint',
        '/api/connections/oauth/start',
        '/api/knowledge/browser-search',
      ].includes(request.path);
    const recordUpdate =
      request.method === 'PATCH' &&
      /^\/api\/(?:records\/(?:knowledge-base|file|connection)\/[a-f0-9]{24}|topics\/[a-f0-9]{24}|connections\/[a-f0-9]{24})$/.test(
        request.path,
      );
    const articleUpdate =
      request.method === 'PATCH' &&
      /^\/api\/articles\/[a-f0-9]{24}(?:\/status)?$/.test(request.path);
    const integrationAction =
      request.method === 'POST' &&
      /^\/api\/(?:chats\/[a-f0-9]{24}\/messages|connections\/[a-f0-9]{24}\/(?:sync|disconnect|permissions)\/(?:tokens|access)\/revoke)$/.test(
        request.path,
      );
    const provisioningWrite =
      /^(?:POST|PUT|PATCH|DELETE)$/.test(request.method) &&
      /^\/api\/provisioning\/[a-f0-9]{24}\/scim\/v2\/Users(?:\/[a-f0-9]{24})?$/.test(request.path);
    const preferenceWrite = request.method === 'PUT' && request.path === '/api/auth/preferences';
    const invitationWrite =
      request.method === 'POST' &&
      [
        '/api/helpdesk/invitations',
        '/api/helpdesk/invitations/accept',
        '/api/helpdesk/article-attachments',
      ].includes(request.path);
    const knowledgePermissionsWrite =
      request.method === 'PUT' &&
      /^\/api\/helpdesk\/knowledge-permissions\/(?:base|topic|article)\/[a-f0-9]{24}$/.test(
        request.path,
      );
    const personalViewWrite =
      request.method === 'POST' && request.path === '/api/helpdesk/recent-views';
    const helpdeskWrite =
      (['POST', 'PUT'].includes(request.method) &&
        /^\/api\/helpdesk\/requests\/[a-f0-9]{24}\/tasks(?:\/[a-f0-9]{24})?$/.test(request.path)) ||
      (request.method === 'PUT' &&
        /^\/api\/helpdesk\/workflows\/[a-f0-9]{24}\/view$/.test(request.path)) ||
      (request.method === 'DELETE' &&
        /^\/api\/helpdesk\/(?:members\/[a-f0-9]{24}|data\/tables\/(?:ref-[a-z-]+|[a-f0-9]{24}))$/.test(
          request.path,
        )) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/request-attachments\/[a-f0-9]{24}$/.test(request.path)) ||
      (request.method === 'PUT' && request.path === '/api/helpdesk/demo/settings') ||
      (request.method === 'POST' && request.path === '/api/helpdesk/exports') ||
      personalViewWrite ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/(?:requests|articles)\/bulk-delete$/.test(request.path)) ||
      (request.method === 'PUT' && request.path === '/api/helpdesk/smtp') ||
      (request.method === 'POST' && request.path === '/api/helpdesk/smtp/test') ||
      (request.method === 'POST' && request.path === '/api/helpdesk/catalog-images') ||
      (['POST', 'PUT'].includes(request.method) &&
        /^\/api\/helpdesk\/groups(?:\/[a-f0-9]{24})?$/.test(request.path)) ||
      invitationWrite ||
      knowledgePermissionsWrite ||
      (request.method === 'PUT' && request.path === '/api/helpdesk/channels/slack/bot') ||
      (['POST', 'PUT'].includes(request.method) &&
        /^\/api\/helpdesk\/queues(?:\/[a-f0-9]{24})?$/.test(request.path)) ||
      (['POST', 'PUT'].includes(request.method) &&
        /^\/api\/helpdesk\/data\/(?:tables(?:\/(?:ref-(?:department|location|organization|division|cost-center|asset|asset-model|application|vendor|contract|service|license|catalog-category|user|queue|group|workflow|task|request)|[a-f0-9]{24})(?:\/records(?:\/[a-f0-9]{24})?)?)?|conversations(?:\/[a-f0-9]{24}\/messages)?)$/.test(
          request.path,
        )) ||
      (request.method === 'PUT' &&
        /^\/api\/helpdesk\/workforce-profiles\/[a-f0-9]{24}(?:\/cover)?$/.test(request.path)) ||
      (request.method === 'POST' && request.path === '/api/helpdesk/reference-records') ||
      (['PUT', 'DELETE'].includes(request.method) && request.path === '/api/helpdesk/domain') ||
      (request.method === 'POST' && request.path === '/api/helpdesk/domain/verify') ||
      (request.method === 'PUT' && request.path === '/api/helpdesk/domain/enabled') ||
      (request.method === 'PUT' && /^\/api\/helpdesk\/inbox\/[a-f0-9]{24}$/.test(request.path)) ||
      (request.method === 'POST' && request.path === '/api/helpdesk/chat-attachments') ||
      (request.method === 'PUT' && request.path === '/api/helpdesk/profile-picture') ||
      (request.method === 'PUT' && request.path === '/api/helpdesk/chat-settings') ||
      (request.method === 'PUT' &&
        /^\/api\/helpdesk\/channels\/(slack|teams|gmail|outlook)\/(application|actions)$/.test(
          request.path,
        )) ||
      (request.method === 'PUT' &&
        /^\/api\/helpdesk\/channels\/(gmail|outlook)\/inbox$/.test(request.path)) ||
      (request.method === 'POST' && request.path === '/api/helpdesk/support/conversations') ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/support\/conversations\/[a-f0-9]{24}\/(messages|ticket|form|actions)$/.test(
          request.path,
        )) ||
      (request.method === 'POST' &&
        ['/api/helpdesk/channels/oauth/start', '/api/helpdesk/provisioning/token'].includes(
          request.path,
        )) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/channels\/(slack|teams|gmail|outlook)\/disconnect$/.test(
          request.path,
        )) ||
      (request.method === 'POST' && request.path === '/api/helpdesk/members') ||
      (request.method === 'PUT' && /^\/api\/helpdesk\/members\/[a-f0-9]{24}$/.test(request.path)) ||
      (request.method === 'POST' &&
        [
          '/api/helpdesk/workflows',
          '/api/helpdesk/workflows/test',
          '/api/helpdesk/workflow-conversations',
        ].includes(request.path)) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/workflow-runs\/[a-f0-9]{64}\/decisions$/.test(request.path)) ||
      (request.method === 'PUT' &&
        /^\/api\/helpdesk\/workflows\/[a-f0-9]{24}$/.test(request.path)) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/workflow-conversations\/[a-f0-9]{24}\/(messages|ticket)$/.test(
          request.path,
        )) ||
      (request.method === 'PUT' && request.path === '/api/helpdesk/settings') ||
      (request.method === 'POST' &&
        ['/api/helpdesk/article-conversations', '/api/helpdesk/article-proposals'].includes(
          request.path,
        )) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/(?:article-conversations\/[a-f0-9]{24}\/messages|article-proposals\/[a-f0-9]{24}\/approve)$/.test(
          request.path,
        )) ||
      (request.method === 'POST' && request.path === '/api/helpdesk/approval-groups') ||
      (request.method === 'PUT' &&
        /^\/api\/helpdesk\/approval-groups\/[a-f0-9]{24}$/.test(request.path)) ||
      (request.method === 'POST' && request.path === '/api/helpdesk/requests') ||
      (request.method === 'PATCH' &&
        /^\/api\/helpdesk\/requests\/[a-f0-9]{24}$/.test(request.path)) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/requests\/[a-f0-9]{24}\/(messages|comments|work-notes|approvals|approval-decisions|drafts|review|assign-self)$/.test(
          request.path,
        ));
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      !authPost &&
      !preferenceWrite &&
      !articleUpdate &&
      !recordUpdate &&
      !helpdeskWrite &&
      !provisioningWrite &&
      !integrationAction
    )
      return response.status(405).set('Allow', 'GET, HEAD').json({ error: 'Method not allowed.' });
    next();
  });
  app.use((request, response, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        (origin &&
          !isAllowedBrowserOrigin(
            origin,
            request.portalDomain
              ? `https://${request.portalDomain}`
              : process.env.APP_ORIGIN || 'http://localhost:3000',
          )) ||
        request.headers['sec-fetch-site'] === 'cross-site'
      )
        return response.status(403).json({ error: 'Cross-origin writes are not allowed.' });
    }
    next();
  });
  app.use((request, response, next) => {
    const isPublic = [
      '/api/portal',
      '/api/site',
      '/api/auth/session',
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/oidc/provider',
      '/api/auth/oidc/start',
      '/api/auth/oidc/callback',
    ].includes(request.path);
    const hasDedicatedAuth = request.path.startsWith('/api/provisioning/');
    if (request.path.startsWith('/api/') && !isPublic && !hasDedicatedAuth && !request.user)
      return response.status(401).json({ error: 'Sign in to access the workspace.' });
    next();
  });
  app.use(async (request, response, next) => {
    if (
      request.portalWorkspaceId &&
      !request.headers['x-workspace-id'] &&
      [
        '/api/portal',
        '/api/site',
        '/api/auth/session',
        '/api/auth/register',
        '/api/auth/login',
        '/api/auth/logout',
      ].includes(request.path)
    )
      return next();
    const workspaceId =
      request.headers['x-workspace-id'] ||
      request.portalWorkspaceId ||
      (request.method === 'GET' && request.path.startsWith('/api/helpdesk/article-attachments/')
        ? request.query.workspace
        : undefined);
    const impersonation = request.user?.impersonation;
    const controlsImpersonation = [
      '/api/auth/impersonation',
      '/api/auth/preferences',
      '/api/auth/session',
      '/api/auth/logout',
    ].includes(request.path);
    if (
      impersonation &&
      !controlsImpersonation &&
      workspaceId &&
      workspaceId !== impersonation.workspaceId
    )
      return response.status(403).json({ error: 'Return to Admin before changing workspaces.' });
    const effectiveWorkspaceId = impersonation?.workspaceId || workspaceId;
    const effectiveRole = impersonation?.role || request.headers['x-helpdesk-role'];
    if (controlsImpersonation) return next();

    if (request.path.startsWith('/api/helpdesk/') || request.path === '/api/helpdesk') {
      request.helpdeskUser = assumeHelpdeskRole(
        await resolveHelpdeskUser(
          integrations,
          request.user,
          effectiveWorkspaceId || request.user?.workspaceId,
        ),
        effectiveRole,
      );
      if (
        request.helpdeskUser.role === 'read-only' &&
        !(
          request.method === 'POST' &&
          ['/api/helpdesk/recent-views', '/api/helpdesk/exports'].includes(request.path)
        )
      ) {
        if (!['GET', 'HEAD'].includes(request.method))
          return response.status(403).json({ error: 'Read Only access does not allow changes.' });
        request.helpdeskUser.readOnlyRequest = true;
      }
      return next();
    }
    if (
      effectiveRole ||
      (request.user &&
        !request.path.startsWith('/api/auth/') &&
        (await integrations.collection('helpdeskMembers').findOne({
          userId: request.user.id,
          workspaceId: workspaceId || request.user.workspaceId,
          active: true,
          role: 'read-only',
        })))
    ) {
      const actor = await resolveHelpdeskUser(
        integrations,
        request.user,
        effectiveWorkspaceId || request.user?.workspaceId,
      );
      const effective = assumeHelpdeskRole(actor, effectiveRole);
      request.helpdeskUser = effective;
      if (effective.role === 'read-only') {
        if (!['GET', 'HEAD'].includes(request.method) || /oauth|sync|token|scan/.test(request.path))
          return response.status(403).json({ error: 'Read Only access does not allow changes.' });
        effective.readOnlyRequest = true;
      }
      if (
        effective.isImpersonating &&
        (!['GET', 'HEAD'].includes(request.method) ||
          !/^\/api\/(?:workspace|workspaces\/[a-f0-9]{24})$/.test(request.path))
      )
        return response
          .status(403)
          .json({ error: 'This action is unavailable while impersonating this role.' });
      if (effective.isImpersonating)
        request.user = { ...request.user, helpdeskRolePreview: effective.role };
    }
    if (workspaceId && (!request.user || request.user.workspaceId !== workspaceId))
      return response
        .status(request.user ? 403 : 401)
        .json({ error: 'You do not have access to this workspace.' });
    next();
  });
  app.use(
    '/api/helpdesk/chat-attachments',
    express.raw({ type: 'application/octet-stream', limit: '100kb' }),
  );
  app.use(
    '/api/helpdesk/article-attachments',
    express.raw({ type: 'application/octet-stream', limit: '10mb' }),
  );
  app.use(
    '/api/helpdesk/request-attachments',
    express.raw({ type: 'application/octet-stream', limit: '10mb' }),
  );
  app.use('/api/uploads/files', express.raw({ type: 'application/octet-stream', limit: '5mb' }));
  app.use(
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], limit: '5mb' }),
  );
  app.use('/api/connections/import', express.json({ limit: '5mb' }));
  app.use(express.json({ type: ['application/json', 'application/scim+json'], limit: '256kb' }));
  app.use(async (request, response, next) => {
    if (
      request.user &&
      /^\/api\/(connections|settings\/identity|auth\/oidc)/.test(request.path) &&
      request.method === 'POST'
    )
      await integrations.ready();
    next();
  });
  installContentRoutes(app, auth, store, { chats: chatService, integrations });
  installIdentityRoutes(app, integrations, auth);
  installIntegrationRoutes(app, integrations, integrationService, queues);
  installChatRoutes(app, integrations, chatService);
  installHelpdeskRoutes(app, integrations, createHelpdeskService(integrations, chatService));
  app.put('/api/helpdesk/channels/slack/bot', async (request, response) =>
    response.json(await slack.configure(request.helpdeskUser, request.body)),
  );
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
  const supportEmail = createHelpdeskEmail(integrations, chatService);
  app.put('/api/helpdesk/channels/:provider/inbox', async (request, response) =>
    response.json(
      await supportEmail.configure(request.helpdeskUser, request.params.provider, request.body),
    ),
  );
  installProvisioningRoutes(app, integrations);
  installCustomDomainRoutes(app, customDomains);
  installHelpdeskWorkflowRoutes(app, integrations, chatService);
  installWorkflowReferenceRoutes(app, integrations);
  installAuditRoutes(app, integrations);
  installKnowledgeAnalyticsRoutes(app, integrations, analytics);
  installConnectionOAuthRoutes(app, integrations, integrationService);
  app.get('/health', (request, response) =>
    response.json({ status: 'ok', service: 'agentzuno-api' }),
  );
  app.get('/api/integration-catalog', async (request, response) =>
    response.json(
      (await readData('integration-catalog.json'))
        .map((app) => ({ ...app, ...publicAdapter(app.id) }))
        .filter((app) =>
          typeof request.query.provider === 'string'
            ? app.id === 'custom' && app.id === request.query.provider
            : app.id === 'custom',
        )
        .sort((first, second) =>
          first.name.localeCompare(second.name, 'en', { sensitivity: 'base', numeric: true }),
        ),
    ),
  );
  app.get('/api/portal', (request, response) =>
    response.json({ workspaceId: request.portalWorkspaceId || null }),
  );
  app.get('/api/site', async (request, response) => response.json(await readData('site.json')));
  app.get('/api/auth/preferences', async (request, response) => {
    if (!request.user) return response.status(401).json({ error: 'Sign in to view preferences.' });
    const account = await integrations
      .collection('users')
      .findOne({ id: request.user.id }, { projection: { listPageSize: 1 } });
    response.json({
      listPageSize: [10, 20, 50, 100].includes(account?.listPageSize) ? account.listPageSize : 20,
    });
  });
  app.put('/api/auth/preferences', async (request, response) => {
    if (!request.user) return response.status(401).json({ error: 'Sign in to save preferences.' });
    if (
      !request.body ||
      Object.keys(request.body).some((key) => key !== 'listPageSize') ||
      ![10, 20, 50, 100].includes(request.body.listPageSize)
    )
      return response.status(400).json({ error: 'Choose 10, 20, 50, or 100 records per page.' });
    await integrations
      .collection('users')
      .updateOne({ id: request.user.id }, { $set: { listPageSize: request.body.listPageSize } });
    response.json({ listPageSize: request.body.listPageSize });
  });
  app.post('/api/auth/impersonation', async (request, response) => {
    const { role, workspaceId } = request.body || {};
    if (
      !['admin', 'agent', 'user', 'read-only'].includes(role) ||
      typeof workspaceId !== 'string' ||
      Object.keys(request.body).some((key) => !['role', 'workspaceId'].includes(key))
    )
      return response.status(400).json({ error: 'Choose a valid role and workspace.' });
    const actor = await resolveHelpdeskUser(integrations, request.user, workspaceId);
    const effective = assumeHelpdeskRole(actor, role);
    request.helpdeskUser = effective;
    await auth.setImpersonation(request, role === 'admin' ? null : { role, workspaceId });
    response.json({ role, workspaceId });
  });
  app.get('/api/auth/session', (request, response) => response.json({ user: request.user }));
  app.post('/api/auth/login', auth.login);
  app.post('/api/auth/register', auth.register);
  app.get('/api/workspaces/:id', async (request, response) => {
    if (!request.user)
      return response.status(401).json({ error: 'Sign in to open your workspace.' });
    if (request.user.workspaceId !== request.params.id)
      return response.status(403).json({ error: 'You do not have access to this workspace.' });
    response.json(await loadWorkspace(request.user, requestedSections(request)));
  });
  app.post('/api/auth/logout', auth.logout);
  app.get('/api/workspace', async (request, response) =>
    response.json(await loadWorkspace(request.user, requestedSections(request))),
  );
  app.get('/api/me/workspace', async (request, response) => {
    const user = request.user;
    if (!user) return response.status(401).json({ error: 'Sign in to view your own workspace.' });
    response.json(await loadWorkspace(user));
  });
  for (const [route, key] of Object.entries(collections))
    app.get(`/api/${route}`, async (request, response) => {
      const workspace = await loadWorkspace(request.user);
      response.json(workspace[key]);
    });
  app.get('/api/articles/:id', async (request, response) => {
    const workspace = await loadWorkspace(request.user);
    const article = workspace.articles.find((article) => article.id === request.params.id);
    if (!article) return response.status(404).json({ error: 'Article not found.' });
    response.json(article);
  });
  app.use((request, response) => response.status(404).json({ error: 'API route not found.' }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = [400, 401, 403, 404, 409, 413, 421, 422, 429, 501, 503].includes(error.status)
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

export function createApiServer() {
  const app = createApi();
  const server = createServer(app);
  server.on('close', () => app.locals.close());
  return server;
}
