import { helpdeskScope, resolveHelpdeskUser } from '../identity/helpdeskRoles.js';
import { profileTextFields, referenceTypes } from '../identity/workforceProfiles.js';
export async function chatUserContext(store, chat) {
  if (chat.helpdeskPurpose === 'email-support' && !chat.channelUserId) return null;
  const id = chat.channelUserId || chat.ownerId;
  let user;
  try {
    user = await resolveHelpdeskUser(
      store,
      { id, workspaceId: chat.workspaceId },
      chat.workspaceId,
    );
  } catch (error) {
    if ([400, 401, 403, 404].includes(error.status)) return null;
    throw error;
  }
  if ((user.helpdeskOwnerId || user.id) !== (chat.providerOwnerId || chat.ownerId)) return null;
  const account = await store
    .collection('users')
    .findOne({ id }, { projection: { name: 1, displayEmail: 1, email: 1 } });
  if (!account) return null;
  const scope = helpdeskScope(user);
  const profile = await store.collection('workforceProfiles').findOne({ ...scope, userId: id });
  const fields = Object.fromEntries(
    profileTextFields.filter((key) => profile?.[key]).map((key) => [key, profile[key]]),
  );
  const references = {};
  for (const key of referenceTypes) {
    if (!profile?.[key]) continue;
    const record = await store
      .collection('workforceReferences')
      .findOne({ ...scope, _id: profile[key], type: key });
    if (record) references[key] = { id: String(record._id), name: record.name };
  }
  let manager = null;
  if (profile?.manager) {
    const member = await store
      .collection('helpdeskMembers')
      .findOne({ ...scope, userId: profile.manager, active: true });
    const record =
      member &&
      (await store.collection('users').findOne({ id: member.userId }, { projection: { name: 1 } }));
    if (record) manager = { id: member.userId, name: record.name || member.email };
  }
  return {
    id,
    name: account.name,
    email: account.displayEmail || account.email,
    canApprove: !!user.canApprove,
    profile: fields,
    references,
    manager,
    profileUrl: `/workspace/${chat.workspaceId}/profile`,
  };
}
