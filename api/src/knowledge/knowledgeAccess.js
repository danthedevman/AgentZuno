import { resolveChatActor } from '../chat/chatAuthorization.js';

import { helpdeskScope } from '../identity/helpdeskRoles.js';

export const kinds = ['base', 'topic', 'article'];
export async function knowledgeAllowed(store, user, kind, id) {
  if (user.role === 'admin') return true;
  const policy = await store
    .collection('knowledgePermissions')
    .findOne({ ...helpdeskScope(user), kind, resourceId: id });
  if (!policy || policy.mode === 'inherit') return kind !== 'base';
  if (policy.mode === 'workspace') return true;
  return (
    policy.mode === 'restricted' &&
    (policy.userIds.includes(user.id) || policy.roles.includes(user.role))
  );
}
export async function canReadAuthoredArticle(store, user, article) {
  if (
    article.ownerId !== (user.helpdeskOwnerId || user.id) ||
    (article.workspaceId && article.workspaceId !== user.workspaceId)
  )
    return false;
  if (user.role !== 'admin' && article.status !== 'Published') return false;
  if (!(await knowledgeAllowed(store, user, 'base', article.base))) return false;
  if (!(await knowledgeAllowed(store, user, 'article', article._id.toHexString()))) return false;
  for (const id of article.topicIds || [])
    if (!(await knowledgeAllowed(store, user, 'topic', id))) return false;
  return true;
}
export async function knowledgeActor(store, chat) {
  return resolveChatActor(store, chat);
}
