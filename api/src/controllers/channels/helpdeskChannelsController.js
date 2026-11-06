import { saveConnectorActions } from '../../integrations/connectorActions.js';
import { saveChannelApplication } from '../../channels/channelApplications.js';
import { listResponse } from '../../shared/listQuery.js';

import { requireRole } from '../../identity/helpdeskRoles.js';
import { channelProviders, createHelpdeskChannels } from '../../channels/helpdeskChannels.js';
export function createHelpdeskChannelsController(store) {
  const service = createHelpdeskChannels(store);
  const putChannelsProviderActions = async (request, response) =>
    response.json(
      await saveConnectorActions(
        store,
        request.helpdeskUser,
        request.params.provider,
        request.body,
      ),
    );
  const putChannelsProviderApplication = async (request, response) =>
    response.json(
      await saveChannelApplication(
        store,
        request.helpdeskUser,
        request.params.provider,
        request.body,
      ),
    );
  const getChannelsSlackManifest = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
    response.json({
      display_information: {
        name: 'Zuno',
        description: 'Conversational employee support',
        background_color: '#07111b',
      },
      features: {
        bot_user: { display_name: 'Zuno', always_online: false },
        app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      },
      oauth_config: {
        redirect_urls: [`${origin}/api/helpdesk/channels/oauth/callback`],
        scopes: {
          bot: [...channelProviders.slack.scope.split(' '), 'users:read', 'users:read.email'],
        },
      },
      settings: {
        interactivity: {
          is_enabled: true,
          request_url: `${origin}/api/helpdesk/channels/slack/interactions/${request.helpdeskUser.workspaceId}`,
        },
        event_subscriptions: {
          request_url: `${origin}/api/helpdesk/channels/slack/events/${request.helpdeskUser.workspaceId}`,
          bot_events: ['app_mention', 'message.channels', 'message.groups', 'message.im'],
        },
        org_deploy_enabled: false,
        socket_mode_enabled: false,
        token_rotation_enabled: false,
      },
    });
  };
  const getChannels = async (request, response) =>
    response.json(
      listResponse(request, await service.list(request.helpdeskUser), {
        Connector: 'name',
        Status: 'status',
        Setup: (item) => (item.configured ? 'Configured' : 'Setup Required'),
        Delivery: 'deliveryStatus',
      }),
    );
  const postChannelsOauthStart = async (request, response) => {
    const result = await service.start(request.helpdeskUser, request.body);
    response.cookie('zuno_channel_oauth', result.browser, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 600000,
      path: '/api/helpdesk/channels/oauth',
    });
    response.json({ url: result.url });
  };
  const getChannelsOauthCallback = async (request, response) => {
    const browser = request.headers.cookie
      ?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('zuno_channel_oauth='))
      ?.slice('zuno_channel_oauth='.length);
    const user = await service.complete(request.user, request.query, browser);
    request.helpdeskUser = user;
    response.clearCookie('zuno_channel_oauth', { path: '/api/helpdesk/channels/oauth' });
    response.redirect(303, `/workspace/${user.workspaceId}/connectors`);
  };
  const postChannelsProviderDisconnect = async (request, response) =>
    response.json(await service.disconnect(request.helpdeskUser, request.params.provider));
  return {
    putChannelsProviderActions,
    putChannelsProviderApplication,
    getChannelsSlackManifest,
    getChannels,
    postChannelsOauthStart,
    getChannelsOauthCallback,
    postChannelsProviderDisconnect,
  };
}
