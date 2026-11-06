import { ObjectId } from 'mongodb';
import { queryString } from '../shared/queryValues.js';
import { listResponse } from '../shared/listQuery.js';
import { helpdeskScope, deny } from '../identity/helpdeskRoles.js';
import { canReadAuthoredArticle } from './knowledgeAccess.js';
import { topicPath } from './topicHierarchy.js';

export async function knowledgeDirectory(store, user, query) {
  for (const key of ['base', 'topic'])
    if (
      query[key] !== undefined &&
      (typeof query[key] !== 'string' || (query[key] && !ObjectId.isValid(query[key])))
    )
      deny('Invalid knowledge folder.', 400);
  for (const key of ['page', 'pageSize'])
    if (
      query[key] !== undefined &&
      (typeof query[key] !== 'string' || !/^\d{1,6}$/.test(query[key]))
    )
      deny('Invalid list query.', 400);
  const scope = helpdeskScope(user);
  const records = await store
    .collection('records')
    .find({
      ownerId: queryString(scope.ownerId),
      workspaceId: queryString(scope.workspaceId),
      type: { $in: ['knowledge-base', 'topic'] },
    })
    .toArray();
  const bases = [
    { id: user.workspaceId, name: 'General', description: 'Your workspace knowledge.' },
    ...records
      .filter((row) => row.type === 'knowledge-base')
      .map((row) => ({ ...row, id: String(row._id), editable: true })),
  ];
  const baseMap = new Map(bases.map((base) => [base.id, base]));
  const topics = records
    .filter((row) => row.type === 'topic')
    .map((row) => ({ ...row, id: String(row._id) }));
  const articles = await store
    .collection('articles')
    .find(
      {
        ownerId: queryString(scope.ownerId),
        ...(user.role === 'admin' ? {} : { status: 'Published' }),
      },
      { projection: { body: 0, sections: 0 } },
    )
    .toArray();
  const visible = [];
  for (const article of articles)
    if (await canReadAuthoredArticle(store, user, article)) visible.push(article);
  const visibleTopicIds = new Set();
  for (const article of visible)
    for (const id of article.topicIds || [])
      for (const ancestor of topicPath(topics, id) || []) visibleTopicIds.add(ancestor.id);
  const allowedTopics =
    user.role === 'admin' ? topics : topics.filter((topic) => visibleTopicIds.has(topic.id));
  const allowedBases = [...baseMap.values()].filter(
    (base) => user.role === 'admin' || visible.some((article) => article.base === base.id),
  );
  const effectiveBase = (topic) =>
    topic.knowledgeBaseId ||
    visible.find((article) => article.topicIds?.includes(topic.id))?.base ||
    user.workspaceId;
  const baseId =
    query.base ||
    (query.topic && effectiveBase(allowedTopics.find((topic) => topic.id === query.topic) || {}));
  const base = baseId && allowedBases.find((base) => base.id === baseId);
  const topic =
    query.topic &&
    allowedTopics.find((topic) => topic.id === query.topic && effectiveBase(topic) === baseId);
  if ((baseId && !base) || (query.topic && !topic)) deny('Knowledge folder not found.', 404);
  const nodes = !base
    ? allowedBases.map((base) => ({
        id: base.id,
        type: 'base',
        name: base.name,
        description: base.description,
        baseId: base.id,
        depth: 0,
        editable: !!base.editable,
      }))
    : [
        ...allowedTopics
          .filter(
            (item) =>
              effectiveBase(item) === base.id && (item.parentTopicId || '') === (topic?.id || ''),
          )
          .map((item) => ({
            id: item.id,
            type: 'topic',
            name: item.name,
            description: item.description,
            baseId: base.id,
            parentTopicId: item.parentTopicId || '',
            depth: topicPath(topics, item.id)?.length || 1,
            editable: user.role === 'admin',
          })),
        ...visible
          .filter(
            (article) =>
              article.base === base.id &&
              (topic ? article.topicIds?.includes(topic.id) : !article.topicIds?.length),
          )
          .map((article) => ({
            id: String(article._id),
            type: 'article',
            name: article.title,
            baseId: base.id,
            topicId: topic?.id || '',
            status: article.status || 'Draft',
          })),
      ];
  const result = listResponse(
    { query: { ...query, list: '1', sort: 'Name', direction: 'asc' } },
    nodes,
    { Name: (item) => `${item.type === 'article' ? '1' : '0'}${item.name}` },
  );
  const path = base
    ? [
        { id: base.id, name: base.name, type: 'base', baseId: base.id },
        ...(topic
          ? (topicPath(topics, topic.id) || []).map((item) => ({
              id: item.id,
              name: item.name,
              type: 'topic',
              baseId: base.id,
            }))
          : []),
      ]
    : [];
  return {
    ...result,
    folder: topic
      ? {
          id: topic.id,
          type: 'topic',
          name: topic.name,
          baseId: base.id,
          depth: topicPath(topics, topic.id)?.length || 1,
          ancestors: path.map((item) => item.id),
          path,
          editable: user.role === 'admin',
        }
      : base
        ? {
            id: base.id,
            type: 'base',
            name: base.name,
            description: base.description,
            depth: 0,
            ancestors: [base.id],
            path,
            editable: !!base.editable,
          }
        : null,
  };
}
