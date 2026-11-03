import { encryptSecret, decryptSecret } from './secrets.js';
import { helpdeskScope, requireRole, deny } from './helpdeskRoles.js';
const prefixes = { slack: 'SLACK', teams: 'TEAMS', gmail: 'GMAIL', outlook: 'OUTLOOK' };
export async function channelApplication(store, user, provider) {
  const prefix = prefixes[provider];
  if (!prefix) deny('Unknown connector.', 400);
  const saved = await store
    .collection('helpdeskChannelApplications')
    .findOne({ ...helpdeskScope(user), provider });
  return {
    clientId: saved?.clientId || '',
    clientSecret: saved?.clientSecret ? decryptSecret(saved.clientSecret) : '',
    signingSecret: saved?.signingSecret ? decryptSecret(saved.signingSecret) : '',
    version: saved?.version || 0,
  };
}
export function applicationMetadata(provider, saved) {
  return {
    clientId: saved?.clientId || '',
    hasClientSecret: !!saved?.clientSecret,
    hasSigningSecret: !!saved?.signingSecret,
    version: saved?.version || 0,
  };
}

export async function saveChannelApplication(store, user, provider, input) {
  requireRole(user, ['admin']);
  if (user.isDemo) deny();
  if (
    !prefixes[provider] ||
    !input ||
    Object.keys(input).some(
      (key) => !['clientId', 'clientSecret', 'signingSecret', 'version'].includes(key),
    ) ||
    !Number.isInteger(input.version) ||
    input.version < 0
  )
    deny('Invalid connection settings.', 400);
  for (const [key, max] of [
    ['clientId', 512],
    ['clientSecret', 4000],
    ['signingSecret', 512],
  ]) {
    if (
      typeof input[key] !== 'string' ||
      input[key].length > max ||
      /[\x00-\x20\x7f]/.test(input[key])
    )
      deny('Invalid connection settings.', 400);
  }
  if (!input.clientId || (provider !== 'slack' && input.signingSecret))
    deny('Provide the required connection details.', 400);
  const scope = helpdeskScope(user);
  const current = await channelApplication(store, user, provider);
  if (current.version !== input.version)
    deny('Connection settings changed. Reload before saving.', 409);
  const canKeep = current.clientId === input.clientId;
  const clientSecret = input.clientSecret || (canKeep ? current.clientSecret : '');
  const signingSecret =
    provider === 'slack' ? input.signingSecret || (canKeep ? current.signingSecret : '') : '';
  if (!clientSecret || (provider === 'slack' && !signingSecret))
    deny('Provide the required secrets for this application.', 400);
  const value = {
    ...scope,
    provider,
    clientId: input.clientId,
    clientSecret: encryptSecret(clientSecret),
    ...(signingSecret ? { signingSecret: encryptSecret(signingSecret) } : {}),
    version: input.version + 1,
    updatedAt: new Date(),
  };
  const collection = store.collection('helpdeskChannelApplications');
  if (!input.version) {
    try {
      await collection.insertOne({ ...value, createdAt: new Date() });
    } catch (error) {
      if (error.code === 11000) deny('Connection settings changed. Reload before saving.', 409);
      throw error;
    }
  } else {
    const result = await collection.updateOne(
      { ...scope, provider, version: input.version },
      { $set: value },
    );
    if (!result.matchedCount) deny('Connection settings changed. Reload before saving.', 409);
  }
  await store.collection('helpdeskChannels').deleteOne({ ...scope, provider });
  await store.collection('helpdeskChannelOAuth').deleteMany({ ...scope, provider });
  return applicationMetadata(provider, value);
}
export async function slackSigningSecret(store, workspaceId) {
  if (!workspaceId) return '';
  if (!/^[a-f0-9]{24}$/.test(workspaceId)) deny('Invalid Slack destination.', 401);
  const saved = await store
    .collection('helpdeskChannelApplications')
    .findOne({ workspaceId, provider: 'slack' });
  return saved?.signingSecret ? decryptSecret(saved.signingSecret) : '';
}

export async function requireCurrentChannelApplication(store, source) {
  const current = await store
    .collection('helpdeskChannelApplications')
    .findOne(
      { ownerId: source.ownerId, workspaceId: source.workspaceId, provider: source.provider },
      { projection: { version: 1 } },
    );
  if ((current?.version || 0) !== (source.applicationVersion || 0))
    deny('Reauthorize this connection after changing its application settings.', 403);
}
