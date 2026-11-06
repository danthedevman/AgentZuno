import { ObjectId } from 'mongodb';
import { deny, helpdeskScope } from '../identity/helpdeskRoles.js';
import { queryString } from '../shared/queryValues.js';

export async function deleteKnowledgeFolder(store, user, kind, id, input) {
  const scope = helpdeskScope(user);
  if (user.role !== 'admin' || scope.ownerId !== user.id) deny();
  if (!['base', 'topic'].includes(kind) || typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id))
    deny('Knowledge folder not found.', 404);
  if (kind === 'base' && id === user.workspaceId)
    deny('The General knowledge base cannot be deleted.', 403);
  if (
    !input ||
    input.confirmed !== true ||
    typeof input.name !== 'string' ||
    Object.keys(input).some((key) => !['confirmed', 'name'].includes(key))
  )
    deny('Confirm the folder name before deleting.', 400);
  const filter = {
    ...scope,
    _id: new ObjectId(queryString(id, 24)),
    type: kind === 'base' ? 'knowledge-base' : 'topic',
  };
  const record = await store.collection('records').findOne(filter);
  if (!record) deny('Knowledge folder not found.', 404);
  if (input.name !== record.name)
    deny('The folder changed. Reload and confirm its current name.', 409);
  if (record.sourceConnectionId)
    deny('Manage this knowledge base through its source connection.', 409);
  const children = await store.collection('records').findOne({
    ...scope,
    type: 'topic',
    ...(kind === 'base'
      ? { knowledgeBaseId: queryString(id, 24) }
      : { parentTopicId: queryString(id, 24) }),
  });
  const article = await store.collection('articles').findOne({
    ownerId: scope.ownerId,
    ...(kind === 'base' ? { base: queryString(id, 24) } : { topicIds: queryString(id, 24) }),
  });
  const imported =
    kind === 'base' &&
    (await store
      .collection('knowledgeDocuments')
      .findOne({ ...scope, knowledgeBaseId: queryString(id, 24) }));
  const connection =
    kind === 'base' &&
    (await store.collection('sourceConnections').findOne({
      ...scope,
      $or: [{ knowledgeBaseId: queryString(id, 24) }, { knowledgeBaseIds: queryString(id, 24) }],
    }));
  if (children || article || imported || connection)
    deny(
      'Move the articles and subtopics and disconnect any sources before deleting this folder.',
      409,
    );
  const deleted = await store.collection('records').deleteOne({
    ...filter,
    name: queryString(record.name, 160),
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
  });
  if (!deleted.deletedCount) deny('The folder changed. Reload and try again.', 409);
  await store
    .collection('knowledgePermissions')
    .deleteOne({ ...scope, kind, resourceId: queryString(id, 24) });
  return { deleted: true };
}
