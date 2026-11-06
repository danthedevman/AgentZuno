import { ObjectId } from 'mongodb';
import { queryString } from '../shared/queryValues.js';
import { resolveChatActor } from '../chat/chatAuthorization.js';

import { helpdeskScope } from '../identity/helpdeskRoles.js';

export const kinds = ['base', 'topic', 'article'];
export async function knowledgeAllowed(store, user, kind, id) {
  if (user.role === 'admin') return true;
  if (kind === 'base' && id === user.workspaceId) return true;
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
export async function canReadKnowledgeTopic(store, user, id, baseId) {
  if (user.role === 'admin') return true;
  const scope = helpdeskScope(user);
  const path = new Set();
  let current = id;
  while (current) {
    if (
      typeof current !== 'string' ||
      !ObjectId.isValid(current) ||
      path.has(current) ||
      path.size >= 3
    )
      return false;
    path.add(current);
    if (!(await knowledgeAllowed(store, user, 'topic', current))) return false;
    const topic = await store.collection('records').findOne({
      _id: new ObjectId(queryString(current, 24)),
      ownerId: queryString(scope.ownerId),
      workspaceId: queryString(scope.workspaceId),
      type: 'topic',
    });
    if (!topic) return path.size === 1;
    if (baseId && topic.knowledgeBaseId && topic.knowledgeBaseId !== baseId) return false;
    current = topic.parentTopicId;
  }
  return true;
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
    if (!(await canReadKnowledgeTopic(store, user, id, article.base))) return false;
  return true;
}
export async function knowledgeActor(store, chat) {
  return resolveChatActor(store, chat);
}
