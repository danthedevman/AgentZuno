import { isAllowedBrowserOrigin } from '../shared/browserOrigin.js';

import { resolveHelpdeskUser, assumeHelpdeskRole } from '../identity/helpdeskRoles.js';

import express from 'express';

export function installApplicationMiddleware(app, { auth, integrations, customDomains, options }) {
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
      request.method === 'POST' &&
      ['/api/helpdesk/recent-views', '/api/helpdesk/inbox/viewed'].includes(request.path);
    const helpdeskWrite =
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/channels\/slack\/(users\/(discover|apply)|link\/(inspect|complete))$/.test(
          request.path,
        )) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/data\/(?:deletions\/[a-f0-9]{24}\/confirm|tables\/(?:ref-[a-z-]+|[a-f0-9]{24})\/records\/[a-f0-9]{24}\/deletion-review)$/.test(
          request.path,
        )) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/record-activity\/(?:task|group|data)\/[a-f0-9]{24}$/.test(
          request.path,
        )) ||
      (request.method === 'PUT' && /^\/api\/helpdesk\/tasks\/[a-f0-9]{24}$/.test(request.path)) ||
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
      (request.method === 'PUT' && request.path === '/api/helpdesk/audit-retention') ||
      (request.method === 'POST' && request.path === '/api/helpdesk/smtp/test') ||
      (request.method === 'POST' && request.path === '/api/helpdesk/catalog-images') ||
      (['POST', 'PUT'].includes(request.method) &&
        /^\/api\/helpdesk\/groups(?:\/[a-f0-9]{24})?$/.test(request.path)) ||
      invitationWrite ||
      (request.method === 'PATCH' &&
        /^\/api\/helpdesk\/user-access\/[a-f0-9]{24}$/.test(request.path)) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/workflows\/[a-f0-9]{24}\/versions\/\d{1,9}\/restore$/.test(
          request.path,
        )) ||
      (request.method === 'POST' &&
        /^\/api\/helpdesk\/invitations\/[a-f0-9]{24}\/resend$/.test(request.path)) ||
      (request.method === 'DELETE' &&
        /^\/api\/helpdesk\/invitations\/[a-f0-9]{24}$/.test(request.path)) ||
      knowledgePermissionsWrite ||
      (request.method === 'PUT' &&
        ['/api/helpdesk/channels/slack/bot', '/api/helpdesk/channels/teams/bot'].includes(
          request.path,
        )) ||
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
      (['PUT', 'DELETE'].includes(request.method) &&
        request.path === '/api/helpdesk/profile-picture') ||
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
            request.portalDomain ? '' : process.env.APP_ADDITIONAL_ORIGINS || '',
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
          [
            '/api/helpdesk/recent-views',
            '/api/helpdesk/exports',
            '/api/helpdesk/inbox/viewed',
          ].includes(request.path)
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
}
