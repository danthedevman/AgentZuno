import { requireRole } from '../identity/helpdeskRoles.js';

import { createHelpdeskEmail } from '../channels/helpdeskEmail.js';

import { publicAdapter } from '../connectors/registry.js';

import { resolveHelpdeskUser, assumeHelpdeskRole } from '../identity/helpdeskRoles.js';

import { readData } from '../data/data.js';

import { requestedSections } from '../workspace/workspaceLoader.js';
export function createApplicationController({
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
}) {
  const supportEmail = createHelpdeskEmail(integrations, chatService);
  const getChannelsTeamsBot = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    response.json(await teams.settings(request.helpdeskUser));
  };
  const putChannelsTeamsBot = async (request, response) =>
    response.json(await teams.configure(request.helpdeskUser, request.body));
  const putChannelsSlackBot = async (request, response) =>
    response.json(await slack.configure(request.helpdeskUser, request.body));
  const putChannelsProviderInbox = async (request, response) =>
    response.json(
      await supportEmail.configure(request.helpdeskUser, request.params.provider, request.body),
    );
  const getHealth = (request, response) =>
    response.json({ status: 'ok', service: 'agentzuno-api' });
  const getIntegrationCatalog = async (request, response) =>
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
    );
  const getPortal = (request, response) =>
    response.json({ workspaceId: request.portalWorkspaceId || null });
  const getSite = async (request, response) => response.json(await readData('site.json'));
  const getAuthPreferences = async (request, response) => {
    if (!request.user) return response.status(401).json({ error: 'Sign in to view preferences.' });
    const account = await integrations
      .collection('users')
      .findOne({ id: request.user.id }, { projection: { listPageSize: 1 } });
    response.json({
      listPageSize: [10, 20, 50, 100].includes(account?.listPageSize) ? account.listPageSize : 20,
    });
  };
  const putAuthPreferences = async (request, response) => {
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
  };
  const postAuthImpersonation = async (request, response) => {
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
  };
  const getAuthSession = (request, response) => response.json({ user: request.user });
  const getWorkspacesId = async (request, response) => {
    if (!request.user)
      return response.status(401).json({ error: 'Sign in to open your workspace.' });
    if (request.user.workspaceId !== request.params.id)
      return response.status(403).json({ error: 'You do not have access to this workspace.' });
    response.json(await loadWorkspace(request.user, requestedSections(request)));
  };
  const getWorkspace = async (request, response) =>
    response.json(await loadWorkspace(request.user, requestedSections(request)));
  const getMeWorkspace = async (request, response) => {
    const user = request.user;
    if (!user) return response.status(401).json({ error: 'Sign in to view your own workspace.' });
    response.json(await loadWorkspace(user));
  };
  const getRoute = (key) => async (request, response) => {
    const workspace = await loadWorkspace(request.user);
    response.json(workspace[key]);
  };
  const getArticlesId = async (request, response) => {
    const workspace = await loadWorkspace(request.user);
    const article = workspace.articles.find((article) => article.id === request.params.id);
    if (!article) return response.status(404).json({ error: 'Article not found.' });
    response.json(article);
  };
  return {
    getChannelsTeamsBot,
    putChannelsTeamsBot,
    putChannelsSlackBot,
    putChannelsProviderInbox,
    getHealth,
    getIntegrationCatalog,
    getPortal,
    getSite,
    getAuthPreferences,
    putAuthPreferences,
    postAuthImpersonation,
    getAuthSession,
    getWorkspacesId,
    getWorkspace,
    getMeWorkspace,
    getRoute,
    getArticlesId,
  };
}
