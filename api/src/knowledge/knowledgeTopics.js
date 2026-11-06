import { ObjectId } from 'mongodb';
import { queryString } from '../shared/queryValues.js';
import { requireCompatibleDemoReferences } from '../demo/demoReferences.js';
import { readWorkspace } from '../data/data.js';
import { helpdeskScope, deny } from '../identity/helpdeskRoles.js';
const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status, publicMessage: message });
export async function knowledgeStructure(store, user) {
  if (user.role !== 'admin' || helpdeskScope(user).ownerId !== user.id)
    deny('Knowledge administration requires the owning workspace administrator.', 403);
  const defaults = await readWorkspace(user);
  const records = await store
    .collection('records')
    .find({ ...helpdeskScope(user), type: { $in: ['topic', 'knowledge-base'] } })
    .toArray();
  const articles = await store
    .collection('articles')
    .find({ ownerId: queryString(user.id) }, { projection: { title: 1, base: 1, topicIds: 1 } })
    .toArray();
  const merge = (type, existing) => [
    ...new Map(
      [
        ...(existing || []),
        ...records
          .filter((record) => record.type === type)
          .map(({ _id, ...row }) => ({ ...row, id: String(_id) })),
      ].map((row) => [row.id, row]),
    ).values(),
  ];
  return {
    knowledgeBases: merge('knowledge-base', defaults.knowledgeBases),
    topics: merge('topic', defaults.topics),
    articles: articles.map(({ _id, ...row }) => ({ ...row, id: String(_id) })),
  };
}
export function createKnowledgeTopics(
  store,
  loadWorkspace = (user) => knowledgeStructure(store, user),
) {
  async function topic(user, input, topicId) {
    const existing =
      topicId && ObjectId.isValid(topicId)
        ? await store.collection('records').findOne({
            _id: new ObjectId(topicId),
            type: 'topic',
            ownerId: queryString(user?.id),
            workspaceId: queryString(user?.workspaceId),
          })
        : null;
    if (topicId && !existing) throw failure('Topic not found.', 404);
    if (!user || user.isDemo) throw failure('Sign in to create topics.', 401);
    const workspace = await loadWorkspace(user);
    if (
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 100 ||
      typeof input.description !== 'string' ||
      input.description.length > 1000 ||
      !Array.isArray(input.articleIds) ||
      input.articleIds.length > 200 ||
      input.articleIds.some((id) => !workspace.articles.some((item) => item.id === id))
    )
      throw failure('Enter a topic name and select articles in your workspace.');
    if (
      input.knowledgeBaseId &&
      (!workspace.knowledgeBases.some((base) => base.id === input.knowledgeBaseId) ||
        input.articleIds.some(
          (id) =>
            workspace.articles.find((article) => article.id === id)?.base !== input.knowledgeBaseId,
        ))
    )
      throw failure('Choose a knowledge base and its articles from this workspace.');
    await requireCompatibleDemoReferences(store, user, existing, {
      knowledgeBaseId: input.knowledgeBaseId || existing?.knowledgeBaseId,
      articleIds: input.articleIds,
    });
    const record = {
      ...(input.knowledgeBaseId
        ? { knowledgeBaseId: input.knowledgeBaseId }
        : existing?.knowledgeBaseId
          ? { knowledgeBaseId: existing.knowledgeBaseId }
          : {}),
      type: 'topic',
      name: input.name.trim(),
      description: input.description.trim(),
      articleIds: [...new Set(input.articleIds)],
      ownerId: queryString(user.id),
      workspaceId: queryString(user.workspaceId),
      updatedAt: new Date().toISOString(),
    };
    let id = topicId;
    if (existing)
      await store
        .collection('records')
        .updateOne({ _id: existing._id, ownerId: queryString(user.id) }, { $set: record });
    else {
      const result = await store.collection('records').insertOne(record);
      id = result.insertedId.toHexString();
    }
    if (existing)
      await store.collection('articles').updateMany(
        {
          ownerId: queryString(user.id),
          topicIds: id,
          _id: {
            $nin: input.articleIds
              .filter((value) => ObjectId.isValid(value))
              .map((value) => new ObjectId(value)),
          },
        },
        { $pull: { topicIds: id } },
      );
    if (input.articleIds.length)
      await store.collection('articles').updateMany(
        {
          ownerId: queryString(user.id),
          _id: {
            $in: input.articleIds
              .filter((id) => ObjectId.isValid(id))
              .map((id) => new ObjectId(id)),
          },
        },
        { $addToSet: { topicIds: id } },
      );
    return { id, name: record.name };
  }
  return topic;
}
