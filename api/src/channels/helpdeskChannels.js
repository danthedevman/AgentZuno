import { isEmailAddress } from '../shared/emailAddress.js';
import { getConnectorActions } from '../integrations/connectorActions.js';
import { channelApplication, applicationMetadata } from './channelApplications.js';

import { randomBytes, createHash } from 'node:crypto';
import { encryptSecret } from '../shared/secrets.js';
import {
  requireRole,
  helpdeskScope,
  resolveHelpdeskUser,
  deny,
} from '../identity/helpdeskRoles.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
export const channelProviders = {
  gmail: {
    name: 'Gmail',
    prefix: 'GMAIL',
    authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    profile: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    scope:
      'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
  },
  teams: {
    name: 'Microsoft Teams',
    prefix: 'TEAMS',
    authorization: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    profile: 'https://graph.microsoft.com/v1.0/me',
    scope: 'https://graph.microsoft.com/User.Read https://graph.microsoft.com/Chat.Read',
  },
  outlook: {
    name: 'Outlook',
    prefix: 'OUTLOOK',
    authorization: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    profile: 'https://graph.microsoft.com/v1.0/me',
    scope:
      'offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send',
  },
  slack: {
    name: 'Slack',
    prefix: 'SLACK',
    authorization: 'https://slack.com/oauth/v2/authorize',
    token: 'https://slack.com/api/oauth.v2.access',
    profile: 'https://slack.com/api/auth.test',
    scope:
      'app_mentions:read chat:write channels:history groups:history channels:read groups:read im:history im:read',
  },
};
export async function fetchChannelJson(fetcher, url, options) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    deny('The provider could not be reached.', 502);
  }
  if (!response.ok) deny('The provider did not authorize this connection.', 422);
  if (response.status === 202 || response.status === 204) return {};
  if (!response.body) deny('Provider returned an empty response.', 422);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024 * 1024) {
      await reader.cancel();
      deny('Provider response exceeded its limit.', 422);
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    deny('Provider returned an invalid response.', 422);
  }
}
export function createHelpdeskChannels(store, fetcher = fetch) {
  const callbackUrl = () =>
    `${process.env.APP_ORIGIN || 'http://localhost:3000'}/api/helpdesk/channels/oauth/callback`;
  async function config(user, provider) {
    const item = channelProviders[provider];
    if (!item) deny('Unknown channel provider.', 400);
    const application = await channelApplication(store, user, provider);
    if (
      !application.clientId ||
      !application.clientSecret ||
      (provider === 'slack' && !application.signingSecret)
    )
      deny('Save the connection details before authorizing.', 422);
    return { ...item, ...application };
  }
  async function list(user) {
    requireRole(user, ['admin']);
    const saved = await store.collection('helpdeskChannels').find(helpdeskScope(user)).toArray();
    const teamsBot = await store.collection('helpdeskTeamsBots').findOne(helpdeskScope(user));
    const applications = await store
      .collection('helpdeskChannelApplications')
      .find(helpdeskScope(user))
      .toArray();
    const policies = Object.fromEntries(
      await Promise.all(
        Object.keys(channelProviders).map(async (id) => [
          id,
          await getConnectorActions(store, user, id),
        ]),
      ),
    );
    return Object.entries(channelProviders)
      .map(([id, item]) => {
        const connection = saved.find((value) => value.provider === id);
        const application = applicationMetadata(
          id,
          applications.find((value) => value.provider === id),
        );
        const enabled = (action) =>
          policies[id].items.some((item) => item.id === action && item.enabled);
        const expired =
          (connection?.expiresAt && new Date(connection.expiresAt) <= new Date()) ||
          (connection?.applicationVersion || 0) !== application.version;
        return {
          id,
          name: item.name,
          actions: policies[id],
          application,
          configured: !!(
            application.clientId &&
            application.hasClientSecret &&
            (id !== 'slack' || application.hasSigningSecret)
          ),
          setup: {
            interactionsUrl:
              id === 'slack'
                ? `${process.env.APP_ORIGIN || 'http://localhost:3000'}/api/helpdesk/channels/slack/interactions/${user.workspaceId}`
                : null,
            eventsUrl:
              id === 'slack'
                ? `${process.env.APP_ORIGIN || 'http://localhost:3000'}/api/helpdesk/channels/slack/events/${user.workspaceId}`
                : null,
          },
          bot:
            id === 'slack'
              ? {
                  enabled: connection?.bot?.enabled === true,
                  version: connection?.bot?.version || 0,
                  identityBindings: connection?.bot?.identityBindings || [],
                  teamName: connection?.slackTeamName || null,
                  teamId: connection?.slackTeamId || null,
                  requiresReauthorization:
                    !!connection?.credential && connection.slackScopeVersion !== 1,
                  error: connection?.bot?.error || null,
                }
              : null,
          connected: !!connection?.credential,
          status: connection?.credential
            ? expired
              ? 'Reauthorization required'
              : 'Authorized'
            : 'Not Configured',
          connectedAt: connection?.connectedAt || null,
          callbackUrl: callbackUrl(),
          purpose: ['gmail', 'outlook'].includes(id) ? 'support-inbox' : 'employee-messaging',
          description: ['gmail', 'outlook'].includes(id)
            ? 'Connect a dedicated support mailbox so Zuno can handle incoming employee emails and reply in the same thread.'
            : id === 'slack'
              ? 'Install Zuno as a bot. Mention it in any channel it has joined, or send it a direct message. Channel replies are private to the requester.'
              : 'Employee conversations with Zuno.',
          mailbox: connection?.mailbox || null,
          email: ['gmail', 'outlook'].includes(id)
            ? {
                enabled: connection?.email?.enabled === true,
                autoReply: connection?.email?.autoReply === true,
                department: connection?.email?.department || 'it',
                error: connection?.email?.error || null,
                lastCheckedAt: connection?.email?.lastCheckedAt || null,
                requiresReauthorization:
                  !!connection?.credential && connection.emailScopeVersion !== 1,
              }
            : null,
          canReceive:
            (connection?.email?.enabled === true || connection?.bot?.enabled === true) &&
            enabled('receiveMessages') &&
            !expired,
          canSend:
            ((connection?.email?.enabled === true && connection.email.autoReply === true) ||
              connection?.bot?.enabled === true) &&
            enabled('receiveMessages') &&
            enabled('respondToUsers') &&
            !expired,
          deliveryStatus: !connection?.credential
            ? 'Not Configured'
            : id === 'slack'
              ? connection?.bot?.enabled
                ? 'Bot replies enabled'
                : 'Bot disabled'
              : connection?.email?.enabled
                ? connection.email.error
                  ? 'Needs attention'
                  : connection.email.autoReply
                    ? 'Automatic replies enabled'
                    : 'Draft replies enabled'
                : 'Not configured',
          ...(id === 'teams'
            ? {
                teamsBot: {
                  tenantId: teamsBot?.tenantId || '',
                  enabled: teamsBot?.enabled === true,
                  identityBindings: teamsBot?.identityBindings || [],
                  version: teamsBot?.version || 0,
                  eventsUrl: `${process.env.APP_ORIGIN || 'http://localhost:3000'}/api/helpdesk/channels/teams/events/${user.workspaceId}`,
                },
                description:
                  'Receive private Teams support messages from mapped employees and reply with their permitted knowledge. Channel mentions receive a private-chat invitation.',
                connected:
                  teamsBot?.enabled === true && teamsBot.applicationVersion === application.version,
                status: !application.hasClientSecret
                  ? 'Not Configured'
                  : teamsBot?.enabled && teamsBot.applicationVersion === application.version
                    ? 'Connected'
                    : 'Bot Disabled',
                canReceive:
                  teamsBot?.enabled === true &&
                  teamsBot.applicationVersion === application.version &&
                  enabled('receiveMessages'),
                canSend:
                  teamsBot?.enabled === true &&
                  teamsBot.applicationVersion === application.version &&
                  enabled('receiveMessages') &&
                  enabled('respondToUsers'),
                deliveryStatus: !application.hasClientSecret
                  ? 'Not Configured'
                  : teamsBot?.enabled && teamsBot.applicationVersion === application.version
                    ? 'Private Bot Replies Enabled'
                    : 'Bot Disabled',
              }
            : {}),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
  }
  async function start(user, input) {
    requireRole(user, ['admin']);
    if (input?.provider === 'teams')
      deny('Configure the Teams bot instead of a delegated Graph account.', 400);
    if (!input || Object.keys(input).some((key) => key !== 'provider'))
      deny('Invalid authorization fields.', 400);
    const item = await config(user, input.provider);
    const state = randomBytes(32).toString('hex');
    const browser = randomBytes(32).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    await store.collection('helpdeskChannelOAuth').insertOne({
      _id: hash(state),
      ...helpdeskScope(user),
      actorId: user.id,
      provider: input.provider,
      browserHash: hash(browser),
      verifier,
      configHash: hash(item.clientId + '\n' + item.clientSecret),
      expiresAt: new Date(Date.now() + 600000),
    });
    const url = new URL(item.authorization);
    const params = {
      client_id: item.clientId,
      redirect_uri: callbackUrl(),
      state,
      scope:
        input.provider === 'slack'
          ? [...item.scope.split(' '), 'users:read', 'users:read.email'].join(',')
          : item.scope,
      response_type: 'code',
    };
    if (input.provider !== 'slack')
      Object.assign(params, {
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      });
    if (input.provider === 'gmail')
      Object.assign(params, { access_type: 'offline', prompt: 'consent' });
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return { url: url.href, browser };
  }
  async function complete(sessionUser, query, browser) {
    if (
      typeof query.state !== 'string' ||
      !/^[a-f0-9]{64}$/.test(query.state) ||
      typeof browser !== 'string' ||
      !/^[a-f0-9]{64}$/.test(browser)
    )
      deny('Authorization request could not be verified.', 401);
    const flow = await store.collection('helpdeskChannelOAuth').findOneAndDelete({
      _id: hash(query.state),
      actorId: sessionUser.id,
      browserHash: hash(browser),
      expiresAt: { $gt: new Date() },
    });
    if (!flow) deny('Authorization request expired or was already used.', 401);
    const user = await resolveHelpdeskUser(store, sessionUser, flow.workspaceId);
    requireRole(user, ['admin']);
    if (user.helpdeskOwnerId !== flow.ownerId) deny('Workspace access changed.');
    if (query.error || typeof query.code !== 'string' || !query.code || query.code.length > 4096)
      deny('Provider authorization was not completed.', 422);
    const item = await config(user, flow.provider);
    if (flow.configHash !== hash(item.clientId + '\n' + item.clientSecret))
      deny('OAuth configuration changed. Start authorization again.', 401);
    const params = new URLSearchParams({
      client_id: item.clientId,
      client_secret: item.clientSecret,
      redirect_uri: callbackUrl(),
      code: query.code,
      grant_type: 'authorization_code',
    });
    if (flow.provider !== 'slack') params.set('code_verifier', flow.verifier);
    const tokens = await fetchChannelJson(fetcher, item.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (flow.provider === 'slack' && tokens?.ok === false) {
      const errors = new Map([
        [
          'bad_client_secret',
          'Slack rejected the Client Secret. Save the Client Secret from the same Slack app as the Client ID, then start Add to Slack again.',
        ],
        [
          'invalid_client_id',
          'Slack rejected the Client ID. Check the saved Slack application details, then start Add to Slack again.',
        ],
        [
          'invalid_code',
          'The Slack authorization code is invalid or expired. Return to Connectors → Slack and start Add to Slack again; do not refresh the callback page.',
        ],
        [
          'code_already_used',
          'This Slack authorization code was already used. Return to Connectors → Slack and start Add to Slack again.',
        ],
        [
          'bad_redirect_uri',
          'Slack rejected the OAuth callback URL. Save the exact callback shown in AgentZuno under Slack OAuth & Permissions, then start Add to Slack again.',
        ],
        [
          'access_denied',
          'Slack denied this installation. Check your workspace installation permissions, then start Add to Slack again.',
        ],
      ]);
      deny(
        errors.get(tokens.error) ||
          'Slack could not complete authorization. Check the Slack app configuration and start Add to Slack again.',
        422,
      );
    }
    if (
      !tokens ||
      tokens.ok === false ||
      typeof tokens.access_token !== 'string' ||
      !tokens.access_token ||
      tokens.access_token.length > 16000
    )
      deny('Provider did not return a valid access token.', 422);
    const profile = await fetchChannelJson(fetcher, item.profile, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (profile.ok === false || !(profile.id || profile.emailAddress || profile.team_id))
      deny('Provider identity could not be verified.', 422);
    const isSlack = flow.provider === 'slack';
    if (
      isSlack &&
      (tokens.token_type !== 'bot' ||
        !/^[UW][A-Z0-9]{2,39}$/.test(tokens.bot_user_id || '') ||
        !/^T[A-Z0-9]{2,39}$/.test(profile.team_id || '') ||
        !/^A[A-Z0-9]{2,39}$/.test(tokens.app_id || '') ||
        tokens.team?.id !== profile.team_id ||
        !item.scope.split(' ').every((scope) => (tokens.scope || '').split(',').includes(scope)))
    )
      deny('Install a Slack bot with all required permissions.', 422);
    const previous = await store
      .collection('helpdeskChannels')
      .findOne({ ...helpdeskScope(user), provider: flow.provider });
    const isEmail = ['gmail', 'outlook'].includes(flow.provider);
    const mailbox = isEmail
      ? (profile.emailAddress || profile.mail || profile.userPrincipalName || '').toLowerCase()
      : null;
    if (isEmail && !isEmailAddress(mailbox))
      deny('The mailbox identity could not be verified.', 422);
    if (
      isEmail &&
      typeof tokens.scope === 'string' &&
      !tokens.scope
        .split(' ')
        .some((scope) =>
          scope.toLowerCase().endsWith(flow.provider === 'gmail' ? 'gmail.send' : 'mail.send'),
        )
    )
      deny('Read and reply consent is required for a support inbox.', 422);
    if (
      isSlack &&
      (await store.collection('helpdeskChannels').findOne({
        provider: 'slack',
        slackTeamId: profile.team_id,
        $or: [
          { ownerId: { $ne: user.helpdeskOwnerId || user.id } },
          { workspaceId: { $ne: user.workspaceId } },
        ],
      }))
    )
      deny('This Slack workspace is already connected to another workspace.', 409);
    const expiresIn = Number(tokens.expires_in);
    if (
      tokens.expires_in !== undefined &&
      (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 31536000)
    )
      deny('Provider returned an invalid token lifetime.', 422);
    if (
      tokens.refresh_token !== undefined &&
      (typeof tokens.refresh_token !== 'string' || tokens.refresh_token.length > 16000)
    )
      deny('Provider returned an invalid refresh token.', 422);
    const currentApplication = await config(user, flow.provider);
    if (
      currentApplication.version !== item.version ||
      currentApplication.clientId !== item.clientId ||
      currentApplication.clientSecret !== item.clientSecret
    )
      deny('Connection settings changed. Start authorization again.', 409);
    await store.collection('helpdeskChannels').updateOne(
      { ...helpdeskScope(user), provider: flow.provider },
      {
        $set: {
          ...helpdeskScope(user),
          provider: flow.provider,
          applicationVersion: item.version,
          credential: encryptSecret(
            JSON.stringify({
              accessToken: tokens.access_token,
              refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null,
            }),
          ),
          mailbox,
          ...(isSlack
            ? {
                slackScopeVersion: 1,
                slackGrantedScopes:
                  typeof tokens.scope === 'string' ? tokens.scope.split(',').slice(0, 100) : [],
                slackTeamId: profile.team_id,
                slackTeamName: tokens.team?.name || profile.team || profile.team_id,
                slackBotUserId: tokens.bot_user_id,
                slackAppId: tokens.app_id,
                slackGeneration: randomBytes(16).toString('hex'),
                bot: {
                  enabled:
                    previous?.slackTeamId === profile.team_id &&
                    previous?.slackAppId === tokens.app_id &&
                    previous?.bot?.enabled === true,
                  identityBindings:
                    previous?.slackTeamId === profile.team_id &&
                    previous?.slackAppId === tokens.app_id
                      ? previous?.bot?.identityBindings || []
                      : [],
                  version: (previous?.bot?.version || 0) + 1,
                },
              }
            : {}),
          ...(isEmail
            ? {
                emailScopeVersion: 1,
                emailGeneration: randomBytes(16).toString('hex'),
                email: {
                  enabled: previous?.email?.enabled ?? flow.provider === 'gmail',
                  autoReply: previous?.email?.autoReply ?? flow.provider === 'gmail',
                  department: previous?.email?.department || 'it',
                  enabledAt: new Date(),
                },
              }
            : {}),
          connectedBy: user.id,
          connectedAt: new Date(),
          expiresAt:
            Number.isFinite(expiresIn) && expiresIn > 0
              ? new Date(Date.now() + Math.min(expiresIn, 31536000) * 1000)
              : null,
        },
      },
      { upsert: true },
    );
    return user;
  }
  async function disconnect(user, provider) {
    requireRole(user, ['admin']);
    if (!channelProviders[provider]) deny('Unknown channel provider.', 400);
    await store.collection('helpdeskChannels').deleteOne({ ...helpdeskScope(user), provider });
    return { disconnected: true };
  }
  return { list, start, complete, disconnect };
}
