import { createHash } from 'node:crypto';
import { helpdeskScope, requireRole, deny } from './helpdeskRoles.js';

export const connectorActions = {
  slack: [
    {
      id: 'receiveMessages',
      label: 'Receive Messages',
      description: 'Process mentions, direct messages and replies in bot conversations.',
    },
    {
      id: 'respondToUsers',
      label: 'Respond to Users',
      description: 'Allow Zuno to reply to incoming support conversations.',
    },
    {
      id: 'workflowNotifications',
      label: 'Workflow Notifications',
      description: 'Allow published workflows to send Slack messages to authorized destinations.',
    },
  ],
  gmail: [
    {
      id: 'receiveMessages',
      label: 'Receive Emails',
      description: 'Read incoming support emails and create support conversations.',
    },
    {
      id: 'respondToUsers',
      label: 'Respond to Users',
      description: 'Allow automatic replies when enabled for this support inbox.',
    },
  ],
  outlook: [
    {
      id: 'receiveMessages',
      label: 'Receive Emails',
      description: 'Read incoming support emails and create support conversations.',
    },
    {
      id: 'respondToUsers',
      label: 'Respond to Users',
      description: 'Allow automatic replies when enabled for this support inbox.',
    },
  ],
  teams: [],
};
const policyId = (scope, provider) =>
  createHash('sha256').update(`${scope.ownerId}:${scope.workspaceId}:${provider}`).digest('hex');
export async function getConnectorActions(store, user, provider) {
  const definitions = connectorActions[provider];
  if (!definitions) deny('Unknown connector.', 400);
  const scope = helpdeskScope(user);
  const saved = await store
    .collection('helpdeskChannelPolicies')
    .findOne({ _id: policyId(scope, provider), ...scope });
  return {
    version: saved?.version || 0,
    items: definitions.map((action) => ({
      ...action,
      enabled: saved?.actions?.[action.id] !== false,
    })),
  };
}
export async function requireConnectorAction(store, source, action) {
  const policy = await getConnectorActions(
    store,
    { id: source.ownerId, helpdeskOwnerId: source.ownerId, workspaceId: source.workspaceId },
    source.provider,
  );
  if (!policy.items.some((item) => item.id === action && item.enabled))
    deny('This connector action is disabled by an administrator.', 403);
}
export async function saveConnectorActions(store, user, provider, input) {
  requireRole(user, ['admin']);
  if (user.isDemo) deny();
  const definitions = connectorActions[provider];
  if (
    !definitions?.length ||
    !input ||
    Object.keys(input).some((key) => !['version', 'actions'].includes(key)) ||
    !Number.isInteger(input.version) ||
    input.version < 0 ||
    !input.actions ||
    typeof input.actions !== 'object' ||
    Array.isArray(input.actions) ||
    Object.keys(input.actions).length !== definitions.length ||
    Object.keys(input.actions).some((key) => !definitions.some((item) => item.id === key)) ||
    definitions.some((item) => typeof input.actions[item.id] !== 'boolean')
  )
    deny('Invalid connector actions.', 400);
  const scope = helpdeskScope(user);
  try {
    const result = await store.collection('helpdeskChannelPolicies').updateOne(
      { _id: policyId(scope, provider), ...scope, version: input.version },
      {
        $set: {
          ...scope,
          provider,
          actions: input.actions,
          updatedAt: new Date(),
          updatedBy: user.id,
        },
        $inc: { version: 1 },
      },
      { upsert: input.version === 0 },
    );
    if (!result.matchedCount && !result.upsertedCount)
      deny('Connector actions changed. Reload before saving.', 409);
  } catch (error) {
    if (error.code === 11000) deny('Connector actions changed. Reload before saving.', 409);
    throw error;
  }
  return { saved: true };
}
