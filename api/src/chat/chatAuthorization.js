import {
  resolveHelpdeskUser,
  assumeHelpdeskRole,
  helpdeskScope,
  deny,
} from '../identity/helpdeskRoles.js';

// A queued response may retain or lose authority, but never gain it from a stale role snapshot.
export async function resolveChatActor(store, chat) {
  let actor = await resolveHelpdeskUser(
    store,
    { id: chat.ownerId, workspaceId: chat.workspaceId },
    chat.workspaceId,
  );
  if (helpdeskScope(actor).ownerId !== (chat.providerOwnerId || chat.ownerId)) deny();
  if (chat.permissionSessionId) {
    const session = await store.collection('sessions').findOne({
      _id: chat.permissionSessionId,
      'user.id': chat.ownerId,
      expiresAt: { $gt: new Date() },
    });
    if (!session) deny('Your session changed. Sign in before continuing.', 403);
    if (
      session.impersonation &&
      (session.impersonation.workspaceId !== chat.workspaceId ||
        session.impersonation.role !== chat.actionRole)
    )
      deny('Your effective role changed. Send a new message before continuing.', 403);
  }
  if (chat.actionRole && chat.actionRole !== actor.role) {
    if (actor.role === 'admin') actor = assumeHelpdeskRole(actor, chat.actionRole);
    else if (actor.role === 'agent' && chat.actionRole === 'user')
      actor = { ...actor, role: 'user', queues: [], canApprove: false };
    else deny('Your role changed. Start a new conversation.', 403);
  }
  return actor;
}
