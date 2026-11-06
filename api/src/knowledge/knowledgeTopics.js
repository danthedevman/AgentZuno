import { ObjectId } from 'mongodb';
import { topicPlacement } from './topicHierarchy.js';
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
    const placement = topicPlacement(workspace, input, existing);
    const hasArticleSelection = Object.hasOwn(input, 'articleIds');
    const articleIds = hasArticleSelection
      ? input.articleIds
      : workspace.articles
          .filter((article) => article.topicIds?.includes(topicId))
          .map((article) => article.id);

    if (
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 100 ||
      typeof input.description !== 'string' ||
      input.description.length > 1000 ||
      !Array.isArray(articleIds) ||
      (hasArticleSelection && articleIds.length > 200) ||
      articleIds.some((id) => !workspace.articles.some((item) => item.id === id))
    )
      throw failure('Enter a topic name and select articles in your workspace.');
    if (
      placement.knowledgeBaseId &&
      (!workspace.knowledgeBases.some((base) => base.id === placement.knowledgeBaseId) ||
        articleIds.some(
          (id) =>
            workspace.articles.find((article) => article.id === id)?.base !==
            placement.knowledgeBaseId,
        ))
    )
      throw failure('Choose a knowledge base and its articles from this workspace.');
    await requireCompatibleDemoReferences(store, user, existing, {
      knowledgeBaseId: placement.knowledgeBaseId,
      parentTopicId: placement.parentTopicId,
      articleIds,
    });
    const record = {
      ...(placement.knowledgeBaseId ? { knowledgeBaseId: placement.knowledgeBaseId } : {}),
      parentTopicId: placement.parentTopicId,
      type: 'topic',
      name: input.name.trim(),
      description: input.description.trim(),
      articleIds: [...new Set(articleIds)],
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
    if (existing && hasArticleSelection)
      await store.collection('articles').updateMany(
        {
          ownerId: queryString(user.id),
          topicIds: id,
          _id: {
            $nin: articleIds
              .filter((value) => ObjectId.isValid(value))
              .map((value) => new ObjectId(value)),
          },
        },
        { $pull: { topicIds: id } },
      );
    if (hasArticleSelection && articleIds.length)
      await store.collection('articles').updateMany(
        {
          ownerId: queryString(user.id),
          _id: {
            $in: articleIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)),
          },
        },
        { $addToSet: { topicIds: id } },
      );
    return { id, name: record.name };
  }
  return topic;
}
